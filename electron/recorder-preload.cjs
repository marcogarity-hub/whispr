const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capture', {
  onCommand: (callback) => ipcRenderer.on('capture:command', (_event, command) => callback(command)),
  send: (event) => ipcRenderer.send('capture:event', event)
});
