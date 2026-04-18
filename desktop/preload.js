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
  getStatus: () => ipcRenderer.invoke('setup:get-status'),
  getDockerStatus: () => ipcRenderer.invoke('setup:get-docker-status'),
  getExtraDeps: () => ipcRenderer.invoke('setup:get-extra-deps'),
  openDockerDownloadPage: () => ipcRenderer.invoke('setup:open-docker-download-page'),
  openDockerDesktop: () => ipcRenderer.invoke('setup:open-docker-desktop'),
  installDocker: () => ipcRenderer.invoke('setup:install-docker'),
  openBrewHomepage: () => ipcRenderer.invoke('setup:open-brew-homepage'),
  onInstallLog: (callback) => {
    const listener = (_event, message) => {
      try { callback(message) } catch { /* ignore */ }
    }
    ipcRenderer.on('setup:install-log', listener)
    return () => ipcRenderer.removeListener('setup:install-log', listener)
  },
  onInstallStage: (callback) => {
    const listener = (_event, payload) => {
      try { callback(payload) } catch { /* ignore */ }
    }
    ipcRenderer.on('setup:install-stage', listener)
    return () => ipcRenderer.removeListener('setup:install-stage', listener)
  },
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
  getAuthStates: () => ipcRenderer.invoke('setup:get-auth-states'),
  logoutProvider: (providerId) => ipcRenderer.invoke('setup:logout-provider', providerId),
  getSelection: () => ipcRenderer.invoke('setup:get-selection'),
  saveSelection: (selection) => ipcRenderer.invoke('setup:save-selection', selection),
  onProviderLog: (callback) => {
    const listener = (_event, message) => {
      try { callback(message) } catch { /* ignore */ }
    }
    ipcRenderer.on('setup:provider-log', listener)
    return () => ipcRenderer.removeListener('setup:provider-log', listener)
  },
})

contextBridge.exposeInMainWorld('clipboardApi', {
  read: () => ipcRenderer.invoke('clipboard:read'),
  write: (text) => ipcRenderer.invoke('clipboard:write', text),
})

contextBridge.exposeInMainWorld('terminalApi', {
  start: (opts) => ipcRenderer.invoke('terminal:start', opts),
  write: (sessionId, data) => ipcRenderer.send('terminal:write', { sessionId, data }),
  resize: (sessionId, cols, rows) => ipcRenderer.send('terminal:resize', { sessionId, cols, rows }),
  kill: (sessionId) => ipcRenderer.invoke('terminal:kill', sessionId),
  onData: (sessionId, cb) => {
    const channel = `terminal:data:${sessionId}`
    const listener = (_event, data) => { try { cb(data) } catch { /* ignore */ } }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onExit: (sessionId, cb) => {
    const channel = `terminal:exit:${sessionId}`
    const listener = (_event, exit) => { try { cb(exit) } catch { /* ignore */ } }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
