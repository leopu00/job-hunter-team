const { contextBridge, ipcRenderer } = require('electron')

// Exposed synchronously at preload time so the renderer can paint the
// platform-specific skeleton on first paint, without waiting for the
// async setup:get-docker-status IPC round-trip. Removing this brings
// back the "macOS checklist flashes then swaps to Windows UI" bug — the
// skeleton paint at boot depends on knowing the platform without IPC.
contextBridge.exposeInMainWorld('platformInfo', {
  platform: process.platform,
  arch: process.arch,
})

// Logger esposto al renderer: ogni window.jhtLog.<level>(event, meta)
// viene serializzato e mandato al main via canale `log:append`, che lo
// scrive nello stesso file di log del processo main. Cosi' un bug report
// contiene il flusso completo (click UI → IPC → modulo backend).
//
// Safe: fire-and-forget (ipcRenderer.send, no invoke), errori swallowati.
function sendLog(level, event, meta, scope) {
  try {
    ipcRenderer.send('log:append', { level, event, meta, scope })
  } catch {
    // ignore — non vogliamo mai che il logger faccia crashare il renderer
  }
}
contextBridge.exposeInMainWorld('jhtLog', {
  debug: (event, meta) => sendLog('debug', event, meta),
  info: (event, meta) => sendLog('info', event, meta),
  warn: (event, meta) => sendLog('warn', event, meta),
  error: (event, meta) => sendLog('error', event, meta),
  // Helper per loggare con namespace (es. window.jhtLog.scope('wizard')).
  scope: (name) => ({
    debug: (event, meta) => sendLog('debug', event, meta, name),
    info: (event, meta) => sendLog('info', event, meta, name),
    warn: (event, meta) => sendLog('warn', event, meta, name),
    error: (event, meta) => sendLog('error', event, meta, name),
  }),
})

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
  devLaunch: () => ipcRenderer.invoke('dev:launch'),
  devIsAvailable: () => ipcRenderer.invoke('dev:is-available'),
  devProbe: () => ipcRenderer.invoke('dev:probe'),
  devStop: () => ipcRenderer.invoke('dev:stop'),
  devAdditionalListWorktrees: () => ipcRenderer.invoke('dev-additional:list-worktrees'),
  devAdditionalLaunch: (args) => ipcRenderer.invoke('dev-additional:launch', args),
  devAdditionalStop: (args) => ipcRenderer.invoke('dev-additional:stop', args),
  devAdditionalListActive: () => ipcRenderer.invoke('dev-additional:list-active'),
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
  openDockerDownloadCompany: () => ipcRenderer.invoke('setup:open-docker-download-page'),
  openDockerDesktop: () => ipcRenderer.invoke('setup:open-docker-desktop'),
  startColima: () => ipcRenderer.invoke('setup:start-colima'),
  installDocker: () => ipcRenderer.invoke('setup:install-docker'),
  installWindowsStack: () => ipcRenderer.invoke('setup:install-windows-stack'),
  reboot: () => ipcRenderer.invoke('setup:reboot'),
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

contextBridge.exposeInMainWorld('authApi', {
  getStatus: () => ipcRenderer.invoke('auth:get-status'),
  signIn: (provider) => ipcRenderer.invoke('auth:sign-in', provider),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  // Used by the (upcoming) VPS provisioning wizard to feed
  // `install.sh --pairing-token <token>`. Renderer-side: treat the
  // returned string as an opaque blob; never log it.
  getPairingToken: () => ipcRenderer.invoke('auth:get-pairing-token'),
})

// Lightweight key/value store backed by JSON in app.getPath('userData').
// Used by the onboarding wizard to persist the `location` choice so a
// relaunch resumes on the right branch. Not a general settings API —
// keep it small and renderer-only.
contextBridge.exposeInMainWorld('prefsApi', {
  get: (key) => ipcRenderer.invoke('prefs:get', key),
  set: (key, value) => ipcRenderer.invoke('prefs:set', key, value),
})

contextBridge.exposeInMainWorld('vpsApi', {
  generateKey: (args) => ipcRenderer.invoke('vps:generate-key', args),
  getPublicKey: () => ipcRenderer.invoke('vps:get-public-key'),
  hasKey: () => ipcRenderer.invoke('vps:has-key'),
  // SSH into the user's freshly-created VPS and stream install.sh
  // output back via onInstallLog. The token comes from authApi
  // automatically (main side) so no secret leaves the IPC boundary.
  runInstall: (args) => ipcRenderer.invoke('vps:run-install', args),
  onInstallLog: (callback) => {
    const listener = (_event, line) => {
      try { callback(line) } catch { /* ignore */ }
    }
    ipcRenderer.on('vps:install-log', listener)
    return () => ipcRenderer.removeListener('vps:install-log', listener)
  },
})

contextBridge.exposeInMainWorld('syncApi', {
  getStatus: () => ipcRenderer.invoke('sync:get-status'),
  setup: (args) => ipcRenderer.invoke('sync:setup', args),
  unlock: (args) => ipcRenderer.invoke('sync:unlock', args),
  lock: () => ipcRenderer.invoke('sync:lock'),
  push: (args) => ipcRenderer.invoke('sync:push', args),
  pull: (args) => ipcRenderer.invoke('sync:pull', args),
  disable: (args) => ipcRenderer.invoke('sync:disable', args),
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
