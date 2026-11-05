const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('io', {
  startServer: () => ipcRenderer.invoke('start-server'),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  restartServer: () => ipcRenderer.invoke('restart-server'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  openInBrowser: () => ipcRenderer.invoke('open-in-browser'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  copyServerUrl: () => ipcRenderer.invoke('copy-server-url'),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (event, data) => callback(data)),
  onLogLine: (callback) => ipcRenderer.on('log-line', (event, data) => callback(data)),
});
