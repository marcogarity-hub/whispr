const { contextBridge, ipcRenderer } = require('electron');

const voiceTyping = {
  getShortcutState: () => ipcRenderer.invoke('recording:get-shortcut-state'),
  signIn: () => ipcRenderer.invoke('auth:sign-in'),
  getAuthStatus: () => ipcRenderer.invoke('auth:get-status'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  requestApi: request => ipcRenderer.invoke('api:request', request),
  start: (mode) => ipcRenderer.invoke('recording:start', { mode }),
  stop: () => ipcRenderer.invoke('recording:stop'),
  setMode: (mode) => ipcRenderer.invoke('recording:set-mode', { mode }),
  onStatus: callback => {const listener=(_event,status)=>callback(status);ipcRenderer.on('recording:status',listener);return ()=>ipcRenderer.removeListener('recording:status',listener);},
  onResult: callback => {const listener=(_event,result)=>callback(result);ipcRenderer.on('recording:result',listener);return ()=>ipcRenderer.removeListener('recording:result',listener);}
};

contextBridge.exposeInMainWorld('recording', voiceTyping);
contextBridge.exposeInMainWorld('voiceTyping', voiceTyping);
