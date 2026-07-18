const path = require('node:path')
const { spawn } = require('node:child_process')
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron')
const log = require('./logger')

// macOS GUI apps launched from Finder/Launchpad inherit a sanitized PATH
// that excludes /opt/homebrew/bin and /usr/local/bin. Every spawn/execFile
// we make (docker, colima, brew, git, ...) would then fail with ENOENT
// even though the binaries are installed. Patch the main process PATH
// once at boot so every child inherits the right PATH. Done here (not in
// each module) so third-party dependencies that shell out internally
// also work.
if (process.platform === 'darwin') {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin']
  const current = process.env.PATH || ''
  const parts = current.split(':').filter(Boolean)
  for (const dir of extra.reverse()) {
    if (!parts.includes(dir)) parts.unshift(dir)
  }
  process.env.PATH = parts.join(':')
}

// Last-resort safety net. Without these, an unhandled throw/rejection in the
// main process crashes the whole app silently mid-onboarding — the user is
// left staring at a frozen window with no idea why. Log it (so we can debug
// from the file) and, once, surface a dialog instead of vanishing. We do NOT
// force-quit: for a setup wizard, staying open so the user can read the error
// and retry beats a hard exit.
let fatalDialogShown = false
function reportFatal(kind, err) {
  const message = err && (err.stack || err.message) ? (err.stack || err.message) : String(err)
  try { log.child('main').error(`fatal.${kind}`, { message }) } catch (_) {}
  try {
    if (!fatalDialogShown && dialog && typeof dialog.showErrorBox === 'function') {
      fatalDialogShown = true
      dialog.showErrorBox(
        'JHT Desktop — errore imprevisto',
        `Si è verificato un errore imprevisto (${kind}).\n\n` +
          `${(err && err.message) || message}\n\n` +
          'Il dettaglio completo è nel file di log. Puoi riprovare o riavviare l\'app.',
      )
    }
  } catch (_) { /* dialog non disponibile (pre-ready): il log basta */ }
}
process.on('uncaughtException', (err) => reportFatal('uncaughtException', err))
process.on('unhandledRejection', (reason) => reportFatal('unhandledRejection', reason))

// Dev convenience: when running unpackaged (npm run dev) with a sibling
// web/ checkout, auto-enable the live bind mount so edits to /web show
// up in the container instantly via Next HMR. Temporary — remove once
// we lock the image pipeline for end-users.
// Disabled on Windows: NTFS→WSL2 bind mounts don't grant write access to
// the container `jht` user, so Turbopack crashes with EPERM on .next/*.
// Opt-in manually by setting JHT_DEV_WEB_DIR / JHT_DEV_REPO_DIR.
if (!app.isPackaged && process.platform !== 'win32' && !('JHT_DEV_WEB_DIR' in process.env)) {
  const siblingWeb = path.resolve(__dirname, '..', 'web')
  if (require('node:fs').existsSync(path.join(siblingWeb, 'package.json'))) {
    process.env.JHT_DEV_WEB_DIR = siblingWeb
  }
}
if (!app.isPackaged && process.platform !== 'win32' && !('JHT_DEV_REPO_DIR' in process.env)) {
  const repoRoot = path.resolve(__dirname, '..')
  if (require('node:fs').existsSync(path.join(repoRoot, '.launcher', 'start-agent.sh'))) {
    process.env.JHT_DEV_REPO_DIR = repoRoot
  }
}
const { createRuntimeManager } = require('./runtime')
const containerRuntime = require('./container')
const payload = require('./payload')
const dockerInstaller = require('./docker-installer')
const winInstaller = require('./win-installer/install')
const deps = require('./deps')
const containerPrep = require('./container-prep')
const providerInstall = require('./provider-install')
const providerStore = require('./provider-store')
const providerAuth = require('./provider-auth')
const terminal = require('./terminal')
const auth = require('./auth')
const sync = require('./sync')
const vps = require('./vps')
const tunnel = require('./vps/tunnel')
const telegram = require('./telegram')
const remoteConfig = require('./vps/remote-config')
const emailVerify = require('./email-verify')
const { freeBytes, formatBytes } = require('./disk-space')

function getBindHomeDir() {
  return path.join(require('node:os').homedir(), '.jht')
}

// [JHT-DASHBOARD-NATIVE] Le viste native del renderer NON possono fetchare
// http://localhost:PORT/api da file:// (CORS + niente cookie). Il MAIN fa il
// fetch (Node, no CORS), autenticando con il local-token che il container
// vede montato in /jht_home (= ~/.jht/.local-token via getBindHomeDir), e
// ritorna JSON al renderer via IPC. Contratto concordato con dev1 in
// coordination/chat.jsonl: dashboard:list-positions / dashboard:get-position.
function readLocalToken() {
  try {
    const tokenPath = path.join(getBindHomeDir(), '.local-token')
    return require('node:fs').readFileSync(tokenPath, 'utf8').trim()
  } catch (err) {
    log.warn('dashboard.local-token-read-failed', { err: err && (err.message || String(err)) })
    return null
  }
}

// Fetch autenticato verso l'API del runtime locale. Ritorna sempre un oggetto
// { ok, ...data | error } — mai throw — così il renderer gestisce gli errori
// senza try/catch e la destrutturazione del data (es. {positions}) resta valida.
// init opzionale: { method, body } per il POST (es. invio chat all'agente).
// Default GET. Il body viene serializzato JSON con Content-Type adeguato.
async function dashboardApiFetch(apiPath, init = {}) {
  let status
  try {
    status = await runtime.getStatus()
  } catch (err) {
    return { ok: false, error: 'runtime-status-failed' }
  }
  const port = status && status.port
  if (!port || (status.mode !== 'running' && status.mode !== 'external')) {
    return { ok: false, error: `runtime-not-ready:${status ? status.mode : 'unknown'}` }
  }
  const token = readLocalToken()
  const method = init.method || 'GET'
  const timeoutMs = typeof init.timeoutMs === 'number' ? init.timeoutMs : 15000
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  // Same-origin per la guardia CSRF del web (web/lib/csrf.ts): senza un Origin
  // valido i POST/PUT/DELETE prendono 403. NB: NON si può usare il `fetch` di
  // Electron (stack Chromium) perché `Origin` è un header "forbidden" e viene
  // scartato silenziosamente → resta l'Origin opaco e la guardia rifiuta.
  // Usiamo quindi node:http, che lascia impostare Origin liberamente; lo
  // mettiamo = origin del server locale (in STATIC_ALLOWED) → same-origin OK.
  headers['Origin'] = `http://127.0.0.1:${port}`
  let bodyStr = null
  if (init.body !== undefined && method !== 'GET') {
    bodyStr = JSON.stringify(init.body)
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(bodyStr)
  }
  const http = require('node:http')
  return await new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: apiPath, method, headers, timeout: timeoutMs },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          const code = res.statusCode || 0
          if (code < 200 || code >= 300) {
            resolve({ ok: false, error: `http-${code}`, status: code })
            return
          }
          // Alcune route (POST chat) possono rispondere senza JSON: tollera il vuoto.
          try {
            resolve({ ok: true, data: data ? JSON.parse(data) : {} })
          } catch {
            resolve({ ok: true, data: {} })
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (err) => resolve({ ok: false, error: err && (err.message || String(err)) }))
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// [team auto-start] Avvia il TEAM completo (core: Capitano/Sentinella/Assistente/
// Mentor; poi il Capitano scala i worker) appena il container locale è healthy.
// Il container parte in modalità `dashboard` (solo Next + Assistente), quindi
// senza questo passo il resto del team non si avvia mai.
//
// IMPORTANTE: NON si usa l'endpoint web /api/team/start-all. Il controllo del
// team è gated server-side a `isLocalRequest()` (web/lib/team-bus.ts), che è
// FALSO attraverso il port-map di Docker → 403 read_only. Il canale corretto
// desktop→team è eseguire la CLI DENTRO il container (`docker exec`), come fa
// già provider-install. Comando idempotente: salta le sessioni tmux già attive.
// Fire-and-forget: il bootstrap ha pre-delay interni (~40s) ma non blocchiamo
// la UI; l'output va al pannello log del container.
function ensureTeamStarted() {
  const name = containerRuntime.DEFAULT_CONTAINER_NAME || 'jht'
  try {
    const child = spawn(
      'docker',
      ['exec', name, 'node', '/app/cli/bin/jht.js', 'team', 'start'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const onLine = (buf) => {
      const line = String(buf).replace(/\[[0-9;]*m/g, '').trimEnd()
      if (line) broadcastContainerLog(line)
    }
    if (child.stdout) child.stdout.on('data', onLine)
    if (child.stderr) child.stderr.on('data', onLine)
    child.on('error', (err) => log.warn('[team] start exec error', { err: String(err) }))
    child.on('exit', (code) => log.info('[team] start exec exit', { code }))
  } catch (err) {
    log.warn('[team] start crashed', { err: String(err) })
  }
}

// Avvia il runtime locale (container/dashboard) + il team completo. Estratto
// dall'handler `launcher:start` così lo riusa anche l'auto-start al boot.
// runtime.startRuntime è idempotente: adotta un container detached già su
// (sopravvissuto a un restart) invece di rilanciarlo.
async function startTeamRuntime(options = {}) {
  try {
    syncJhtConfig()
  } catch (error) {
    // Non-fatal: l'agent-boot ha un fallback Claude-subscription, quindi un
    // config mancante/parziale fa solo cadere l'utente sul provider di default.
    broadcastContainerLog(`syncJhtConfig failed: ${error?.message ?? error}`)
  }
  const status = await runtime.startRuntime(options)
  // Container/dashboard pronto → avvia il team completo (il container parte in
  // modalità dashboard: senza questo si vedrebbe solo l'Assistente). Fire-and-
  // forget: gli agenti salgono in ~30s, la pagina Agents li mostra man mano.
  if (status && (status.mode === 'running' || status.mode === 'external')) {
    ensureTeamStarted()
  }
  return status
}

// Setup completo = un provider salvato (stesso criterio del renderer
// isSetupComplete: providers.saved>0). Niente provider → l'app è ancora nel
// wizard, non auto-avviare nulla.
function isSetupCompleteMain() {
  try {
    const sel = providerStore.readSelection(app.getPath('userData'))
    return !!(sel && sel.provider)
  } catch {
    return false
  }
}

// [autostart] Opt-in: al boot, se l'utente l'ha abilitato (pref autoStartTeam,
// default OFF perché consuma token) e il setup è completo, avvia il team senza
// click su "Start". Skip in VPS mode (il team gira sulla VPS) e se un container
// è già su (detached sopravvissuto al restart → la home lo adotta da sola).
async function maybeAutoStartTeam() {
  try {
    if (readPref('location') === 'vps') return
    if (readPref('autoStartTeam') !== true) return
    if (!isSetupCompleteMain()) return
    if (containerRuntime.isContainerRunning()) return
    log.info('autostart.starting')
    await startTeamRuntime({})
  } catch (err) {
    log.warn('autostart.failed', { err: String(err) })
  }
}

// [team status] Stato live degli agenti calcolato lato desktop via
// `docker exec ... tmux list-sessions`. NB: NON si usa GET /api/agents del web:
// quella route, attraverso il port-map Docker, vede isLocalRequest()=false →
// ramo "remote" che NON controlla tmux e riporta tutto 'stopped' (legge da
// Supabase). Stessa radice del gate read_only sul controllo team. Qui leggiamo
// direttamente le sessioni tmux nel container. Ritorna { agents:[...] } o null
// se il container non c'è / nessun server tmux → il caller fa fallback al web
// (copre VPS e team fermo). Forma compatibile con renderer loadAgents.
const TEAM_AGENTS = [
  { id: 'capitano', name: 'Capitano', session: 'CAPITANO' },
  { id: 'sentinella', name: 'Sentinella', session: 'SENTINELLA' },
  { id: 'assistente', name: 'Assistente', session: 'ASSISTENTE' },
  { id: 'scout', name: 'Scout', session: 'SCOUT' },
  { id: 'analista', name: 'Analista', session: 'ANALISTA' },
  { id: 'scorer', name: 'Scorer', session: 'SCORER' },
  { id: 'scrittore', name: 'Scrittore', session: 'SCRITTORE' },
  { id: 'critico', name: 'Critico', session: 'CRITICO' },
]
function teamAgentsStatus() {
  const name = containerRuntime.DEFAULT_CONTAINER_NAME || 'jht'
  let sessions
  try {
    const out = require('node:child_process')
      .execFileSync('docker', ['exec', name, 'tmux', 'list-sessions', '-F', '#{session_name}'], {
        timeout: 5000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString()
    sessions = out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    // Container assente o nessun server tmux (team fermo) → fallback al web.
    return null
  }
  const agents = TEAM_AGENTS.map((a) => {
    // Conta la sessione esatta + le istanze numerate (es. SCOUT-1) e i worker
    // (es. SENTINELLA-WORKER) che il Capitano/Sentinella spawnano.
    const instances = sessions.filter(
      (s) => s === a.session || s.startsWith(`${a.session}-`),
    ).length
    return { ...a, status: instances > 0 ? 'running' : 'stopped', instances }
  })
  return { agents, source: 'docker-exec' }
}

// Renderer preferences store. Lives in app.getPath('userData') so it
// survives uninstall/upgrade (see feedback_no_user_data_wipe.md) and
// does not couple to ~/.jht, which may not exist yet at onboarding
// time. Single JSON file keyed by short strings; reads return null if
// missing or unreadable. Atomic-ish writes via temp-rename to avoid a
// half-written file if the process is killed mid-write.
function getPrefsPath() {
  return path.join(app.getPath('userData'), 'preferences.json')
}

function readPrefsFile() {
  const fs = require('node:fs')
  try {
    const raw = fs.readFileSync(getPrefsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function readPref(key) {
  if (typeof key !== 'string' || !key) return null
  const data = readPrefsFile()
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
}

function writePref(key, value) {
  if (typeof key !== 'string' || !key) return { ok: false, error: 'invalid-key' }
  const fs = require('node:fs')
  const data = readPrefsFile()
  data[key] = value
  const target = getPrefsPath()
  const tmp = `${target}.tmp`
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, target)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

// Map desktop-side provider id → the active_provider value that
// .launcher/start-agent.sh (running inside the container) expects.
// Codex is "openai" in that config because the start-agent script
// dispatches on the vendor, not the product name.
const DESKTOP_TO_LAUNCHER_PROVIDER = {
  claude: 'claude',
  codex: 'openai',
  kimi: 'kimi',
}

// ~/.jht/jht.config.json è il file di config che il container legge (bind su
// /jht_home). Più sorgenti scrivono campi diversi: il provider scelto
// (active_provider/providers) e gli orari di lavoro del team
// (team.working_hours, scelti nell'onboarding). Per non sovrascriverci a
// vicenda leggiamo-mergiamo-scriviamo invece di rigenerare il file da zero.
function getJhtConfigPath() {
  return path.join(getBindHomeDir(), 'jht.config.json')
}

function readJhtConfig() {
  try {
    const raw = require('node:fs').readFileSync(getJhtConfigPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeJhtConfig(config) {
  const bindHomeDir = getBindHomeDir()
  require('node:fs').mkdirSync(bindHomeDir, { recursive: true })
  require('node:fs').writeFileSync(
    getJhtConfigPath(),
    JSON.stringify(config, null, 2) + '\n',
  )
}

// Cartella drop-zone dove l'utente carica CV + documenti del profilo. Bind su
// /jht_user nel container (vedi container.js: -v $userDir:/jht_user, env
// JHT_USER_DIR=/jht_user) → l'Assistente la ingerisce al boot del team. Stessa
// risoluzione path di container.js così host e container vedono lo stesso dir.
function getUserUploadsDir() {
  const home = require('node:os').homedir()
  const userDir =
    process.env.JHT_USER_DIR_HOST || path.join(home, 'Documents', 'Job Hunter Team')
  return path.join(userDir, 'allegati')
}

// Normalizzazione difensiva degli orari di lavoro scelti nel wizard.
// Accetta null/{} (=24/7) o {timezone, windows:[{days,start,end}]} e ritorna
// { timezone, windows } | null. Condivisa fra il save locale (~/.jht) e
// quello VPS (jht.config.json remoto via SSH) così le due strade producono
// lo stesso schema che legge working_hours.py al boot.
function normalizeWorkingHours(working_hours) {
  if (!working_hours || typeof working_hours !== 'object') return null
  const tz = typeof working_hours.timezone === 'string' && working_hours.timezone
    ? working_hours.timezone
    : 'UTC'
  const windows = Array.isArray(working_hours.windows)
    ? working_hours.windows
        .filter((w) => w && Array.isArray(w.days) && w.days.length &&
          typeof w.start === 'string' && typeof w.end === 'string')
        .map((w) => ({ days: w.days, start: w.start, end: w.end }))
    : []
  return { timezone: tz, windows }
}

// Salva i 3 bot Telegram nel jht.config.json LOCALE (channels.telegram.bots),
// stessa forma che telegram/index.js scrive sul VPS. Usato dall'onboarding in
// modalità locale (il container legge ~/.jht via bind). Merge-preserve.
function saveTelegramBotsLocal(bots) {
  if (!bots || typeof bots !== 'object') return { ok: false, error: 'bots-missing' }
  const config = readJhtConfig()
  config.channels =
    config.channels && typeof config.channels === 'object' ? config.channels : {}
  config.channels.telegram =
    config.channels.telegram && typeof config.channels.telegram === 'object'
      ? config.channels.telegram
      : {}
  if (
    !config.channels.telegram.bots ||
    typeof config.channels.telegram.bots !== 'object'
  ) {
    config.channels.telegram.bots = {}
  }
  for (const key of Object.keys(bots)) {
    const entry = bots[key]
    if (!entry || !entry.token) continue
    const rec = { bot_token: entry.token }
    if (entry.chatId) rec.chat_id = String(entry.chatId)
    config.channels.telegram.bots[key] = rec
  }
  try {
    writeJhtConfig(config)
    log.info('[onboarding] telegram bots saved (local)', {
      botKeys: Object.keys(config.channels.telegram.bots),
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err && (err.message || String(err)) }
  }
}

// Export the user's chosen provider/plan to ~/.jht/jht.config.json so
// the agent-boot script inside the container can pick the right CLI
// and load the right identity file (CLAUDE.md for Claude, AGENTS.md
// for Codex / Kimi). Written right before `docker run` on Start Team.
// Merge-preserve: NON tocca team.* (es. working_hours) né altri campi.
function syncJhtConfig() {
  const selection = providerStore.readSelection(require('electron').app.getPath('userData'))
  if (!selection?.provider) return false
  const activeProvider = DESKTOP_TO_LAUNCHER_PROVIDER[selection.provider] || selection.provider
  const config = readJhtConfig()
  config.active_provider = activeProvider
  config.plan = selection.plan ?? null
  config.providers = {
    ...(config.providers && typeof config.providers === 'object' ? config.providers : {}),
    [activeProvider]: { auth_method: 'subscription' },
  }
  writeJhtConfig(config)
  return true
}

// -------- Email del team (casella job-alert dedicata) --------
// Le credenziali della casella che il team legge vivono in
// ~/.jht/credentials/email_monitor.json (bind-mount nel container) e le legge
// shared/skills/email_monitor.py. Mai sul cloud: scrittura SOLO locale.
function getEmailCredsPath() {
  return path.join(getBindHomeDir(), 'credentials', 'email_monitor.json')
}

// IMAP host dal dominio dell'email per i provider comuni; fallback imap.<dominio>
// così funziona anche con domini custom senza chiedere l'host all'utente.
function deriveImapHost(email) {
  const domain = (String(email).split('@')[1] || '').toLowerCase()
  const KNOWN = {
    'gmail.com': 'imap.gmail.com',
    'googlemail.com': 'imap.gmail.com',
    'outlook.com': 'outlook.office365.com',
    'hotmail.com': 'outlook.office365.com',
    'live.com': 'outlook.office365.com',
    'yahoo.com': 'imap.mail.yahoo.com',
    'icloud.com': 'imap.mail.me.com',
    'me.com': 'imap.mail.me.com',
  }
  if (KNOWN[domain]) return KNOWN[domain]
  return domain ? `imap.${domain}` : 'imap.gmail.com'
}

function readEmailStatus() {
  const fs = require('node:fs')
  try {
    const raw = JSON.parse(fs.readFileSync(getEmailCredsPath(), 'utf8'))
    return {
      configured: !!raw.user,
      email: raw.user || null,
      host: raw.imap_host || null,
      anyPlatform: !Array.isArray(raw.from_filters) || raw.from_filters.length === 0,
      savedAt: raw.savedAt || null,
    }
  } catch {
    return { configured: false, email: null, host: null, anyPlatform: true, savedAt: null }
  }
}

function saveEmailConfig({ email, password } = {}) {
  const fs = require('node:fs')
  const addr = String(email || '').trim()
  // Le app-password Google sono mostrate a gruppi di 4 con spazi: rimuovili.
  const pw = String(password || '').replace(/\s+/g, '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return { ok: false, error: 'invalid-email' }
  if (pw.length < 8) return { ok: false, error: 'invalid-password' }
  const creds = {
    imap_host: deriveImapHost(addr),
    imap_port: 993,
    user: addr,
    password: pw,
    folder: 'INBOX',
    from_filters: [],
    savedAt: Date.now(),
  }
  const target = getEmailCredsPath()
  const tmp = `${target}.tmp`
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, target)
    return { ok: true, email: addr, host: creds.imap_host }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

function deleteEmailConfig() {
  const fs = require('node:fs')
  const target = getEmailCredsPath()
  try {
    if (!fs.existsSync(target)) return { ok: false, error: 'not-configured' }
    fs.unlinkSync(target)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

let mainWindow = null
let dashboardWindow = null
let runtime = null
let payloadDir = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    // Start hidden and reveal maximized on ready-to-show, so the user never
    // sees the small centered window flash before it fills the screen.
    show: false,
    autoHideMenuBar: true,
    title: 'JHT Desktop',
    backgroundColor: '#0d1411',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // [JHT-DASHBOARD-SPLIT] La dashboard locale è EMBEDDED nel pannello Team
      // come <webview> puntata a localhost:PORT (decisione utente: una sola
      // finestra, niente più openDashboardWindow per il local). Abilita il tag.
      webviewTag: true,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Open maximized: fill the screen's work area but NOT native macOS
  // fullscreen (the green-button Space). The user wants a normal window,
  // anchored to the current desktop, just sized to the whole screen.
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.maximize()
    mainWindow.show()
  })

  // If the renderer process dies (OOM, crash, GPU fault) the window goes
  // white with no feedback. Log it and tell the user how to recover instead
  // of leaving a blank screen. Not an auto-reload: a reload would wipe the
  // in-memory wizard state, so we let the user decide to restart.
  const mainLog = log.child('main')
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    mainLog.error('renderer.gone', { reason: details && details.reason, exitCode: details && details.exitCode })
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'JHT Desktop',
        message: 'La finestra si è chiusa in modo imprevisto.',
        detail: 'Riavvia l\'app per riprendere il setup. Il progresso salvato (lingua, provider) non va perso.',
        buttons: ['Riavvia', 'Chiudi'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) { app.relaunch(); app.exit(0) }
      }).catch(() => {})
    } catch (_) { /* dialog non disponibile */ }
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // -3 = ERR_ABORTED, normale su navigazioni annullate: ignora.
    if (errorCode === -3) return
    mainLog.error('renderer.did-fail-load', { errorCode, errorDescription, validatedURL })
  })

  // Dev: apri DevTools detached per vedere i log del renderer fianco
  // alla finestra. Solo da sorgente, mai in build packaged.
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // In production block Ctrl+R / Ctrl+Shift+R / F5: a renderer reload
  // resets the in-memory wizard state mid-onboarding, which is hostile
  // UX for end users (and easy to trigger by accident). Devs still
  // get the shortcut when running `electron .` from source.
  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const key = (input.key || '').toLowerCase()
      const isReload =
        (key === 'r' && (input.control || input.meta)) ||
        key === 'f5'
      if (isReload) event.preventDefault()
    })
  }

  // Force every link/URL open to go through the host's default browser
  // via shell.openExternal. Without this, Electron would happily spawn
  // a nested BrowserWindow for things like window.open(...) — which
  // would not carry the user's existing session cookies (e.g. Google
  // OAuth) and force them to log in again.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL() && /^https?:\/\//i.test(url)) {
      event.preventDefault()
      shell.openExternal(url).catch(() => {})
    }
  })

  // [JHT-DASHBOARD-SPLIT] Hardening della <webview> embedded (dashboard locale
  // nel pannello Team). La webview carica localhost:PORT servito dal Next nel
  // container; non deve avere accesso privilegiato né poter aprire finestre
  // annidate o navigare via verso siti arbitrari.
  // 1) sanitizza le prefs in fase di attach: nessun preload, no Node, isolata.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
  })
  // 2) sul webContents della webview: popup/target=_blank/window.open → browser
  //    di sistema (mai BrowserWindow annidate); navigazioni top-level verso host
  //    NON locali → browser di sistema (la dashboard è una SPA su localhost, le
  //    navigazioni interne restano dentro la webview).
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    })
    guest.on('will-navigate', (event, url) => {
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url)
      if (!isLocal && /^https?:\/\//i.test(url)) {
        event.preventDefault()
        shell.openExternal(url).catch(() => {})
      }
    })
  })
}

function broadcastPayloadLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:payload-log', String(message))
  }
}

function broadcastContainerLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:container-log', String(message))
  }
}

function broadcastProviderLog(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:provider-log', String(message))
  }
}

function broadcastInstallLog(message) {
  const text = String(message)
  // Persist install output on disk too: senza questo l'unica traccia di un
  // setup fallito è nella UI, che sparisce quando l'utente chiude la finestra
  // (ci ha reso ciechi a un bug reale di install). Le righe vanno a `debug`.
  log.child('setup').debug('install.log', { line: text.slice(0, 500) })
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:install-log', text)
  }
}

function broadcastInstallStage(stage, status) {
  const level = status === 'fail' ? 'error' : 'info'
  log.child('setup')[level]('install.stage', { stage, status })
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:install-stage', { stage, status })
  }
}

// Se il runtime è in fase 'warming' (Next boota + Turbopack pre-compila
// le pagine chiave) aspettiamo il completamento prima di aprire il
// browser. Così l'utente arriva su una pagina pronta, invece di trovarsi
// 404 o pagine bianche che si materializzano dopo 5-15s.
async function waitForWarmUpDone(maxWaitMs = 75000) {
  const started = Date.now()
  while (Date.now() - started < maxWaitMs) {
    const s = await runtime.getStatus()
    if (s.mode === 'running' || s.mode === 'external') return s
    if (s.mode === 'error' || s.mode === 'stopped') return s
    // Propaga il progress alla UI Electron così l'utente vede "Preparazione 2/5…"
    if (mainWindow && !mainWindow.isDestroyed() && s.warmingProgress) {
      mainWindow.webContents.send('launcher:warming-progress', s.warmingProgress)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return runtime.getStatus()
}

// [JHT-DASHBOARD-SPLIT] La dashboard LOCALE vive DENTRO l'app desktop: una
// BrowserWindow dedicata puntata alla view locale (localhost:port), NON più
// `localhost:3000` aperto in un browser di sistema. Così "una data istanza è
// una modalità sola, sempre" → sparisce l'ambiguità "quali dati / dove scrivo".
// (La modalità VPS resta su openExternal verso la dashboard cloud finché non
// arriva [JHT-VPS-TUNNEL]; questo path è invocato solo dal ramo locale.)
//
// Niente preload qui: la dashboard è una normale web-app, non deve toccare
// le API privilegiate del launcher (contextIsolation on, nodeIntegration off).
// La sessione di default è condivisa con il launcher (cookie/localStorage).
function openDashboardWindow(url) {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    if (dashboardWindow.isMinimized()) dashboardWindow.restore()
    dashboardWindow.focus()
    return dashboardWindow
  }
  dashboardWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'Job Hunter Team',
    backgroundColor: '#0d1411',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // [JHT-VPS-TUNNEL] sandbox esplicito: la finestra carica contenuto web
      // remoto (dashboard VPS via tunnel) e non ha preload → nessun bisogno di
      // Node nel renderer. Esplicito > implicito anche se è già il default.
      sandbox: true,
    },
  })

  // Popup / link target=_blank (es. annunci di lavoro, link esterni) →
  // browser di sistema, mai una finestra Electron annidata. Le navigazioni
  // top-level (SPA interna + eventuale redirect OAuth) restano IN finestra:
  // non intercettiamo `will-navigate` apposta, così il login web — se mai
  // servisse in local cloud-paired — completa il giro dentro la finestra.
  dashboardWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (/^https?:\/\//i.test(openUrl)) {
      shell.openExternal(openUrl).catch(() => {})
    }
    return { action: 'deny' }
  })

  dashboardWindow.on('closed', () => {
    dashboardWindow = null
  })

  if (!app.isPackaged) {
    dashboardWindow.webContents.openDevTools({ mode: 'detach' })
  }

  dashboardWindow.loadURL(url)
  return dashboardWindow
}

async function openRuntimeInBrowser() {
  let status = await runtime.getStatus()
  if (status.mode !== 'running' && status.mode !== 'external') {
    status = await runtime.startRuntime({ port: status.port })
  }
  // `startRuntime` ora blocca fino a 'running' ma se il runtime era già
  // in avvio (gestito altrove) il nostro status potrebbe essere
  // 'warming'. In quel caso attendiamo il completamento.
  if (status.mode === 'warming') {
    status = await waitForWarmUpDone()
  }

  if (status.running && (status.mode === 'running' || status.mode === 'external')) {
    // [JHT-DASHBOARD-SPLIT] In-app window invece del browser di sistema.
    // Fallback robusto: se la creazione/caricamento della finestra fallisce,
    // ricadiamo su openExternal così l'utente non resta mai senza dashboard.
    try {
      openDashboardWindow(status.url)
    } catch (err) {
      log.warn('dashboard-window.failed', { err: err && (err.message || String(err)) })
      await shell.openExternal(status.url)
    }
  }

  return status
}

// [JHT-VPS-TUNNEL] Allow-list dell'identità VPS: il desktop apre un tunnel SSH
// (che dà alla VPS il trattamento "locale" = controllo pieno) SOLO verso la VPS
// configurata in prefs.vpsIp, mai verso un IP arbitrario passato dal renderer.
// Difesa in profondità: se il renderer fosse compromesso non può dirottare il
// tunnel su un host attaccante. Se prefs.vpsIp non è ancora persistita non c'è
// identità da imporre → si lascia passare (resta la validazione IPv4 in ssh-exec).
function assertKnownVpsIp(ip) {
  const known = readPref('vpsIp')
  if (!known) return { ok: true }
  if (typeof ip !== 'string' || ip.trim() !== String(known).trim()) {
    return { ok: false, error: 'ip non corrisponde alla VPS configurata (prefs.vpsIp)' }
  }
  return { ok: true }
}

// [JHT-VPS-TUNNEL] Cockpit su VPS: apre (o riusa) il tunnel SSH verso `ip` e
// punta la finestra dashboard a localhost:<localPort>. Il container sulla VPS
// serve lo stesso stack Next "locale"; via tunnel l'Host resta `localhost`,
// quindi la VPS tratta le richieste come LOCALI → controllo pieno come se il
// team girasse sul PC. Entra da /dashboard ([JHT-ONBOARDING-IN-GAME 18/07]:
// la pagina /onboarding non esiste più, l'onboarding vive nel videogioco).
async function openVpsCockpit(ip) {
  const allow = assertKnownVpsIp(ip)
  if (!allow.ok) return { ok: false, error: allow.error }
  const res = await tunnel.openTunnel({ ip })
  if (!res.ok || !res.url) {
    return { ok: false, error: res.error || 'tunnel non disponibile' }
  }
  try {
    openDashboardWindow(`${res.url}/dashboard`)
  } catch (err) {
    log.warn('vps-cockpit.window-failed', { err: err && (err.message || String(err)) })
    return { ok: false, error: err && (err.message || String(err)) }
  }
  return { ok: true, ...tunnel.getStatus() }
}

app.whenReady().then(() => {
  // Inizializza il file logger PRIMA di tutto: cosi' anche gli errori del
  // boot (payload, runtime manager) finiscono su disco. Path:
  // app.getPath('userData')/logs/jht-desktop-<ts>.log. Rotation a 10 file.
  const logInit = log.init(app)
  log.info('app.ready', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
    logFile: logInit.file,
    locale: app.getLocale(),
  })

  // Lifecycle: chiudi pulito anche i log quando l'utente esce, cosi' un
  // crash subito dopo non lascia righe a meta'.
  app.on('window-all-closed', () => log.info('app.window-all-closed'))
  app.on('before-quit', () => log.info('app.before-quit'))
  app.on('will-quit', () => log.info('app.will-quit'))

  // Modalita' "fresh setup": JHT_DESKTOP_FRESH_SETUP=1 al boot wipa le
  // cache utente che fanno skippare step gia' completati, cosi' il
  // wizard riparte da Welcome come prima volta. Utile per testare il
  // flow di onboarding senza dover cancellare a mano:
  //   - preferences.json (location, eventuali altri toggle)
  //   - providers.json (THE discriminator setup-complete: se ha
  //     provider.saved.length > 0 l'app salta il wizard e va in home —
  //     vedi desktop/renderer/modules/home.js → isSetupComplete)
  //   - ssh/ (keypair Ed25519 generata dal passo VPS)
  //   - session/ (storage Supabase auth in mode 'file', packaged-unsigned)
  //   - sync/ (meta storage cloud sync in mode 'file')
  //   - logs/ (log delle sessioni precedenti)
  //
  // Non tocca: session Supabase in-memory (dev — gia' volatile),
  // app-payload/ (download cache pesante, niente senso wipare).
  if (process.env.JHT_DESKTOP_FRESH_SETUP === '1') {
    const fs = require('node:fs')
    const userData = app.getPath('userData')
    const targets = [
      path.join(userData, 'preferences.json'),
      path.join(userData, 'providers.json'),
      path.join(userData, 'ssh'),
      path.join(userData, 'session'),
      path.join(userData, 'sync'),
      // NOTA: NON wipiamo logs/ qui — il logger ha gia' aperto il file
      // della sessione corrente e cancellare la dir → ENOENT al prossimo
      // write (uncaughtException). La rotation interna gestisce i file
      // vecchi (max 10). Per pulire i log a mano: rm -rf "<userData>/logs"
      // PRIMA di lanciare l'app.
    ]
    for (const t of targets) {
      try {
        const stat = fs.lstatSync(t)
        if (stat.isDirectory()) {
          fs.rmSync(t, { recursive: true, force: true })
        } else {
          fs.unlinkSync(t)
        }
        log.warn('fresh-setup.wiped', { path: t })
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          log.debug('fresh-setup.skip', { path: t, reason: 'not present' })
        } else {
          log.error('fresh-setup.failed', { path: t, err })
        }
      }
    }
    log.warn('fresh-setup.complete', {
      hint: "unset JHT_DESKTOP_FRESH_SETUP per il prossimo run",
    })
  }

  // Canale IPC `log:append` — il renderer (wizard, dashboard) puo' mandare
  // log strutturati che finiscono nello stesso file del main, cosi' un
  // bug report ha il flow completo (UI step → IPC → modulo backend).
  // Vedi preload.js → window.jhtLog per l'API esposta al renderer.
  ipcMain.on('log:append', (event, payload = {}) => {
    const level = ['debug', 'info', 'warn', 'error'].includes(payload.level)
      ? payload.level
      : 'info'
    const scope = `renderer${payload.scope ? '.' + payload.scope : ''}`
    const event_ = String(payload.event || 'unknown')
    const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : undefined
    log.child(scope)[level](event_, meta)
  })

  payloadDir = path.join(app.getPath('userData'), 'app-payload')
  runtime = createRuntimeManager({
    containerMode: containerRuntime.shouldUseContainer(),
    payloadDir,
    // macOS: which container runtime the user picked (Colima / Docker Desktop /
    // auto). Read fresh at each Start so a switch from settings applies without
    // an app restart. No-op on Linux/Windows (the runtime ignores it there).
    getContainerRuntimeChoice: () =>
      readPref('containerRuntime') || containerRuntime.DEFAULT_RUNTIME,
  })

  ipcMain.handle('launcher:get-status', () => runtime.getStatus())
  // Espone il path del log file del main process al renderer (per UI
  // "Open log folder" e bug reports). Diverso da launcher:get-log-file
  // che ritorna il log del container runtime.
  ipcMain.handle('launcher:get-app-log-file', () => ({
    file: log.getLogFile(),
    dir: log.getLogDir(),
  }))
  ipcMain.handle('launcher:inspect-setup', () => runtime.inspectSetup())
  ipcMain.handle('launcher:get-log-file', () => runtime.getLogFile())
  ipcMain.handle('launcher:get-payload-dir', () => ({
    payloadDir,
    present: payload.isPayloadPresent(payloadDir),
  }))
  ipcMain.handle('launcher:ensure-payload', async (_event, options = {}) => {
    try {
      const result = await payload.ensurePayload({
        payloadDir,
        updateIfPresent: options.update === true,
        logger: broadcastPayloadLog,
      })
      return { ok: true, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastPayloadLog(`Errore: ${message}`)
      return { ok: false, error: message }
    }
  })
  ipcMain.handle('launcher:open-browser', () => openRuntimeInBrowser())

  // [JHT-DASHBOARD-NATIVE] IPC per le viste native della dashboard (lane dev1
  // renderer). Il main fa il fetch autenticato al runtime locale e ritorna
  // { ok, ...data | error }. Vedi readLocalToken/dashboardApiFetch.
  ipcMain.handle('dashboard:list-positions', async (_event, { limit = 50 } = {}) => {
    const n = Math.max(1, Math.min(500, Number(limit) || 50))
    const r = await dashboardApiFetch(`/api/positions/recent?limit=${n}`)
    // Shape concordata: { ok, positions:[...] , error? }. positions sempre array.
    return r.ok ? { ok: true, positions: (r.data && r.data.positions) || [] } : { ok: false, error: r.error, positions: [] }
  })
  ipcMain.handle('dashboard:get-position', async (_event, { id } = {}) => {
    if (!id) return { ok: false, error: 'missing-id' }
    const r = await dashboardApiFetch(`/api/positions/${encodeURIComponent(id)}`)
    return r.ok ? { ok: true, ...r.data } : { ok: false, error: r.error }
  })
  // Riepilogo per l'header/empty-state della dashboard nativa (/api/stats → 200
  // verificato live). Utile anche con 0 offerte. Extra rispetto al contratto base.
  ipcMain.handle('dashboard:get-stats', async () => {
    const r = await dashboardApiFetch('/api/stats')
    return r.ok ? { ok: true, ...r.data } : { ok: false, error: r.error }
  })
  // [JHT-DASHBOARD-NATIVE] Proxy GENERICO per scalare a MOLTE sezioni native
  // senza un canale IPC per ognuna (contratto concordato con dev1, 23:38):
  // window.dashboardApi.get(path) → il main fa GET http://127.0.0.1:PORT+path
  // autenticato col local-token e ritorna il JSON del body, oppure null se il
  // runtime è giù / risposta non-2xx / parse fallito (le viste mostrano empty-state).
  // SICUREZZA: solo path che iniziano per "/api/", nessun "://" o ".." → niente
  // SSRF verso host arbitrari, resta confinato all'API del runtime locale.
  ipcMain.handle('dashboard:get', async (_event, apiPath) => {
    if (typeof apiPath !== 'string' || !apiPath.startsWith('/api/') ||
        apiPath.includes('://') || apiPath.includes('..')) {
      return null
    }
    // Stato agenti: calcolato lato desktop via docker exec (il web /api/agents
    // è cieco sulle tmux attraverso il port-map → riporta tutto 'stopped').
    // Fallback al web se il container non c'è (VPS / team fermo).
    if (apiPath === '/api/agents') {
      const local = teamAgentsStatus()
      if (local) return local
    }
    const r = await dashboardApiFetch(apiPath)
    return r.ok ? r.data : null
  })
  // [JHT-DASHBOARD-NATIVE] POST generico per l'INTERAZIONE (es. chat con gli
  // agenti: POST /api/capitano/chat → tmux send-keys). Stessa validazione path
  // + auth Bearer del get(). Ritorna { ok, ...data } | { ok:false, error }.
  ipcMain.handle('dashboard:post', async (_event, { path: apiPath, body } = {}) => {
    if (typeof apiPath !== 'string' || !apiPath.startsWith('/api/') ||
        apiPath.includes('://') || apiPath.includes('..')) {
      return { ok: false, error: 'invalid-path' }
    }
    const r = await dashboardApiFetch(apiPath, { method: 'POST', body: body ?? {} })
    return r.ok ? { ok: true, ...r.data } : { ok: false, error: r.error, status: r.status }
  })

  // [chat] Invio messaggio utente a un agente. NB: NON via POST /api/<agent>/chat
  // del web — quella route è gated da requireLocalWrite()→isLocalRequest(), FALSO
  // col port-map Docker → 403 read_only (il messaggio non arriva mai all'agente).
  // Canale corretto = docker exec tmux send-keys (no shell → niente quoting).
  // L'agente risponde via la skill chat-web scrivendo in chat.jsonl, che il poll
  // della UI rilegge via GET /api/<agent>/chat (requireAuth col token → ok).
  const CHAT_SESSIONS = { capitano: 'CAPITANO', assistente: 'ASSISTENTE' }
  ipcMain.handle('chat:send', async (_event, { agent, text } = {}) => {
    const session = CHAT_SESSIONS[agent]
    if (!session) return { ok: false, error: 'invalid-agent' }
    const t = typeof text === 'string' ? text.trim() : ''
    if (!t) return { ok: false, error: 'empty' }
    const name = containerRuntime.DEFAULT_CONTAINER_NAME || 'jht'
    const payload = `[@utente -> @${agent}] [CHAT] ${t}`
    const ts = Date.now() / 1000
    const jsonLine = JSON.stringify({ role: 'user', text: t, ts }) + '\n'
    // Path di chat.jsonl DENTRO il container (JHT_HOME=/jht_home, sia locale
    // che VPS). In locale è bind su ~/.jht; in VPS vive solo sul container
    // remoto → si scrive via docker exec.
    const remoteChatFile = `/jht_home/agents/${agent}/chat.jsonl`

    // VPS mode: il container è REMOTO → tmux/persist via SSH+docker exec, non
    // docker exec locale (che fallisce: nessun container `jht` sul Mac). Era il
    // motivo per cui la chat non funzionava in VPS mode (setup b3).
    const vpsIp = readPref('location') === 'vps' ? readPref('vpsIp') : null
    if (vpsIp) {
      const SshExec = require('./vps/ssh-exec')
      try {
        // 1) Persisti il msg utente in chat.jsonl (docker exec -i → cat >>):
        // l'input via stdin evita ogni quoting del testo utente, e il file
        // resta con l'owner del container. Best-effort.
        const persist = SshExec.run(
          vpsIp,
          `docker exec -i ${name} sh -c 'cat >> ${remoteChatFile}'`,
          { input: jsonLine, timeout: 15000 },
        )
        if (!persist.ok) log.warn('[chat] vps persist failed', { stderr: persist.stderr })
        // 2) Invia il messaggio alla sessione tmux. load-buffer da stdin +
        // paste-buffer evita il quoting del payload attraverso la shell remota
        // (send-keys -- payload via SSH sarebbe a rischio escaping).
        const load = SshExec.run(
          vpsIp,
          `docker exec -i ${name} tmux load-buffer -`,
          { input: payload, timeout: 15000 },
        )
        if (!load.ok) return { ok: false, error: load.stderr || 'vps-load-buffer-failed' }
        const paste = SshExec.run(
          vpsIp,
          `docker exec ${name} tmux paste-buffer -t ${session} && docker exec ${name} tmux send-keys -t ${session} Enter`,
          { timeout: 15000 },
        )
        if (!paste.ok) return { ok: false, error: paste.stderr || 'vps-send-failed' }
        log.info('[chat] sent (vps)', { agent })
        return { ok: true, ts }
      } catch (err) {
        return { ok: false, error: err && (err.message || String(err)) }
      }
    }

    // Local mode: persisti il messaggio utente in chat.jsonl (bind
    // ~/.jht/agents/<agent>/) così sopravvive al ri-render della UI (cambio
    // tab) invece di restare solo un echo temporaneo. Il renderer userà `ts`
    // per allineare lastTs ed evitare il doppione con l'echo ottimistico.
    // Stesso formato che scrive la skill chat-web. Best-effort.
    try {
      const fs = require('node:fs')
      const chatFile = path.join(getBindHomeDir(), 'agents', agent, 'chat.jsonl')
      fs.mkdirSync(path.dirname(chatFile), { recursive: true })
      fs.appendFileSync(chatFile, jsonLine, 'utf8')
    } catch (e) {
      log.warn('[chat] persist-user-msg failed', { err: e && (e.message || String(e)) })
    }
    const { execFileSync } = require('node:child_process')
    const opts = { timeout: 8000, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] }
    try {
      // payload come singolo argv dopo `--` → tmux lo invia letterale, nessun
      // problema di escaping (execFileSync non passa da una shell).
      execFileSync('docker', ['exec', name, 'tmux', 'send-keys', '-t', session, '--', payload], opts)
      execFileSync('docker', ['exec', name, 'tmux', 'send-keys', '-t', session, 'Enter'], opts)
      log.info('[chat] sent', { agent })
      return { ok: true, ts }
    } catch (err) {
      return { ok: false, error: err && (err.message || String(err)) }
    }
  })

  // [agent control] Kill / restart di un singolo agente dal pannello Agents.
  // Via docker exec (il controllo team via web è read-only col port-map). Kill =
  // tmux kill-session della sessione base + istanze (es. SCOUT-1). Restart =
  // kill poi `start-agent.sh <role>` (lo stesso che usa il bootstrap del team).
  const AGENT_SESSION = {
    capitano: 'CAPITANO', sentinella: 'SENTINELLA', assistente: 'ASSISTENTE',
    mentor: 'MENTOR', scout: 'SCOUT', analista: 'ANALISTA', scorer: 'SCORER',
    scrittore: 'SCRITTORE', critico: 'CRITICO',
  }
  function dockerExecAgent(args, opts = {}) {
    const name = containerRuntime.DEFAULT_CONTAINER_NAME || 'jht'
    return require('node:child_process').execFileSync('docker', ['exec', name, ...args], {
      timeout: opts.timeout || 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })
  }
  function killAgentSessions(role) {
    const base = AGENT_SESSION[role]
    if (!base) return
    let sessions = []
    try {
      sessions = dockerExecAgent(['tmux', 'list-sessions', '-F', '#{session_name}'])
        .toString().split('\n').map((s) => s.trim()).filter(Boolean)
    } catch { return }
    for (const s of sessions) {
      if (s === base || s.startsWith(`${base}-`)) {
        try { dockerExecAgent(['tmux', 'kill-session', '-t', s]) } catch { /* ignore */ }
      }
    }
  }
  ipcMain.handle('agent:stop', (_event, { role } = {}) => {
    if (!AGENT_SESSION[role]) return { ok: false, error: 'invalid-agent' }
    try { killAgentSessions(role); log.info('[agent] stopped', { role }); return { ok: true } }
    catch (err) { return { ok: false, error: err && (err.message || String(err)) } }
  })
  ipcMain.handle('agent:restart', (_event, { role } = {}) => {
    if (!AGENT_SESSION[role]) return { ok: false, error: 'invalid-agent' }
    try {
      killAgentSessions(role)
      dockerExecAgent(['bash', '/app/.launcher/start-agent.sh', role], { timeout: 45000 })
      log.info('[agent] restarted', { role })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err && (err.message || String(err)) }
    }
  })

  // ── Onboarding: orari di lavoro del team ──────────────────────────────
  // Scritti DIRETTAMENTE in ~/.jht/jht.config.json (team.working_hours), non
  // via route web: durante l'onboarding il server web (next dev) non gira
  // ancora (parte solo a "Start team"). Il file è bind su /jht_home e lo
  // legge shared/skills/working_hours.py al boot del team. Schema:
  //   { timezone: "Europe/Rome", windows: [{ days:["mon",..], start:"09:00", end:"18:00" }] }
  // windows: [] (o null) = 24/7 (nessuna restrizione).
  ipcMain.handle('team:get-working-hours', () => {
    const cfg = readJhtConfig()
    const wh = cfg && cfg.team && typeof cfg.team === 'object' ? cfg.team.working_hours : null
    return { ok: true, working_hours: wh ?? null }
  })
  ipcMain.handle('team:set-working-hours', (_event, working_hours) => {
    try {
      const value = normalizeWorkingHours(working_hours)
      const cfg = readJhtConfig()
      cfg.team = { ...(cfg.team && typeof cfg.team === 'object' ? cfg.team : {}), working_hours: value }
      writeJhtConfig(cfg)
      log.info('[onboarding] working-hours saved', { windows: value ? value.windows.length : 0 })
      return { ok: true, working_hours: value }
    } catch (err) {
      return { ok: false, error: err && (err.message || String(err)) }
    }
  })

  // ── Onboarding VPS: orari di lavoro sul container REMOTO ──────────────
  // Stessi dati del ramo locale ma scritti in /root/.jht/jht.config.json
  // sulla VPS via SSH (read→merge→atomic-write + chown 1001). Il wizard in
  // modalità VPS instrada qui invece che su team:set-working-hours, così
  // l'utente non salta mai la scelta degli orari (gap b3, 2026-06-27).
  ipcMain.handle('team:get-working-hours-vps', (_event, { vpsIp } = {}) =>
    remoteConfig.getWorkingHoursFromVps(vpsIp),
  )
  ipcMain.handle('team:set-working-hours-vps', (_event, { vpsIp, working_hours } = {}) =>
    remoteConfig.saveWorkingHoursToVps(vpsIp, normalizeWorkingHours(working_hours)),
  )

  // ── Onboarding: upload documenti del profilo (CV + obiettivi) ─────────
  // File-picker nativo → copia i file nella drop-zone allegati (bind su
  // /jht_user). L'Assistente li ingerisce al primo boot del team per
  // costruire il profilo: niente più onboarding-chat obbligatoria.
  ipcMain.handle('profile:upload-docs', async () => {
    const fs = require('node:fs')
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Carica il tuo CV e i documenti del profilo',
        buttonLabel: 'Carica',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documenti', extensions: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'pages'] },
          { name: 'Tutti i file', extensions: ['*'] },
        ],
      })
      if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths.length) {
        return { ok: true, files: [] }
      }
      const dest = getUserUploadsDir()
      fs.mkdirSync(dest, { recursive: true })
      const saved = []
      for (const fp of result.filePaths) {
        try {
          const base = path.basename(fp)
          fs.copyFileSync(fp, path.join(dest, base))
          saved.push({ name: base, size: fs.statSync(path.join(dest, base)).size })
        } catch (err) {
          log.warn('[onboarding] upload-doc copy failed', { file: fp, err: String(err) })
        }
      }
      log.info('[onboarding] profile docs uploaded', { count: saved.length, dest })
      return { ok: true, files: saved }
    } catch (err) {
      return { ok: false, error: err && (err.message || String(err)), files: [] }
    }
  })
  ipcMain.handle('profile:list-docs', () => {
    const fs = require('node:fs')
    try {
      const dest = getUserUploadsDir()
      if (!fs.existsSync(dest)) return { ok: true, files: [] }
      const files = fs.readdirSync(dest)
        .filter((n) => !n.startsWith('.'))
        .map((n) => {
          try { return { name: n, size: fs.statSync(path.join(dest, n)).size } }
          catch { return { name: n, size: 0 } }
        })
      return { ok: true, files }
    } catch (err) {
      return { ok: false, error: err && (err.message || String(err)), files: [] }
    }
  })

  // ── Onboarding VPS: upload documenti del profilo sul container REMOTO ──
  // File-picker nativo (lato Mac) → legge i file come Buffer → li scrive
  // nella drop-zone allegati REMOTA via SSH (/root/Documents/Job Hunter
  // Team/allegati, bind /jht_user/allegati). L'Assistente li ingerisce al
  // boot del team sulla VPS. Speculare a profile:upload-docs locale.
  ipcMain.handle('profile:upload-docs-vps', async (_event, { vpsIp } = {}) => {
    if (!vpsIp) return { ok: false, error: 'vpsIp required', files: [] }
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Carica il tuo CV e i documenti del profilo',
        buttonLabel: 'Carica',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documenti', extensions: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'pages'] },
          { name: 'Tutti i file', extensions: ['*'] },
        ],
      })
      if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths.length) {
        return { ok: true, files: [] }
      }
      return await remoteConfig.uploadDocsToVps(vpsIp, result.filePaths)
    } catch (err) {
      return { ok: false, error: err && (err.message || String(err)), files: [] }
    }
  })
  ipcMain.handle('profile:list-docs-vps', (_event, { vpsIp } = {}) =>
    remoteConfig.listDocsOnVps(vpsIp),
  )

  // [JHT-VPS-TUNNEL] Cockpit VPS via tunnel SSH.
  ipcMain.handle('tunnel:open', (_event, { ip } = {}) => {
    const allow = assertKnownVpsIp(ip)
    if (!allow.ok) return { ok: false, error: allow.error }
    return tunnel.openTunnel({ ip })
  })
  ipcMain.handle('tunnel:close', () => tunnel.closeTunnel())
  ipcMain.handle('tunnel:status', () => tunnel.getStatus())
  ipcMain.handle('vps:open-cockpit', (_event, { ip } = {}) => openVpsCockpit(ip))
  ipcMain.handle('launcher:start', async (_event, options) => startTeamRuntime(options))
  ipcMain.handle('launcher:stop', () => {
    // [JHT-DASHBOARD-SPLIT] Stop team = il server localhost cade → chiudi la
    // finestra dashboard per non lasciare un "connessione rifiutata" appeso.
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.close()
    }
    return runtime.stopRuntime()
  })

  // Probe: il pulsante dev mode e' abilitato solo se il renderer vede
  // app.isPackaged=false (Electron in dev dalla sorgente). In prod
  // il bottone viene nascosto perche' scripts/dev-up.sh non esiste
  // nell'app installata.
  ipcMain.handle('dev:is-available', () => ({ available: !app.isPackaged }))

  // Dev mode one-shot: skippa il flow installer normale, fa partire
  // il container via docker compose (con bind-mount di .launcher/,
  // agents/, shared/, web/) e Next sull'host su :3001, poi apre il
  // browser sulla porta dev. Disponibile solo quando Electron gira
  // dal sorgente (app.isPackaged=false): in prod la repo non e'
  // accessibile per eseguire lo script.
  ipcMain.handle('dev:launch', async () => {
    if (app.isPackaged) {
      return { ok: false, error: 'Dev mode disponibile solo da sorgente (npm run desktop:dev)' }
    }
    // Sincronizza il provider scelto nel wizard → jht.config.json.
    // Senza questo, Dev Mode riusa il config di una sessione precedente
    // e il provider dal wizard viene ignorato (bug osservato: utente
    // seleziona Claude nel wizard, vede partire Kimi perche' il config
    // aveva ancora active_provider=kimi da una run passata). La versione
    // standard del bottone 'Start Team' gia' lo faceva.
    try {
      syncJhtConfig()
    } catch (error) {
      console.error('[dev:launch] syncJhtConfig failed:', error)
      // non-fatal: il dev-up.sh proseguirà con il config esistente;
      // se e' incompatibile start-agent.sh ti dira' cosa manca.
    }
    const repoRoot = path.resolve(__dirname, '..')
    const script = path.join(repoRoot, 'scripts', 'dev-up.sh')
    // Su Windows passiamo esplicitamente per git-bash (Electron non
    // eredita il PATH di quello che hai aperto; bash.exe via PATH non
    // e' garantito). Su mac/linux basta 'bash'.
    const bashCmd =
      process.platform === 'win32'
        ? (process.env.JHT_BASH || 'C:\\Program Files\\Git\\bin\\bash.exe')
        : 'bash'
    // Redirige stdout/stderr di dev-up.sh su file, altrimenti gli errori
    // del compose (es. container zombie, image mancante, docker daemon
    // down) sono invisibili e il bottone resta in "Avvio…" finche'
    // waitForReady scade.
    const fs = require('node:fs')
    const logDir = path.join(repoRoot, '.dev-logs')
    const logPath = path.join(logDir, 'dev-up.log')
    fs.mkdirSync(logDir, { recursive: true })
    const logFd = fs.openSync(logPath, 'a')
    try {
      const child = spawn(bashCmd, [script], {
        cwd: repoRoot,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
      })
      child.unref()
    } catch (error) {
      fs.closeSync(logFd)
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      fs.closeSync(logFd)
    }
    // Il dev-up.sh dura ~20-30s (recreate container + fix chown + start
    // Next). Aspettiamo in background che :3001 risponda e ritorniamo
    // il flag `ready` al renderer. NON apriamo piu' il browser
    // automaticamente (rimosso 2026-04-25 su richiesta utente: forzava
    // Chrome che non e' il browser scelto). L'utente apre da solo o usa
    // il bottone dedicato `home-btn-dev-open` nella card Avanzate.
    const waitForReady = async () => {
      const { request } = require('node:http')
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        const alive = await new Promise(resolve => {
          const req = request('http://localhost:3001/', { method: 'HEAD', timeout: 2000 }, res => {
            resolve(res.statusCode != null && res.statusCode < 500)
          })
          req.on('error', () => resolve(false))
          req.on('timeout', () => { req.destroy(); resolve(false) })
          req.end()
        })
        if (alive) return true
        await new Promise(r => setTimeout(r, 2000))
      }
      return false
    }
    const ready = await waitForReady()
    return { ok: true, ready, logPath }
  })
  // Dev mode probe: una HEAD su localhost:3001 dice se il Next host
  // (lanciato da dev-up.sh) è attualmente attivo. Renderer lo usa per
  // mostrare il badge running/stopped nella card Avanzate.
  ipcMain.handle('dev:probe', async () => {
    const { request } = require('node:http')
    const alive = await new Promise((resolve) => {
      const req = request('http://localhost:3001/', { method: 'HEAD', timeout: 1500 }, (res) => {
        resolve(res.statusCode != null && res.statusCode < 500)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
      req.end()
    })
    return { running: alive }
  })

  // Dev mode stop: lancia scripts/dev-down.sh in foreground, raccoglie
  // l'exit code. dev-down.sh ferma sia il container `jht` sia il Next
  // sull'host (kill -TERM dei processi `next dev -p 3001`).
  ipcMain.handle('dev:stop', async () => {
    if (app.isPackaged) {
      return { ok: false, error: 'Dev mode disponibile solo da sorgente' }
    }
    const repoRoot = path.resolve(__dirname, '..')
    const script = path.join(repoRoot, 'scripts', 'dev-down.sh')
    const bashCmd =
      process.platform === 'win32'
        ? (process.env.JHT_BASH || 'C:\\Program Files\\Git\\bin\\bash.exe')
        : 'bash'
    return new Promise((resolve) => {
      try {
        const child = spawn(bashCmd, [script], {
          cwd: repoRoot,
          env: { ...process.env, MSYS_NO_PATHCONV: '1' },
        })
        let stderr = ''
        child.stderr?.on('data', (d) => { stderr += d.toString() })
        child.on('error', (err) => resolve({ ok: false, error: err.message }))
        child.on('exit', (code) => {
          if (code === 0) resolve({ ok: true })
          else resolve({ ok: false, error: stderr.trim() || `dev-down.sh exit ${code}` })
        })
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })

  // ── Dev mode SECONDARIO (porta != 3001, su qualsiasi worktree) ──────────
  // Permette di affiancare al dev primario un secondo Next dev che riusa
  // il container `jht` condiviso. Vedi scripts/dev-up-additional.sh.
  // In-memory store dei dev secondari attivi: chiave = porta.
  const additionalDevs = new Map() // port -> { pid, worktree, startedAt, logPath }
  const MAX_ADDITIONAL = 2 // Mac M3 18 GB regge max 2 secondari + primario

  ipcMain.handle('dev-additional:list-worktrees', async () => {
    if (app.isPackaged) return { ok: false, error: 'Solo da sorgente' }
    return new Promise((resolve) => {
      try {
        const child = spawn('git', ['worktree', 'list', '--porcelain'], {
          cwd: path.resolve(__dirname, '..'),
        })
        let stdout = ''
        let stderr = ''
        child.stdout?.on('data', (d) => { stdout += d.toString() })
        child.stderr?.on('data', (d) => { stderr += d.toString() })
        child.on('error', (err) => resolve({ ok: false, error: err.message }))
        child.on('exit', (code) => {
          if (code !== 0) {
            resolve({ ok: false, error: stderr.trim() || `git worktree exit ${code}` })
            return
          }
          // Parse porcelain: blocchi separati da riga vuota, ogni blocco ha
          // `worktree <path>`, `HEAD <sha>`, `branch <ref>`.
          const worktrees = []
          for (const block of stdout.split(/\n\n/)) {
            const lines = block.split('\n').filter(Boolean)
            const wt = {}
            for (const line of lines) {
              const [key, ...rest] = line.split(' ')
              wt[key] = rest.join(' ')
            }
            if (wt.worktree) {
              worktrees.push({
                path: wt.worktree,
                branch: (wt.branch || '').replace('refs/heads/', '') || '(detached)',
              })
            }
          }
          resolve({ ok: true, worktrees })
        })
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })

  ipcMain.handle('dev-additional:launch', async (_event, args) => {
    if (app.isPackaged) return { ok: false, error: 'Solo da sorgente' }
    const { worktree, port } = args || {}
    if (typeof worktree !== 'string' || !worktree) {
      return { ok: false, error: 'worktree mancante' }
    }
    const portNum = Number(port)
    if (!Number.isInteger(portNum) || portNum < 3000 || portNum > 9999 || portNum === 3001) {
      return { ok: false, error: 'porta deve essere 3000-9999, diversa da 3001' }
    }
    if (additionalDevs.has(portNum)) {
      return { ok: false, error: `dev secondario già attivo su :${portNum}` }
    }
    if (additionalDevs.size >= MAX_ADDITIONAL) {
      return { ok: false, error: `max ${MAX_ADDITIONAL} dev secondari (Mac M3 18 GB), ferma uno prima` }
    }
    const repoRoot = path.resolve(__dirname, '..')
    const script = path.join(repoRoot, 'scripts', 'dev-up-additional.sh')
    const bashCmd = process.platform === 'win32'
      ? (process.env.JHT_BASH || 'C:\\Program Files\\Git\\bin\\bash.exe')
      : 'bash'
    return new Promise((resolve) => {
      try {
        const child = spawn(bashCmd, [script, worktree, String(portNum)], {
          cwd: repoRoot,
          env: { ...process.env, MSYS_NO_PATHCONV: '1' },
        })
        let stdout = ''
        let stderr = ''
        child.stdout?.on('data', (d) => { stdout += d.toString() })
        child.stderr?.on('data', (d) => { stderr += d.toString() })
        child.on('error', (err) => resolve({ ok: false, error: err.message }))
        child.on('exit', (code) => {
          // Parse `KEY=VALUE` lines (anche su exit code != 0 — exit 6 = not ready
          // ma PID è valido, lo vogliamo tracciare comunque).
          const out = {}
          for (const line of stdout.split('\n')) {
            const m = line.match(/^([A-Z_]+)=(.+)$/)
            if (m) out[m[1]] = m[2]
          }
          if (out.PID) {
            additionalDevs.set(portNum, {
              pid: Number(out.PID),
              worktree,
              startedAt: Date.now(),
              logPath: out.LOG || null,
              url: out.URL || `http://localhost:${portNum}`,
            })
          }
          if (code === 0) {
            resolve({ ok: true, ready: out.READY === '1', ...out, port: portNum })
          } else {
            resolve({
              ok: false,
              error: stderr.trim() || `dev-up-additional.sh exit ${code}`,
              partial: out,
              port: portNum,
            })
          }
        })
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })

  ipcMain.handle('dev-additional:stop', async (_event, args) => {
    if (app.isPackaged) return { ok: false, error: 'Solo da sorgente' }
    const portNum = Number(args?.port)
    if (!Number.isInteger(portNum)) return { ok: false, error: 'porta mancante' }
    const repoRoot = path.resolve(__dirname, '..')
    const script = path.join(repoRoot, 'scripts', 'dev-down-additional.sh')
    const bashCmd = process.platform === 'win32'
      ? (process.env.JHT_BASH || 'C:\\Program Files\\Git\\bin\\bash.exe')
      : 'bash'
    return new Promise((resolve) => {
      try {
        const child = spawn(bashCmd, [script, String(portNum)], {
          cwd: repoRoot,
          env: { ...process.env, MSYS_NO_PATHCONV: '1' },
        })
        let stderr = ''
        child.stderr?.on('data', (d) => { stderr += d.toString() })
        child.on('error', (err) => resolve({ ok: false, error: err.message }))
        child.on('exit', (code) => {
          additionalDevs.delete(portNum)
          if (code === 0) resolve({ ok: true })
          else resolve({ ok: false, error: stderr.trim() || `dev-down-additional.sh exit ${code}` })
        })
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  })

  ipcMain.handle('dev-additional:list-active', async () => {
    const list = []
    for (const [port, info] of additionalDevs) {
      // Verifica liveness: se il PID è morto, ripulisci.
      let alive = false
      try { alive = process.kill(info.pid, 0) || true } catch { alive = false }
      if (!alive) {
        additionalDevs.delete(port)
        continue
      }
      list.push({ port, ...info, uptimeMs: Date.now() - info.startedAt })
    }
    return { ok: true, active: list, max: MAX_ADDITIONAL }
  })

  ipcMain.handle('launcher:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'invalid-url' }
    }
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // -------- Auth (Supabase OAuth via loopback PKCE) --------
  ipcMain.handle('auth:get-status', () => auth.getStatus())
  ipcMain.handle('auth:sign-in', (event, provider) => {
    if (typeof provider !== 'string' || !auth.SUPPORTED_PROVIDERS.has(provider)) {
      return { ok: false, error: 'invalid-provider' }
    }
    const webContents = event?.sender
    return auth.signIn(provider, {
      onUrlReady: (url) => {
        try {
          if (webContents && !webContents.isDestroyed()) {
            webContents.send('auth:url-ready', { provider, url })
          }
        } catch { /* ignore */ }
      },
    })
  })
  ipcMain.handle('auth:cancel-sign-in', () => auth.cancelSignIn())
  ipcMain.handle('auth:sign-out', async () => {
    sync.clearAllKeys()
    return auth.signOut()
  })
  // Pairing token: base64(JSON) blob the renderer will hand to the
  // VPS wizard (gap 2) so install.sh can register the VPS as a device
  // of the signed-in user without an interactive `jht cloud login`.
  ipcMain.handle('auth:get-pairing-token', () => auth.getPairingToken())

  // -------- Renderer preferences (small key/value store) --------
  // JSON file in userData. Used today for the onboarding `location`
  // choice (local vs VPS) so a relaunch resumes on the right wizard
  // branch. Renderer-only state — nothing in here ends up in ~/.jht
  // or gets read by the CLI / container.
  ipcMain.handle('prefs:get', (_event, key) => readPref(key))
  ipcMain.handle('prefs:set', (_event, key, value) => writePref(key, value))

  // -------- VPS provisioning (SSH key gen + remote install.sh) -----
  ipcMain.handle('vps:generate-key', (_event, args = {}) => vps.generateKey(args))
  ipcMain.handle('vps:get-public-key', () => vps.getPublicKey())
  ipcMain.handle('vps:has-key', () => ({ ok: true, hasKey: vps.hasKey() }))
  // Reveal the SSH keypair folder in Explorer/Finder/file manager.
  // Surface for sharing the PRIVATE key with a beta tester / second
  // PC (the public key alone is not enough to log into the VPS —
  // the SSH client needs the private key). showItemInFolder takes
  // a FILE path and selects it; if the file doesn't exist yet we
  // fall back to opening the parent dir.
  ipcMain.handle('vps:open-key-folder', () => {
    try {
      const priv = vps.getPrivateKeyPath()
      const { shell, app } = require('electron')
      const fs = require('node:fs')
      const path = require('node:path')
      if (fs.existsSync(priv)) {
        shell.showItemInFolder(priv)
        return { ok: true, path: priv }
      }
      const sshDir = path.dirname(priv)
      if (fs.existsSync(sshDir)) {
        shell.openPath(sshDir)
        return { ok: true, path: sshDir }
      }
      const userData = app.getPath('userData')
      shell.openPath(userData)
      return { ok: true, path: userData, fallback: true }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })
  ipcMain.handle('vps:run-install', (event, args = {}) =>
    vps.runInstall({ ...args, sender: event.sender })
  )

  // -------- Telegram bot setup (VPS path: 3-bot tokens + remote save) -- (T4)
  ipcMain.handle('telegram:verify-bot', (_event, token) => telegram.verifyBot(token))
  ipcMain.handle('telegram:wait-for-chat', (_event, args = {}) =>
    telegram.waitForFirstChat(args.token, args.deadlineMs),
  )
  ipcMain.handle('telegram:cancel-wait-for-chat', (_event, token) =>
    telegram.cancelWaitForFirstChat(token),
  )
  ipcMain.handle('telegram:save-local', (_event, args = {}) =>
    saveTelegramBotsLocal(args.bots),
  )
  ipcMain.handle('telegram:save-to-vps', (_event, args = {}) =>
    telegram.saveBotsToVps(args.vpsIp, args.bots),
  )
  ipcMain.handle('provider:save-to-vps', (_event, args = {}) =>
    telegram.saveProviderToVps(args.vpsIp, args.provider, args.authMethod),
  )

  // -------- Email del team (casella job-alert dedicata, locale) ---------
  ipcMain.handle('email:get-status', () => readEmailStatus())
  ipcMain.handle('email:save-config', (_event, args = {}) => saveEmailConfig(args))
  ipcMain.handle('email:delete-config', () => deleteEmailConfig())
  // [ONBOARDING] Validazione round-trip delle credenziali della casella del
  // team: login IMAP + invio SMTP di un codice alla casella + rilettura via
  // IMAP. Su successo SALVA le credenziali (così l'onboarding non deve fare
  // un save separato). Ritorna { ok, stage?, error?, looksPersonal }.
  ipcMain.handle('email:validate', async (_event, { email, password } = {}) => {
    const looksPersonal = emailVerify.looksPersonal(String(email || ''))
    let res
    try {
      res = await emailVerify.validateRoundTrip(
        { email, password },
        { log: (stage) => log.info('[onboarding] email-validate stage', { stage }) },
      )
    } catch (err) {
      return { ok: false, stage: 'unknown', error: err && (err.message || String(err)), looksPersonal }
    }
    if (res.ok) {
      const saved = saveEmailConfig({ email, password })
      if (!saved.ok) {
        return { ok: false, stage: 'save', error: saved.error, looksPersonal }
      }
      log.info('[onboarding] email validated + saved', { host: res.imap_host })
    }
    return { ...res, looksPersonal }
  })

  // -------- vps:write-config (T1: generic config writer remoto) ---------
  // Scrive un file di config sul container remoto via SshExec.writeFile.
  // Pensato per `/root/.jht/jht.config.json` post-pairing.
  ipcMain.handle('vps:write-config', async (_event, args = {}) => {
    const {
      vpsIp,
      content,
      path: remotePath = '/root/.jht/jht.config.json',
      mode = '0600',
      atomic = true,
    } = args
    if (!vpsIp) return { ok: false, error: 'vpsIp required' }
    if (typeof content !== 'string') {
      return { ok: false, error: 'content must be a string (serialize JSON before)' }
    }
    const SshExec = require('./vps/ssh-exec')
    const slash = remotePath.lastIndexOf('/')
    if (slash > 0) {
      const parent = remotePath.slice(0, slash)
      if (parent.includes("'")) {
        return { ok: false, error: "remote path parent cannot contain single quotes" }
      }
      const mk = SshExec.run(vpsIp, `mkdir -p '${parent}'`)
      if (!mk.ok) return { ok: false, stage: 'mkdir', error: mk.stderr || `mkdir exit ${mk.code}` }
    }
    return SshExec.writeFile(vpsIp, remotePath, content, { mode, atomic })
  })

  // -------- Cloud sync (encrypted, client-side, AES-256-GCM) --------
  ipcMain.handle('sync:get-status', () => sync.getStatus())
  ipcMain.handle('sync:setup', (_event, args = {}) => sync.setup(args))
  ipcMain.handle('sync:unlock', (_event, args = {}) => sync.unlock(args))
  ipcMain.handle('sync:lock', () => sync.lock())
  ipcMain.handle('sync:push', (_event, args = {}) => sync.push(args))
  ipcMain.handle('sync:pull', (_event, args = {}) => sync.pull(args))
  ipcMain.handle('sync:disable', (_event, args = {}) => sync.disable(args))

  // Setup wizard — Docker status + download page + disk space preview.
  ipcMain.handle('setup:get-docker-status', async () => {
    const strategy = dockerInstaller.getStrategy()
    const check = await dockerInstaller.checkDocker()
    let free = null
    let freeHuman = null
    try {
      const bytes = await freeBytes(app.getPath('home'))
      free = bytes
      freeHuman = formatBytes(bytes)
    } catch {
      // Preview can show "unknown" if the disk probe fails.
    }
    let steps = null
    try {
      steps = await dockerInstaller.inspectInstallSteps({ platform: process.platform })
    } catch {
      // Leave steps null on failure; renderer falls back to the generic view.
    }
    return {
      platform: process.platform,
      arch: process.arch,
      strategy,
      check,
      steps,
      disk: {
        freeBytes: free,
        freeHuman,
        requiredBytes: strategy ? strategy.installedBytes : null,
        requiredHuman: strategy ? formatBytes(strategy.installedBytes) : null,
        recommendedFreeBytes: strategy ? strategy.recommendedFreeBytes : null,
        recommendedFreeHuman: strategy ? formatBytes(strategy.recommendedFreeBytes) : null,
        meetsRequirement:
          strategy && free !== null ? free >= strategy.installedBytes : null,
        meetsRecommendation:
          strategy && free !== null ? free >= strategy.recommendedFreeBytes : null,
      },
    }
  })

  ipcMain.handle('setup:open-brew-homepage', async () => {
    try {
      await shell.openExternal('https://brew.sh')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('setup:install-docker', async () => {
    try {
      const result = await dockerInstaller.installDocker({
        platform: process.platform,
        onLog: broadcastInstallLog,
        onStage: broadcastInstallStage,
      })
      if (result && result.ok) {
        log.child('setup').info('install.done', { stage: result.stage })
      } else {
        log.child('setup').error('install.failed', {
          stage: result?.stage,
          error: result?.error,
        })
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastInstallLog(`Errore: ${message}`)
      log.child('setup').error('install.exception', { error: message })
      return { ok: false, stage: 'exception', error: message }
    }
  })

  // Windows-only: one-click install of WSL2 + Docker Desktop behind a
  // single UAC prompt. Reuses the install-log broadcast channel so the
  // renderer can show live progress in the same panel.
  ipcMain.handle('setup:install-windows-stack', async () => {
    try {
      return await winInstaller.installWindowsStack({
        platform: process.platform,
        onLog: broadcastInstallLog,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastInstallLog(`Errore: ${message}`)
      return { ok: false, stage: 'exception', error: message }
    }
  })

  // Triggers a full OS reboot. Used at the end of the Windows install
  // flow so WSL2 kernel + Docker engine come up clean on next boot.
  ipcMain.handle('setup:reboot', async () => {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'unsupported-platform' }
    }
    const { spawn } = require('node:child_process')
    try {
      spawn('shutdown.exe', ['/r', '/t', '0'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('setup:open-docker-download-page', async () => {
    const url = dockerInstaller.downloadUrlFor()
    if (!url) return { ok: false, error: 'unsupported-platform' }
    try {
      await shell.openExternal(url)
      return { ok: true, url }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('setup:get-extra-deps', async () => {
    try {
      return await deps.inspectExtraDeps()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { deps: [], allRequiredOk: false, error: message }
    }
  })

  ipcMain.handle('setup:ensure-container', async () => {
    try {
      if (!payload.isPayloadPresent(payloadDir)) {
        broadcastContainerLog('Fetching payload (compose file + Dockerfile)…')
        const result = await payload.ensurePayload({
          payloadDir,
          updateIfPresent: false,
          logger: broadcastContainerLog,
        })
        if (!result) {
          return { ok: false, stage: 'payload', error: 'payload missing after ensure' }
        }
      }
      return await containerPrep.ensureContainerImage({
        payloadDir,
        onLog: broadcastContainerLog,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastContainerLog(`Error: ${message}`)
      return { ok: false, stage: 'exception', error: message }
    }
  })

  ipcMain.handle('setup:get-status', async () => {
    // [boot-to-wizard fix] providers.saved è l'UNICA cosa che decide
    // setup-complete (vedi home.js isSetupComplete). Va calcolato per primo e
    // in modo indipendente, e l'intero handler NON deve mai rifiutare: se un
    // inspect lancia (es. docker/container non ancora pronti subito dopo il
    // boot) boot() cadrebbe nel catch e mostrerebbe il WIZARD anche con un
    // provider già salvato → la Home "sparisce" al riavvio (bug intermittente).
    let saved = []
    try {
      saved = providerStore.readProviders(app.getPath('userData'))
    } catch (e) {
      log.warn('setup-status.read-providers-failed', { err: e && (e.message || String(e)) })
    }
    try {
      const docker = await dockerInstaller.checkDocker()
      const extra = await deps.inspectExtraDeps()
      const image = containerPrep.inspectImage()
      const { installed } = providerInstall.inspectInstalledProviders()
      const bindHomeDir = getBindHomeDir()
      // Auth only matters for providers the user currently picks (saved).
      // Binaries in the bind-mount from previous runs are ignored — the
      // user deselected them, they shouldn't resurface at login.
      const relevant = saved.filter((id) => installed.includes(id))
      const auth = providerAuth.authStates({ providers: relevant, bindHomeDir })
      return {
        docker,
        extra,
        image,
        providers: {
          saved,
          installed,
          pending: saved.filter((id) => !installed.includes(id)),
          auth,
          authed: auth.filter((a) => a.authed).map((a) => a.id),
          unauthed: auth.filter((a) => !a.authed).map((a) => a.id),
        },
      }
    } catch (e) {
      // Degraded ma NON rifiuta: ritorna almeno providers.saved così boot()
      // instrada alla Home invece che al wizard. Gli inspect (docker/image/
      // auth) si rileggono al prossimo refresh quando il sistema è pronto.
      log.warn('setup-status.degraded', { err: e && (e.message || String(e)), saved })
      return {
        docker: {},
        extra: {},
        image: {},
        providers: {
          saved,
          installed: [],
          pending: saved,
          auth: [],
          authed: [],
          unauthed: [],
        },
      }
    }
  })

  ipcMain.handle('setup:get-auth-states', (_event, args = {}) => {
    const saved = providerStore.readProviders(app.getPath('userData'))
    // VPS mode: i CLI provider sono installati DENTRO il container
    // sulla VPS (T2), e l'auth file scritto dal flow OAuth via PTY-
    // SSH (T3) finisce in /jht_home/.{claude,codex,kimi} REMOTO, NON
    // in ~/.jht sul Mac. Per dare il "Signed in" giusto serve un
    // probe SSH+docker exec test -s. Vedi provider-auth.js →
    // authStatesViaSsh. Stesso ragionamento per logoutProvider.
    if (args.host === 'vps' && args.vpsIp) {
      // Su VPS l'inspect "is provider installed" parte dal providers
      // store locale: lo abbiamo gia' scritto a fine install (T2 fa
      // writeProviders dopo successo). Skippiamo inspectInstalledProviders
      // perche' guarda binari locali.
      const auth = providerAuth.authStatesViaSsh({ providers: saved, vpsIp: args.vpsIp })
      return { auth, installed: saved }
    }
    const installed = providerInstall.inspectInstalledProviders().installed
    const relevant = saved.filter((id) => installed.includes(id))
    const auth = providerAuth.authStates({ providers: relevant, bindHomeDir: getBindHomeDir() })
    return { auth, installed: relevant }
  })

  ipcMain.handle('setup:logout-provider', (_event, ...rest) => {
    // Back-compat: vecchia signature era (providerId) bare. Nuova
    // signature: (args = { providerId, host, vpsIp }). Riconciliamo.
    let providerId, host, vpsIp
    const first = rest[0]
    if (typeof first === 'string') {
      providerId = first
    } else if (first && typeof first === 'object') {
      providerId = first.providerId
      host = first.host
      vpsIp = first.vpsIp
    }
    if (typeof providerId !== 'string' || !providerId) {
      return { ok: false, error: 'providerId required' }
    }
    try {
      if (host === 'vps' && vpsIp) {
        return providerAuth.logoutProviderViaSsh(providerId, { vpsIp })
      }
      return providerAuth.logoutProvider(providerId, { bindHomeDir: getBindHomeDir() })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  const loginContainerNames = new Map()

  // ── Terminal session attach/buffer machinery ─────────────────────
  // Race condition fix (2026-05-19): the child process (ssh -tt PTY
  // for VPS, node-pty container for local) starts emitting bytes
  // synchronously inside adoptChild/spawnSession via stdout/stderr
  // listeners. But the renderer only subscribes to terminal:data:<id>
  // AFTER awaiting terminal:start's IPC return — there's a 50-200ms
  // window where webContents.send() goes to a channel with no
  // listener and the bytes are dropped on the floor.
  //
  // codex emits its full TUI welcome+login prompt in a single burst
  // at startup, so dropping the first 100ms = empty terminal panel
  // forever. Hard to debug, easy to break.
  //
  // Fix: buffer all data and exit events in main until the renderer
  // explicitly calls terminal:attach(sessionId). The renderer is
  // expected to subscribe to data/exit channels BEFORE calling
  // attach, so flushing during attach is race-free.
  //
  // Buffer is capped (drop oldest bytes if > MAX) to defend against a
  // pathological client that never attaches; in practice attach is
  // called within ~50ms of start so the buffer stays tiny.
  const TERMINAL_BUFFER_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
  const terminalSessions = new Map() // id → { attached, chunks, bytes, exit }

  function makeTerminalDispatchers(getId) {
    return {
      onData: (data) => {
        const id = getId()
        const sess = id != null ? terminalSessions.get(id) : null
        log.debug('terminal.data', {
          id, attached: sess?.attached, len: data?.length,
          first32: typeof data === 'string' ? data.slice(0, 32) : null,
        })
        if (!sess || !sess.attached) {
          if (sess) {
            sess.chunks.push(data)
            sess.bytes += data.length
            while (sess.bytes > TERMINAL_BUFFER_MAX_BYTES && sess.chunks.length > 1) {
              const dropped = sess.chunks.shift()
              sess.bytes -= dropped.length
            }
          }
          return
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:data:${id}`, data)
        }
      },
      onExit: (exit) => {
        const id = getId()
        const sess = id != null ? terminalSessions.get(id) : null
        if (!sess || !sess.attached) {
          if (sess) sess.exit = exit
          return
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:exit:${id}`, exit)
        }
        terminalSessions.delete(id)
      },
    }
  }

  function registerTerminalSession(id) {
    terminalSessions.set(id, { attached: false, chunks: [], bytes: 0, exit: null })
  }

  ipcMain.handle('terminal:attach', (_event, sessionId) => {
    const sess = terminalSessions.get(sessionId)
    if (!sess) return { ok: false, error: 'unknown-session' }
    if (sess.attached) return { ok: true, alreadyAttached: true }
    sess.attached = true
    // Flush buffered chunks (preserves order via webContents.send IPC
    // channel ordering guarantee).
    if (mainWindow && !mainWindow.isDestroyed()) {
      for (const chunk of sess.chunks) {
        mainWindow.webContents.send(`terminal:data:${sessionId}`, chunk)
      }
    }
    const flushedBytes = sess.bytes
    const flushedChunks = sess.chunks.length
    sess.chunks = []
    sess.bytes = 0
    // Also flush a pending exit if the process died before attach.
    if (sess.exit !== null) {
      const exit = sess.exit
      sess.exit = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`terminal:exit:${sessionId}`, exit)
      }
      terminalSessions.delete(sessionId)
    }
    return { ok: true, flushedBytes, flushedChunks }
  })

  ipcMain.handle('terminal:start', (_event, { providerId, host = 'local', vpsIp } = {}) => {
    const meta = providerInstall.PROVIDERS[providerId]
    if (!meta) return { ok: false, error: `unknown provider: ${providerId}` }

    // VPS mode: il TUI di login deve girare sul container REMOTO (lo
    // OAuth deve atterrare nel ~/.claude del container sulla VPS, non
    // sul Mac). Apriamo un PTY ssh -tt → docker exec -it jht <binary>
    // e wrappiamo il ChildProcess come una sessione terminal "alla
    // pari" di quelle locali, cosi' il renderer non se ne accorge.
    if (host === 'vps') {
      if (!vpsIp) return { ok: false, error: 'host=vps requires vpsIp' }
      const r = providerInstall.openLoginViaSsh({ vpsIp, providerId })
      if (!r.ok) return r
      let id = null
      const dispatchers = makeTerminalDispatchers(() => id)
      id = terminal.adoptChild({
        child: r.child,
        onData: dispatchers.onData,
        onExit: dispatchers.onExit,
      })
      registerTerminalSession(id)
      return { ok: true, sessionId: id, host: 'vps' }
    }

    if (!payload.isPayloadPresent(payloadDir)) {
      return { ok: false, error: 'payload not present — run container prep first' }
    }
    // Predictable container name so we can docker-kill the orphan
    // if the user closes the modal before the CLI exits cleanly.
    const containerName = `jht-login-${providerId}-${Date.now()}`
    // Append loginArgs (e.g. --yolo for kimi) so the first-run trust
    // dialog is auto-accepted and the approval lands in the CLI's
    // config on disk. Later launches — including the background
    // assistant boot — will skip straight past it.
    const loginArgs = Array.isArray(meta.loginArgs) ? meta.loginArgs : []
    let id = null
    const baseDispatchers = makeTerminalDispatchers(() => id)
    id = terminal.spawnSession({
      command: 'docker',
      args: [
        'compose', 'run', '--rm', '--no-deps',
        '-it',
        '--name', containerName,
        '-e', 'HOME=/jht_home',
        '--entrypoint', meta.binary,
        'jht',
        ...loginArgs,
      ],
      cwd: payloadDir,
      env: containerPrep.dockerEnv(),
      onData: baseDispatchers.onData,
      onExit: (exit) => {
        loginContainerNames.delete(id)
        // Delegate buffering/dispatch to the shared helper.
        baseDispatchers.onExit(exit)
      },
    })
    registerTerminalSession(id)
    loginContainerNames.set(id, containerName)
    return { ok: true, sessionId: id }
  })

  ipcMain.on('terminal:write', (_event, { sessionId, data }) => {
    terminal.write(sessionId, data)
  })

  ipcMain.on('terminal:resize', (_event, { sessionId, cols, rows }) => {
    terminal.resize(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:kill', (_event, sessionId) => {
    const containerName = loginContainerNames.get(sessionId)
    terminal.kill(sessionId)
    loginContainerNames.delete(sessionId)
    // Clear buffer + exit cache for this session; renderer is going
    // away so flushing would be pointless.
    terminalSessions.delete(sessionId)
    if (containerName) {
      const { spawn } = require('node:child_process')
      // Best-effort: remove the ephemeral container. --rm would clean
      // it up if the CLI exited normally, but closing the modal
      // early leaves it running.
      try {
        spawn('docker', ['rm', '-f', containerName], {
          stdio: 'ignore',
          windowsHide: true,
          detached: true,
        }).unref()
      } catch { /* ignore */ }
    }
    return { ok: true }
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('clipboard:write', (_event, text) => {
    if (typeof text === 'string') clipboard.writeText(text)
    return { ok: true }
  })

  ipcMain.handle('setup:install-providers', async (_event, args) => {
    // Back-compat: l'API vecchia accettava providerIds come array. La
    // nuova accetta { providerIds, host, vpsIp }: host='vps' instrada
    // l'install via SSH al container REMOTO sulla VPS, host omesso o
    // 'local' resta sul container locale come prima.
    let providerIds = []
    let host = 'local'
    let vpsIp = null
    if (Array.isArray(args)) {
      providerIds = args
    } else if (args && typeof args === 'object') {
      providerIds = Array.isArray(args.providerIds) ? args.providerIds : []
      if (typeof args.host === 'string') host = args.host
      if (typeof args.vpsIp === 'string') vpsIp = args.vpsIp
    }
    try {
      if (host === 'vps') {
        if (!vpsIp) {
          return { ok: false, stage: 'preflight', error: 'host=vps requires vpsIp' }
        }
        const result = await providerInstall.installViaSsh({
          vpsIp,
          providerIds,
          onLog: broadcastProviderLog,
        })
        if (result.ok) {
          // Persistiamo la selezione anche in VPS mode: il renderer la
          // legge per mostrare "✓ installed" sul wizard. La verita' di
          // chi e' realmente installato sta sul container remoto, ma
          // quella probe la fa T3 quando affina inspectInstalledProviders.
          providerStore.writeProviders(app.getPath('userData'), providerIds)
        }
        return result
      }
      if (!payload.isPayloadPresent(payloadDir)) {
        return { ok: false, stage: 'payload', error: 'payload not present — run container prep first' }
      }
      const result = await providerInstall.installProviders({
        providerIds,
        payloadDir,
        onLog: broadcastProviderLog,
      })
      if (result.ok) {
        providerStore.writeProviders(app.getPath('userData'), providerIds)
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcastProviderLog(`Error: ${message}`)
      return { ok: false, stage: 'exception', error: message }
    }
  })

  ipcMain.handle('setup:get-providers', () => {
    return { providers: providerStore.readProviders(app.getPath('userData')) }
  })

  // New single-select API used by the redesigned provider picker:
  // one provider, one plan tier. The plan value is purely
  // informational — the sentinel reads it later to size context
  // windows against the account's actual quota.
  ipcMain.handle('setup:get-selection', () => {
    return providerStore.readSelection(app.getPath('userData'))
  })

  ipcMain.handle('setup:save-selection', (_event, { provider, plan } = {}) => {
    try {
      return {
        ok: true,
        selection: providerStore.writeSelection(app.getPath('userData'), { provider, plan }),
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('setup:open-docker-desktop', async () => {
    const desktopPath = dockerInstaller.dockerDesktopPath()
    if (!desktopPath) return { ok: false, error: 'docker-desktop-not-found' }
    try {
      const result = await shell.openPath(desktopPath)
      if (result) return { ok: false, error: result }
      return { ok: true, path: desktopPath }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Mac path al "Open Docker Desktop": qui non esiste un .app da aprire,
  // il runtime è Colima e va acceso da CLI. `colima start` è sincrono e
  // può durare ~30-60s la prima volta — il renderer disabilita il
  // bottone per la durata.
  ipcMain.handle('setup:start-colima', async () => {
    try {
      containerRuntime.startColima()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // macOS: launch Docker Desktop (the user's own app). `open -a Docker` returns
  // immediately; the renderer polls docker status to know when it's ready.
  ipcMain.handle('setup:start-docker-desktop', async () => {
    try {
      containerRuntime.startDockerDesktop()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // Container-runtime preference (macOS only). 'auto' | 'colima' | 'docker-desktop'.
  // Persisted host-side in userData/preferences.json — never synced to the
  // container or the cloud. Also reports what is detected so the UI can guide
  // the user (e.g. offer "Start Docker Desktop" only if it is installed).
  ipcMain.handle('setup:get-container-runtime', async () => {
    const choice = readPref('containerRuntime') || containerRuntime.DEFAULT_RUNTIME
    let detected = null
    try {
      detected = containerRuntime.detectRuntimeState()
    } catch {
      // Detection is best-effort; the UI falls back to the stored choice.
    }
    return { choice, choices: containerRuntime.RUNTIME_CHOICES, detected }
  })

  ipcMain.handle('setup:set-container-runtime', async (_event, { choice } = {}) => {
    if (!containerRuntime.RUNTIME_CHOICES.includes(choice)) {
      return { ok: false, error: 'invalid-choice' }
    }
    return writePref('containerRuntime', choice)
  })

  createWindow()

  // [autostart] Dopo che la finestra è su, valuta l'auto-start del team
  // (opt-in via pref). Non blocca il boot: fire-and-forget.
  maybeAutoStartTeam()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  // Container detached: NON fermare il team alla chiusura dell'app — sopravvive
  // così riaprendo il launcher è già su (niente ri-spawn / token). Lo stop
  // esplicito resta su "Stop team" (launcher:stop → runtime.stopRuntime).
  // Dev/non-container: shutdownForQuit ferma comunque il processo figlio.
  if (runtime) Promise.resolve(runtime.shutdownForQuit()).catch(() => {})
  tunnel.closeTunnel().catch(() => {})
  terminal.killAll()
})

app.on('window-all-closed', () => {
  app.quit()
})
