const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Notification, Tray, Menu, nativeImage, systemPreferences, shell } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { createMacOSController } = require('./macos.cjs');
const { createLocalTranscriptionProvider } = require('../server/provider.cjs');
const { processTranscript } = require('../server/processing.cjs');
const {createDesktopAuth}=require('./auth.cjs');
const { createSync } = require('./sync.cjs');

let dashboardWindow;
let captureWindow;
let appTray;

const TRAY_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><rect x="6.5" y="2" width="5" height="9" rx="2.5" fill="#000"/><path d="M4.5 8.5v1a4.5 4.5 0 0 0 9 0v-1M9 14v2m-2 0h4" fill="none" stroke="#000" stroke-linecap="round" stroke-width="1.5"/></svg>';

function getDashboardUrl(environment = process.env) {
  return environment.VITE_DEV_SERVER_URL || environment.WHISPR_DASHBOARD_URL || 'https://whispr-flow-clone.vercel.app';
}

function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function guardNavigation(event, url, origin) {
  if (!sameOrigin(url, origin)) event.preventDefault();
}

function createDashboard() {
  dashboardWindow = new BrowserWindow({ width: 720, height: 860, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  dashboardWindow.setTitle('Whispr');
  const dashboardOrigin = new URL(getDashboardUrl()).origin;
  dashboardWindow.webContents.on('will-navigate', (event, url) => guardNavigation(event, url, dashboardOrigin));
  dashboardWindow.webContents.on('will-redirect', (event, url) => guardNavigation(event, url, dashboardOrigin));
  dashboardWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  dashboardWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Whispr dashboard failed to load (${code}): ${description} — ${url}`);
  });
  dashboardWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Whispr dashboard renderer exited:', details);
  });
  dashboardWindow.loadURL(getDashboardUrl()).catch((error) => {
    console.error('Whispr dashboard could not load:', error);
  });
  return dashboardWindow;
}

function showDashboard() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) createDashboard();
  if (dashboardWindow.isMinimized()) dashboardWindow.restore();
  dashboardWindow.show();
  dashboardWindow.focus();
  app.focus({ steal: true });
  return dashboardWindow;
}

function createCapture() {
  if (captureWindow && !captureWindow.isDestroyed()) return captureWindow;
  captureWindow = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'recorder-preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  const captureContents = captureWindow.webContents;
  captureContents.session.setPermissionRequestHandler((requestingContents, permission, callback, details = {}) => {
    const audioOnly = permission === 'media' && details.mediaTypes?.includes('audio') && !details.mediaTypes?.includes('video');
    callback(requestingContents === captureContents && audioOnly);
  });
  return captureWindow;
}

function createTray({
  TrayCtor = Tray,
  MenuCtor = Menu,
  nativeImageCtor = nativeImage,
  dashboardWindow = null,
  getDashboard = null
} = {}) {
  const trayImage = nativeImageCtor.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(TRAY_ICON_SVG).toString('base64')}`);
  trayImage.setTemplateImage(true);
  const tray = new TrayCtor(trayImage);
  tray.setTitle('Whispr');
  tray.setToolTip('Whispr voice typing');
  tray.setContextMenu(MenuCtor.buildFromTemplate([
    {
      label: 'Open Whispr',
      click: () => {
        const window = !dashboardWindow || dashboardWindow.isDestroyed?.() ? getDashboard?.() : dashboardWindow;
        if (!window || window.isDestroyed?.()) return;
        window.show();
        window.focus();
      }
    }
  ]));
  return tray;
}

function createRecordingRuntime({
  ipcMain: ipc = ipcMain,
  globalShortcut: shortcuts = globalShortcut,
  createCaptureWindow = createCapture,
  dashboardWindow = null,
  getDashboardWindow = () => dashboardWindow,
  tray = null,
  controller = createMacOSController({ clipboard, execFile, Notification }),
  fetchImpl = fetch,
  localProvider = createLocalTranscriptionProvider(),
  sync: syncImplementation = null,
  requestMicrophoneAccess = () => true,
  apiUrl = (() => {
    try { return new URL(getDashboardUrl()).origin; } catch { return process.env.WHISPR_API_URL || 'http://127.0.0.1:3000'; }
  })(),
  getAuthorization = null,
  desktopAuth: desktopAuthImplementation = null
} = {}) {
  const desktopAuth=desktopAuthImplementation || createDesktopAuth({apiUrl,openExternal:url=>shell.openExternal(url),fetchImpl:(...args)=>fetchImpl(...args)});
  const authorizationForSync=getAuthorization || desktopAuth.getAuthorization;
  let capture;
  let captureReady = false;
  const pendingCommands = [];
  let recording = false;
  let selectedMode = 'exact';
  let activeMode = null;
  let shortcutStatus = { registered: null, message: '' };
  let provider = localProvider;
  let sync = syncImplementation || createSync({
    fetchImpl: (...args) => fetchImpl(...args),
    apiUrl,
    getAuthorization: authorizationForSync
  });

  function setTrayRecording(recordingState) {
    tray?.setTitle(recordingState ? '● Whispr' : 'Whispr');
  }

  function sendDashboardStatus(status) {
    const window = getDashboardWindow();
    if (window?.isDestroyed?.()) return;
    const contents = window?.webContents;
    if (!contents) return;
    if (contents.isLoading?.()) {
      contents.once?.('did-finish-load', () => {
        if (!window.isDestroyed?.()) contents.send('recording:status', status);
      });
      return;
    }
    contents.send('recording:status', status);
  }

  function showNotification(title, message) {
    try {
      controller.showNotification(title, message);
    } catch (error) {
      console.error(`Whispr notification failed: ${error.message}`);
    }
  }

  function reportRecordingError(message) {
    recording = false;
    activeMode = null;
    setTrayRecording(false);
    const status = { type: 'recording-error', message };
    sendDashboardStatus(status);
    showNotification('Whispr recording error', message);
  }

  function ensureCapture() {
    if (capture) return capture;
    capture = createCaptureWindow();
    capture.webContents.once('did-finish-load', () => {
      captureReady = true;
      while (pendingCommands.length) capture.webContents.send('capture:command', pendingCommands.shift());
    });
    capture.loadFile?.(path.join(__dirname, 'recorder.html'));
    return capture;
  }

  function sendCaptureCommand(command) {
    const window = ensureCapture();
    if (captureReady) window.webContents.send('capture:command', command);
    else pendingCommands.push(command);
  }

  function setSelectedMode(mode) {
    selectedMode = ['exact', 'polished'].includes(mode) ? mode : 'exact';
    return { mode: selectedMode };
  }

  function start(mode = selectedMode) {
    setSelectedMode(mode);
    if (recording) return { recording: true };
    recording = true;
    activeMode = selectedMode;
    setTrayRecording(true);
    sendDashboardStatus({ type: 'recording-started', mode: selectedMode });
    const beginCapture = () => {
      if (!recording) return;
      sendCaptureCommand({ type: 'start' });
      showNotification('Whispr', 'Recording started');
    };
    try {
      const access = requestMicrophoneAccess();
      if (access && typeof access.then === 'function') {
        access.then((granted) => {
          if (granted) beginCapture();
          else reportRecordingError('Microphone access was not granted. Allow Whispr in System Settings > Privacy & Security > Microphone.');
        }).catch((error) => {
          reportRecordingError(error.message || 'Could not request microphone access.');
        });
      } else if (access) beginCapture();
      else reportRecordingError('Microphone access was not granted. Allow Whispr in System Settings > Privacy & Security > Microphone.');
    } catch (error) {
      reportRecordingError(error.message || 'Could not request microphone access.');
    }
    return { recording: true };
  }

  function stop() {
    if (!recording) return { recording: false };
    recording = false;
    activeMode = null;
    setTrayRecording(false);
    sendCaptureCommand({ type: 'stop' });
    return { recording: false };
  }

  async function handleCaptureEvent(event) {
    if (event?.type === 'recording-started') {
      recording = true;
      sendDashboardStatus(event);
      return;
    }
    if (event?.type === 'recording-error') {
      reportRecordingError(event.message || 'Microphone access failed.');
      return;
    }
    if (event?.type !== 'recording-stopped') return;
    recording = false;
    setTrayRecording(false);
    const recordingMode = activeMode || selectedMode;
    activeMode = null;
    sendDashboardStatus({ type: 'transcribing' });
    const duration = Number.isFinite(event.durationSeconds) ? event.durationSeconds : 0;
    let processed;
    try {
      const transcription = await provider.transcribe(
        Buffer.from(event.audioBase64 || '', 'base64'),
        event.mimeType,
        recordingMode
      );
      processed = processTranscript({ text: transcription.text, mode: recordingMode });
    } catch (error) {
      try {
        await sync.saveFailedSession({ duration, errorMessage: error.message || 'Local transcription failed' });
      } catch (saveError) {
        console.error(`Whispr failed-session sync failed: ${saveError.message}`);
      }
      showNotification('Whispr transcription error', error.message);
      sendDashboardStatus({ type: 'transcription-error', message: error.message });
      return;
    }

    const transcript = { ...processed };
    let saveError;
    try {
      const result = await sync.saveDictation({ text: processed.text, mode: recordingMode, duration });
      if (result?.transcript) Object.assign(transcript, result.transcript);
    } catch (error) {
      saveError = error;
    }

    try {
      const paste = await controller.pasteText(processed.text);
      if (!paste.ok) throw new Error(paste.error.message);
    } catch (error) {
      showNotification('Whispr transcription error', error.message);
      sendDashboardStatus({ type: 'transcription-error', message: error.message });
      return;
    }

    const window = getDashboardWindow();
    if (!window?.isDestroyed?.()) window?.webContents.send('recording:result', transcript);
    if (saveError) {
      showNotification('Whispr cloud save warning', saveError.message);
      sendDashboardStatus({ type: 'save-warning', message: saveError.message, text: processed.text });
      return;
    }

    showNotification('Whispr', 'Transcript pasted');
    sendDashboardStatus({ type: 'transcription-complete', transcript });
  }

  function trusted(event) {
    const contents=getDashboardWindow()?.webContents;
    if(!contents || event?.sender!==contents || (event.senderFrame && event.senderFrame!==contents.mainFrame))throw new Error('Untrusted window');
  }
  function registerIpc() {
    ipc.handle('auth:sign-in',async event=>{trusted(event);return desktopAuth.signIn();});
    ipc.handle('auth:get-status',async event=>{trusted(event);return desktopAuth.getStatus();});
    ipc.handle('auth:logout',async event=>{trusted(event);return desktopAuth.logout();});
    ipc.handle('api:request',async(event,request)=>{trusted(event);return desktopAuth.requestApi(request);});
    ipc.handle('recording:get-shortcut-state', () => shortcutStatus);
    ipc.handle('recording:start', (_event, { mode = 'exact' } = {}) => start(mode));
    ipc.handle('recording:stop', () => stop());
    ipc.handle('recording:set-mode', (_event, { mode = 'exact' } = {}) => setSelectedMode(mode));
    ipc.on('capture:event', (_event, event) => handleCaptureEvent(event));
  }

  function registerGlobalShortcut(shortcut = 'Command+Shift+Space') {
    const registered = shortcuts.register(shortcut, () => {
      if (recording) stop();
      else start(selectedMode);
    });
    shortcutStatus = {
      registered,
      message: registered ? '' : 'Another app owns Command+Shift+Space. Close that app or change its shortcut to use Whispr’s shortcut.'
    };
    if (!registered) {
      const message = shortcutStatus.message;
      showNotification('Whispr shortcut unavailable', message);
      setTrayRecording(false);
      sendDashboardStatus({ type: 'shortcut-error', message });
    }
    return registered;
  }

  return {
    start,
    stop,
    handleCaptureEvent,
    registerIpc,
    registerGlobalShortcut,
    isRecording: () => recording,
    setFetchImpl: (next) => { fetchImpl = next; },
    setLocalProvider: (next) => { provider = next; },
    setSync: (next) => { sync = next; }
  };
}

if (process.versions.electron && process.type === 'browser') {
  app.setName('Whispr');
  app.whenReady().then(() => {
    app.dock?.setMenu(Menu.buildFromTemplate([
      { label: 'Open Whispr', click: showDashboard }
    ]));
    try {
      showDashboard();
    } catch (error) {
      console.error('Whispr dashboard startup failed:', error);
      throw error;
    }
    appTray = createTray({
      dashboardWindow,
      getDashboard: showDashboard
    });
    const runtime = createRecordingRuntime({
      dashboardWindow,
      getDashboardWindow: () => dashboardWindow,
      tray: appTray,
      requestMicrophoneAccess: () => {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status === 'granted') return true;
        if (status === 'not-determined') return systemPreferences.askForMediaAccess('microphone');
        return false;
      }
    });
    runtime.registerIpc();
    runtime.registerGlobalShortcut();
  }).catch((error) => {
    console.error('Whispr failed to start:', error);
  });
  app.on('activate', () => {
    if (app.isReady()) showDashboard();
    else app.whenReady().then(showDashboard);
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

module.exports = { createDashboard, showDashboard, createCapture, createTray, createRecordingRuntime, getDashboardUrl, guardNavigation };
