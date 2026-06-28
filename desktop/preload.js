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
  // [JHT-VPS-TUNNEL] Cockpit VPS via tunnel SSH (dashboard in-app, non cloud).
  openVpsCockpit: (ip) => ipcRenderer.invoke('vps:open-cockpit', { ip }),
  tunnelStatus: () => ipcRenderer.invoke('tunnel:status'),
  tunnelClose: () => ipcRenderer.invoke('tunnel:close'),
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

// [JHT-DASHBOARD-NATIVE] API dati per le viste native della dashboard (lane
// renderer dev1). Il main fa il fetch autenticato al runtime locale (no CORS
// da file://) e ritorna { ok, positions|... , error }. Contratto in
// coordination/chat.jsonl (23:26/23:31).
contextBridge.exposeInMainWorld('dashboardApi', {
  // [generico] get(path) → JSON del body dell'API runtime, o null se runtime
  // giù / non-2xx. Copre TUTTE le sezioni native (offerte/candidature/stats/
  // mappa/attività…). Solo path "/api/..." (validato nel main). Contratto dev1.
  get: (path) => ipcRenderer.invoke('dashboard:get', path),
  // [interazione] post(path, body) → POST autenticato (es. chat agenti:
  // post('/api/capitano/chat', { message })). → { ok, ...data } | { ok:false, error }.
  post: (path, body) => ipcRenderer.invoke('dashboard:post', { path, body }),
  // → { ok, positions: [...], error? } — positions sempre array.
  listPositions: (opts) => ipcRenderer.invoke('dashboard:list-positions', opts || {}),
  // → { ok, position, score, highlights, company, application, error? }
  getPosition: (id) => ipcRenderer.invoke('dashboard:get-position', { id }),
  // → { ok, ...stats, error? } — riepilogo (totali/score medi) per header/empty-state.
  getStats: () => ipcRenderer.invoke('dashboard:get-stats'),
})

// [ONBOARDING] Orari di lavoro del team. Scritti in ~/.jht/jht.config.json
// (team.working_hours) dal main — niente web, il server non gira ancora a
// onboarding. wh = { timezone, windows:[{days,start,end}] } | null (=24/7).
contextBridge.exposeInMainWorld('teamApi', {
  getWorkingHours: () => ipcRenderer.invoke('team:get-working-hours'),
  setWorkingHours: (wh) => ipcRenderer.invoke('team:set-working-hours', wh),
  // VPS mode: stessi orari ma sul container remoto via SSH. args = { vpsIp,
  // working_hours }. Usato dal wizard quando location === 'vps'.
  getWorkingHoursVps: (args) => ipcRenderer.invoke('team:get-working-hours-vps', args),
  setWorkingHoursVps: (args) => ipcRenderer.invoke('team:set-working-hours-vps', args),
})

// [ONBOARDING] Upload documenti del profilo (CV + obiettivi). Il main apre il
// file-picker nativo e copia i file nella drop-zone allegati (bind /jht_user)
// che l'Assistente legge al boot. → { ok, files:[{name,size}], error? }.
contextBridge.exposeInMainWorld('profileApi', {
  uploadDocs: () => ipcRenderer.invoke('profile:upload-docs'),
  listDocs: () => ipcRenderer.invoke('profile:list-docs'),
  // VPS mode: file-picker locale → upload nella drop-zone allegati REMOTA
  // via SSH. args = { vpsIp }. → { ok, files:[{name,size}], error? }.
  uploadDocsVps: (args) => ipcRenderer.invoke('profile:upload-docs-vps', args),
  listDocsVps: (args) => ipcRenderer.invoke('profile:list-docs-vps', args),
})

// [chat] Invio messaggio a un agente (capitano/assistente) via docker exec
// tmux send-keys nel main — il POST web è read-only col port-map. La history
// (incl. risposte agente) si legge via dashboardApi.get('/api/<agent>/chat').
contextBridge.exposeInMainWorld('chatApi', {
  send: (agent, text) => ipcRenderer.invoke('chat:send', { agent, text }),
})

// [agent control] Kill / restart di un singolo agente dal pannello Agents
// (via docker exec nel main). → { ok, error? }.
contextBridge.exposeInMainWorld('agentApi', {
  stop: (role) => ipcRenderer.invoke('agent:stop', { role }),
  restart: (role) => ipcRenderer.invoke('agent:restart', { role }),
})

contextBridge.exposeInMainWorld('setupApi', {
  getStatus: () => ipcRenderer.invoke('setup:get-status'),
  getDockerStatus: () => ipcRenderer.invoke('setup:get-docker-status'),
  getExtraDeps: () => ipcRenderer.invoke('setup:get-extra-deps'),
  openDockerDownloadPage: () => ipcRenderer.invoke('setup:open-docker-download-page'),
  openDockerDesktop: () => ipcRenderer.invoke('setup:open-docker-desktop'),
  startColima: () => ipcRenderer.invoke('setup:start-colima'),
  startDockerDesktop: () => ipcRenderer.invoke('setup:start-docker-desktop'),
  getContainerRuntime: () => ipcRenderer.invoke('setup:get-container-runtime'),
  setContainerRuntime: (choice) =>
    ipcRenderer.invoke('setup:set-container-runtime', { choice }),
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
  // Args: { host, vpsIp } opzionale. host='vps' + vpsIp → check via SSH.
  getAuthStates: (args) => ipcRenderer.invoke('setup:get-auth-states', args),
  // arg: stringa (back-compat local) o { providerId, host, vpsIp }.
  logoutProvider: (arg) => ipcRenderer.invoke('setup:logout-provider', arg),
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
  cancelSignIn: () => ipcRenderer.invoke('auth:cancel-sign-in'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  // Subscribe to the OAuth URL emitted right before main opens it
  // in the default browser. Renderer uses this to expose a "Copy
  // link" fallback (in case the browser fails to open, or the user
  // wants to paste the URL into a different browser without the
  // wrong Google session). Returns an unsubscribe fn.
  onUrlReady: (callback) => {
    const handler = (_event, payload) => {
      try { callback(payload) } catch { /* ignore */ }
    }
    ipcRenderer.on('auth:url-ready', handler)
    return () => ipcRenderer.removeListener('auth:url-ready', handler)
  },
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
  // Reveal the SSH keypair folder so the user can share the private
  // key file with a beta tester / second machine (the public key
  // alone is NOT enough — the SSH client needs the private key).
  openKeyFolder: () => ipcRenderer.invoke('vps:open-key-folder'),
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
  // Scrive un file di config sulla VPS via SSH (default
  // /root/.jht/jht.config.json, mode 0600, atomic). Usato dal wizard
  // step di sync config in VPS mode (T4).
  writeConfig: (args) => ipcRenderer.invoke('vps:write-config', args),
})

// Telegram bot setup (VPS-only path): /getMe verification, chat_id
// auto-capture via long-poll getUpdates, and atomic merge-then-write of
// the 3 bots into /root/.jht/jht.config.json on the VPS. All HTTPS to
// api.telegram.org and SSH writes happen in main — renderer stays
// CSP-clean.
contextBridge.exposeInMainWorld('telegramApi', {
  verifyBot: (token) => ipcRenderer.invoke('telegram:verify-bot', token),
  waitForChatId: (token, deadlineMs) =>
    ipcRenderer.invoke('telegram:wait-for-chat', { token, deadlineMs }),
  cancelWaitForChatId: (token) =>
    ipcRenderer.invoke('telegram:cancel-wait-for-chat', token),
  saveBotsToVps: (args) => ipcRenderer.invoke('telegram:save-to-vps', args),
  // [ONBOARDING locale] Salva i bot nel jht.config.json locale (~/.jht).
  saveBotsLocal: (bots) => ipcRenderer.invoke('telegram:save-local', { bots }),
})

// Provider config writer (active_provider + providers.<name>.auth_method)
// remoto. Chiamato dal wizard subito dopo che provider-install si chiude
// con successo, così pid1+start-agent.sh trovano già `active_provider`
// al primo boot del container (fix bug "provider non riconosciuto").
contextBridge.exposeInMainWorld('providerApi', {
  saveToVps: (args) => ipcRenderer.invoke('provider:save-to-vps', args),
})

// Email del team: casella job-alert dedicata. Le credenziali si salvano in
// locale (~/.jht/credentials/email_monitor.json), mai sul cloud.
contextBridge.exposeInMainWorld('emailApi', {
  getStatus: () => ipcRenderer.invoke('email:get-status'),
  saveConfig: (args) => ipcRenderer.invoke('email:save-config', args),
  deleteConfig: () => ipcRenderer.invoke('email:delete-config'),
  // [ONBOARDING] Valida round-trip (IMAP login + SMTP invio + IMAP rilettura)
  // e, su successo, salva le credenziali. → { ok, stage?, error?, looksPersonal }.
  validate: (args) => ipcRenderer.invoke('email:validate', args),
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
  // Signal "I have subscribed to data/exit, flush the buffer".
  // Race-free: renderer must subscribe via onData/onExit BEFORE
  // calling attach. Main buffers everything between start() and
  // attach() so no chunk is lost in transit.
  attach: (sessionId) => ipcRenderer.invoke('terminal:attach', sessionId),
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
