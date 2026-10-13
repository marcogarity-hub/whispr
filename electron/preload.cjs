const { contextBridge, ipcRenderer } = require('electron');

const voiceTyping = {
  getShortcutState: () => ipcRenderer.invoke('recording:get-shortcut-state'),
  setCredentials: (username, password) => ipcRenderer.invoke('auth:set-credentials', { username, password }),
  start: (mode) => ipcRenderer.invoke('recording:start', { mode }),
  stop: () => ipcRenderer.invoke('recording:stop'),
  setMode: (mode) => ipcRenderer.invoke('recording:set-mode', { mode }),
  onStatus: (callback) => ipcRenderer.on('recording:status', (_event, status) => callback(status)),
  onResult: (callback) => ipcRenderer.on('recording:result', (_event, result) => callback(result))
};

contextBridge.exposeInMainWorld('recording', voiceTyping);
contextBridge.exposeInMainWorld('voiceTyping', voiceTyping);
