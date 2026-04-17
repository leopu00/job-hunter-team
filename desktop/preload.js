const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launcherApi', {
  getStatus: () => ipcRenderer.invoke('launcher:get-status'),
  inspectSetup: () => ipcRenderer.invoke('launcher:inspect-setup'),
  getLogFile: () => ipcRenderer.invoke('launcher:get-log-file'),
  getPayloadDir: () => ipcRenderer.invoke('launcher:get-payload-dir'),
  ensurePayload: (options) => ipcRenderer.invoke('launcher:ensure-payload', options),
  start: (options) => ipcRenderer.invoke('launcher:start', options),
  stop: () => ipcRenderer.invoke('launcher:stop'),
  openBrowser: () => ipcRenderer.invoke('launcher:open-browser'),
  openExternal: (url) => ipcRenderer.invoke('launcher:open-external', url),
  onPayloadLog: (callback) => {
    const listener = (_event, message) => {
      try {
        callback(message)
      } catch {
        // ignore listener errors
      }
    }
    ipcRenderer.on('launcher:payload-log', listener)
    return () => ipcRenderer.removeListener('launcher:payload-log', listener)
  },
})

contextBridge.exposeInMainWorld('setupApi', {
  getDockerStatus: () => ipcRenderer.invoke('setup:get-docker-status'),
  getExtraDeps: () => ipcRenderer.invoke('setup:get-extra-deps'),
  openDockerDownloadPage: () => ipcRenderer.invoke('setup:open-docker-download-page'),
  openDockerDesktop: () => ipcRenderer.invoke('setup:open-docker-desktop'),
  ensureContainer: () => ipcRenderer.invoke('setup:ensure-container'),
  onContainerLog: (callback) => {
    const listener = (_event, message) => {
      try { callback(message) } catch { /* ignore */ }
    }
    ipcRenderer.on('setup:container-log', listener)
    return () => ipcRenderer.removeListener('setup:container-log', listener)
  },
  installProviders: (ids) => ipcRenderer.invoke('setup:install-providers', ids),
  getProviders: () => ipcRenderer.invoke('setup:get-providers'),
  onProviderLog: (callback) => {
    const listener = (_event, message) => {
      try { callback(message) } catch { /* ignore */ }
    }
    ipcRenderer.on('setup:provider-log', listener)
    return () => ipcRenderer.removeListener('setup:provider-log', listener)
  },
})
