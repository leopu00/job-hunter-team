const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launcherApi', {
  getStatus: () => ipcRenderer.invoke('launcher:get-status'),
  inspectSetup: () => ipcRenderer.invoke('launcher:inspect-setup'),
  getLogFile: () => ipcRenderer.invoke('launcher:get-log-file'),
  start: (options) => ipcRenderer.invoke('launcher:start', options),
  stop: () => ipcRenderer.invoke('launcher:stop'),
  openBrowser: () => ipcRenderer.invoke('launcher:open-browser'),
})
