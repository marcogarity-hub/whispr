const test = require('node:test');
const assert = require('node:assert/strict');

const { createMacOSController } = require('../electron/macos.cjs');
const { createTray, createRecordingRuntime, guardNavigation } = require('../electron/main.cjs');

test('createTray creates an idle tray with a dashboard menu action', () => {
  const trayInstances = [];
  const menus = [];
  const dashboard = { showCalls: 0, focusCalls: 0, show() { this.showCalls += 1; }, focus() { this.focusCalls += 1; } };
  class Tray {
    constructor(image) { this.image = image; this.titles = []; trayInstances.push(this); }
    setTitle(title) { this.titles.push(title); }
    setToolTip(tooltip) { this.tooltip = tooltip; }
    setContextMenu(menu) { this.menu = menu; }
  }
  const Menu = { buildFromTemplate(template) { menus.push(template); return { template }; } };
  const nativeImage = { createFromDataURL(dataUrl) { return { dataUrl, template: false, setTemplateImage(value) { this.template = value; } }; } };

  const tray = createTray({ TrayCtor: Tray, MenuCtor: Menu, nativeImageCtor: nativeImage, dashboardWindow: dashboard });

  assert.equal(trayInstances.length, 1);
  assert.match(tray.image.dataUrl, /^data:image\/svg\+xml/);
  assert.equal(tray.image.template, true);
  assert.deepEqual(tray.titles, ['Whispr']);
  assert.equal(tray.tooltip, 'Whispr voice typing');
  assert.equal(menus[0][0].label, 'Open Whispr');
  menus[0][0].click();
  assert.equal(dashboard.showCalls, 1);
  assert.equal(dashboard.focusCalls, 1);
});

test('Open Whispr recreates the dashboard after it has been closed', () => {
  const menus = [];
  const closedDashboard = { isDestroyed: () => true };
  const replacement = { showCalls: 0, focusCalls: 0, show() { this.showCalls += 1; }, focus() { this.focusCalls += 1; } };
  const tray = createTray({
    TrayCtor: class { setTitle() {} setToolTip() {} setContextMenu(menu) { this.menu = menu; } },
    MenuCtor: { buildFromTemplate(template) { menus.push(template); return { template }; } },
    nativeImageCtor: { createFromDataURL: () => ({ setTemplateImage() {} }) },
    dashboardWindow: closedDashboard,
    getDashboard: () => replacement
  });

  menus[0][0].click();

  assert.equal(tray.menu.template[0].label, 'Open Whispr');
  assert.equal(replacement.showCalls, 1);
  assert.equal(replacement.focusCalls, 1);
});

test('recording runtime sends status and results to the dashboard recreated from the tray', async () => {
  const messages = [];
  const closedDashboard = { isDestroyed: () => true, webContents: { send() { throw new Error('closed dashboard must not receive IPC'); } } };
  const replacement = {
    isDestroyed: () => false,
    show() {}, focus() {},
    webContents: { send(channel, payload) { messages.push({ channel, payload }); } }
  };
  let activeDashboard = closedDashboard;
  const menus = [];
  const tray = createTray({
    TrayCtor: class { setTitle() {} setToolTip() {} setContextMenu(menu) { this.menu = menu; } },
    MenuCtor: { buildFromTemplate(template) { menus.push(template); return { template }; } },
    nativeImageCtor: { createFromDataURL: () => ({ setTemplateImage() {} }) },
    dashboardWindow: closedDashboard,
    getDashboard: () => { activeDashboard = replacement; return replacement; }
  });
  const runtime = createRecordingRuntime({
    dashboardWindow: closedDashboard,
    getDashboardWindow: () => activeDashboard,
    createCaptureWindow: () => ({ loadFile() {}, webContents: { once() {}, send() {} } }),
    controller: { pasteText: async () => ({ ok: true }), showNotification() {} },
    localProvider: { transcribe: async () => ({ text: 'Replacement dashboard text' }) },
    sync: { saveDictation: async () => ({ transcript: { text: 'Replacement dashboard text' } }) }
  });

  menus[0][0].click();
  runtime.start('exact');
  await runtime.handleCaptureEvent({ type: 'recording-stopped', audioBase64: 'SGk=', mimeType: 'audio/webm', durationSeconds: 1 });

  assert.equal(tray.menu.template[0].label, 'Open Whispr');
  assert.deepEqual(messages, [
    { channel: 'recording:status', payload: { type: 'recording-started', mode: 'exact' } },
    { channel: 'recording:status', payload: { type: 'transcribing' } },
    { channel: 'recording:result', payload: { text: 'Replacement dashboard text', mode: 'exact', wordCount: 3 } },
    { channel: 'recording:status', payload: { type: 'transcription-complete', transcript: { text: 'Replacement dashboard text', mode: 'exact', wordCount: 3 } } }
  ]);
});

test('createTray updates the menu-bar title for recording state', () => {
  const tray = { titles: [], setTitle(title) { this.titles.push(title); } };
  const runtime = createRecordingRuntime({
    tray,
    createCaptureWindow: () => ({ loadFile() {}, webContents: { once() {}, send() {} } }),
    controller: { pasteText: async () => ({ ok: true }), showNotification() {} }
  });

  runtime.start('exact');
  runtime.stop();

  assert.deepEqual(tray.titles, ['● Whispr', 'Whispr']);
});

test('pasteText writes the transcript and asks System Events to press Command+V', async () => {
  const clipboard = { writes: [], writeText(text) { this.writes.push(text); } };
  const execCalls = [];
  const execFile = (file, args, callback) => {
    execCalls.push({ file, args });
    callback(null);
  };
  const controller = createMacOSController({ clipboard, execFile });

  const result = await controller.pasteText('Hello');

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(clipboard.writes, ['Hello']);
  assert.deepEqual(execCalls, [{
    file: 'osascript',
    args: ['-e', 'tell application "System Events" to keystroke "v" using {command down}']
  }]);
});

test('pasteText returns a structured error when osascript fails', async () => {
  const controller = createMacOSController({
    clipboard: { writes: [], writeText() {} },
    execFile: (_file, _args, callback) => callback(new Error('Accessibility denied'))
  });

  const result = await controller.pasteText('Hello');

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PASTE_FAILED');
  assert.match(result.error.message, /Accessibility denied/);
});

test('showNotification forwards title and body to Electron notification', () => {
  const notifications = [];
  class Notification {
    constructor(options) {
      notifications.push(options);
    }

    show() {}
  }
  const controller = createMacOSController({
    clipboard: { writes: [], writeText() {} },
    execFile: () => {},
    Notification
  });

  controller.showNotification('Recording', 'Listening…');

  assert.deepEqual(notifications, [{ title: 'Recording', body: 'Listening…' }]);
});

function makeRuntimeHarness() {
  const handlers = new Map();
  const listeners = new Map();
  const shortcut = { callback: null, registered: true, register(_accelerator, callback) { this.callback = callback; return this.registered; } };
  const sent = [];
  const requests = [];
  const transcriptions = [];
  const dashboard = { webContents: { send: (_channel, message) => sent.push(message) } };
  const capture = {
    loadFile() {},
    webContents: {
      once(event, callback) { listeners.set(event, callback); },
      send(_channel, command) { sent.push(command); }
    }
  };
  const controller = { notifications: [], pasteText: async () => ({ ok: true }), showNotification(title, body) { this.notifications.push({ title, body }); } };
  const ipcMain = {
    handle(channel, callback) { handlers.set(channel, callback); },
    on(channel, callback) { handlers.set(channel, callback); }
  };
  const localProvider = { transcribe: async (audio, mimeType, mode) => { transcriptions.push({ audio, mimeType, mode }); return { text: 'Hello' }; } };
  const sync = { saveDictation: async (dictation) => { requests.push(dictation); return { transcript: { text: 'Hello' } }; }, saveFailedSession: async () => ({}) };
  const runtime = createRecordingRuntime({ ipcMain, globalShortcut: shortcut, createCaptureWindow: () => capture, dashboardWindow: dashboard, controller, localProvider, sync });
  runtime.registerIpc();
  return { runtime, handlers, listeners, shortcut, sent, controller, capture, requests, transcriptions };
}

test('queues the first start command until the capture window finishes loading', () => {
  const { runtime, listeners, sent } = makeRuntimeHarness();
  runtime.start('exact');

  assert.deepEqual(sent, [{ type: 'recording-started', mode: 'exact' }]);
  listeners.get('did-finish-load')();
  assert.deepEqual(sent, [{ type: 'recording-started', mode: 'exact' }, { type: 'start' }]);
});

test('shortcut registration uses the shared start/stop transitions and notifies on start', () => {
  const { runtime, shortcut, controller, sent, listeners } = makeRuntimeHarness();
  assert.equal(runtime.registerGlobalShortcut(), true);

  shortcut.callback();
  listeners.get('did-finish-load')();
  assert.equal(runtime.isRecording(), true);
  assert.deepEqual(controller.notifications[0], { title: 'Whispr', body: 'Recording started' });
  shortcut.callback();
  assert.equal(runtime.isRecording(), false);
  assert.deepEqual(sent.filter((event) => event.type === 'start' || event.type === 'stop'), [{ type: 'start' }, { type: 'stop' }]);
});

test('shortcut registration conflict reports a dashboard status and notification', () => {
  const { runtime, shortcut, controller, sent } = makeRuntimeHarness();
  shortcut.registered = false;

  assert.equal(runtime.registerGlobalShortcut(), false);
  assert.match(controller.notifications[0].body, /Another app owns/);
  assert.deepEqual(sent.at(-1), {
    type: 'shortcut-error',
    message: 'Another app owns Command+Shift+Space. Close that app or change its shortcut to use Whispr’s shortcut.'
  });
});

test('selected mode and duration reach local transcription and authenticated text sync', async () => {
  const { runtime, handlers, listeners, sent, requests, transcriptions } = makeRuntimeHarness();
  runtime.start('polished');
  listeners.get('did-finish-load')();
  runtime.handleCaptureEvent({ type: 'recording-stopped', audioBase64: 'SGk=', mimeType: 'audio/webm', durationSeconds: 4.5 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.at(-1).type, 'transcription-complete');
  assert.equal(handlers.has('capture:event'), true);
  assert.deepEqual(transcriptions[0], { audio: Buffer.from('Hi'), mimeType: 'audio/webm', mode: 'polished' });
  assert.deepEqual(requests[0], { text: 'Hello', mode: 'polished', duration: 4.5 });
});

test('a recording keeps its starting mode when the requested mode changes before stop', async () => {
  const { runtime, listeners, requests } = makeRuntimeHarness();
  runtime.start('polished');
  runtime.start('exact');
  listeners.get('did-finish-load')();
  await runtime.handleCaptureEvent({ type: 'recording-stopped', audioBase64: 'SGk=', mimeType: 'audio/webm', durationSeconds: 2 });

  assert.equal(requests[0].mode, 'polished');
});

test('dashboard mode selection reaches a shortcut recording without changing its in-flight mode', async () => {
  const { runtime, handlers, listeners, shortcut, requests } = makeRuntimeHarness();
  runtime.registerGlobalShortcut();

  await handlers.get('recording:set-mode')(null, { mode: 'polished' });
  shortcut.callback();
  await handlers.get('recording:set-mode')(null, { mode: 'exact' });
  listeners.get('did-finish-load')();
  await runtime.handleCaptureEvent({ type: 'recording-stopped', audioBase64: 'SGk=', mimeType: 'audio/webm', durationSeconds: 2 });

  assert.equal(requests[0].mode, 'polished');
});

test('capture transcription failures report error status without pasting', async () => {
  const { runtime, listeners, sent, controller } = makeRuntimeHarness();
  runtime.start('exact');
  listeners.get('did-finish-load')();
  runtime.setSync({ saveFailedSession: async () => ({}) });
  runtime.setFetchImpl(async () => ({ ok: false, json: async () => ({ error: 'provider unavailable' }) }));
  const originalProvider = { transcribe: async () => { throw new Error('provider unavailable'); } };
  runtime.setLocalProvider?.(originalProvider);
  await runtime.handleCaptureEvent({ type: 'recording-stopped', audioBase64: 'SGk=', mimeType: 'audio/webm', durationSeconds: 1 });
  assert.deepEqual(sent.at(-1), { type: 'transcription-error', message: 'provider unavailable' });
  assert.equal(controller.pasteText.mockCalled, undefined);
});

test('desktop authentication IPC accepts only the trusted dashboard and never returns bearer credentials', async () => {
 const handlers=new Map(),trustedContents={};const dashboard={webContents:trustedContents};
 const desktopAuth={signIn:async()=>({user:{id:'bob'}}),getStatus:async()=>({user:{id:'bob'}}),logout:async()=>({ok:true}),requestApi:async()=>({ok:true,status:200,payload:{}}),getAuthorization:()=> 'Bearer secret'};
 const runtime=createRecordingRuntime({dashboardWindow:dashboard,getDashboardWindow:()=>dashboard,desktopAuth,ipcMain:{handle:(channel,handler)=>handlers.set(channel,handler),on(){}},sync:{},controller:{showNotification(){}}});
 runtime.registerIpc();
 await assert.rejects(handlers.get('auth:sign-in')({sender:{}}),/Untrusted window/);
 const result=await handlers.get('auth:sign-in')({sender:trustedContents});
 assert.deepEqual(result,{user:{id:'bob'}});assert.equal(JSON.stringify(result).includes('secret'),false);
 assert.deepEqual(await handlers.get('auth:logout')({sender:trustedContents}),{ok:true});
});

test('dashboard navigation guards block cross-origin redirects', () => {
  const blocked = { prevented: false, preventDefault() { this.prevented = true; } };
  const allowed = { prevented: false, preventDefault() { this.prevented = true; } };

  guardNavigation(blocked, 'https://attacker.example/login', 'https://whispr.vercel.app');
  guardNavigation(allowed, 'https://whispr.vercel.app/account', 'https://whispr.vercel.app');

  assert.equal(blocked.prevented, true);
  assert.equal(allowed.prevented, false);
});

test('cloud save failure still pastes local text and reports save-warning', async () => {
  const sent = [];
  const pasted = [];
  const notifications = [];
  const dashboard = { webContents: { send(_channel, event) { sent.push(event); } } };
  const runtime = createRecordingRuntime({
    dashboardWindow: dashboard,
    createCaptureWindow: () => ({ loadFile() {}, webContents: { once() {}, send() {} } }),
    localProvider: { transcribe: async () => ({ text: 'Hello   there' }) },
    sync: { saveDictation: async () => { throw new Error('API unavailable'); }, saveFailedSession: async () => ({}) },
    controller: { pasteText: async (text) => { pasted.push(text); return { ok: true }; }, showNotification(title, message) { notifications.push({ title, message }); } }
  });
  runtime.start('exact');
  await runtime.handleCaptureEvent({ type: 'recording-stopped', audioBase64: 'SGk=', mimeType: 'audio/webm', durationSeconds: 1 });

  assert.deepEqual(pasted, ['Hello there']);
  assert.equal(sent.at(-1).type, 'save-warning');
  assert.equal(sent.some((event) => event.type === 'transcription-error'), false);
  assert.deepEqual(notifications.at(-1), { title: 'Whispr cloud save warning', message: 'API unavailable' });
});

test('local transcription failure records one failed session when sync is reachable', async () => {
  const sessions = [];
  const sent = [];
  const dashboard = { webContents: { send(_channel, event) { sent.push(event); } } };
  const runtime = createRecordingRuntime({
    dashboardWindow: dashboard,
    localProvider: { transcribe: async () => { throw new Error('whisper unavailable'); } },
    sync: { saveDictation: async () => ({}) , saveFailedSession: async (session) => { sessions.push(session); return { status: 'error' }; } },
    controller: { pasteText: async () => ({ ok: true }), showNotification() {} }
  });
  await runtime.handleCaptureEvent({ type: 'recording-stopped', audioBase64: 'SGk=', mimeType: 'audio/webm', durationSeconds: 2 });

  assert.deepEqual(sessions, [{ duration: 2, errorMessage: 'whisper unavailable' }]);
  assert.deepEqual(sent.at(-1), { type: 'transcription-error', message: 'whisper unavailable' });
});

test('main-process desktop session is used for text sync bearer header', async () => {
  const trustedContents = { send() {} };
  const requests = [];
  const dashboard = { webContents: trustedContents };
  const handlers = new Map();
  const authenticatedRuntime = createRecordingRuntime({
    dashboardWindow: dashboard,
    ipcMain: { handle(channel, callback) { handlers.set(channel, callback); }, on() {} },
    localProvider: { transcribe: async () => ({ text: 'Hello' }) },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ transcript: { text: 'Hello' }, session: { status: 'success' } }), { status: 201 });
    },
    controller: { pasteText: async () => ({ ok: true }), showNotification() {} },
    apiUrl: 'https://whispr.example',
    desktopAuth:{getAuthorization:()=> 'Bearer desktop-session',getStatus:async()=>({user:{id:'bob'}})}
  });
  authenticatedRuntime.registerIpc();
  await handlers.get('auth:get-status')({sender:trustedContents});
  await authenticatedRuntime.handleCaptureEvent({ type: 'recording-stopped', audioBase64: 'SGk=', mimeType: 'audio/webm', durationSeconds: 1 });

  assert.equal(requests.at(-1).url, 'https://whispr.example/api/dictations');
  assert.equal(requests.at(-1).options.headers.authorization, 'Bearer desktop-session');
});
