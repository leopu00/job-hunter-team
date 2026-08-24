// Storage adapter for @supabase/supabase-js. Sceglie il backend a runtime:
//
//   dev (app.isPackaged === false)        → memory (Map in-process)
//   packaged unsigned (no Apple secrets)  → file (userData/session/<acct>.json)
//   packaged signed                       → OS keychain (@napi-rs/keyring)
//
// Perche' tre backend? macOS Keychain identifica l'app via code signing.
// Senza signing stable l'OS re-prompta l'utente per autorizzazione ad
// OGNI lettura → loop di prompt infinito (visto in beta: l'utente non
// puo' nemmeno superare il primo `auth.getSession()` di Supabase).
//
// In dev (npm run dev) il binary di Electron e' system-wide e cambia
// identity ad ogni reinstall, quindi memory e' l'unica opzione sensata.
// In packaged UNSIGNED (DMG senza secrets Apple, come la beta corrente)
// il prompt-loop riappare → fallback su file storage in userData con
// perms 0600 (pattern Slack/Discord/Cursor unsigned). La session
// sopravvive al riavvio, ma e' leggibile da chi ha accesso filesystem
// utente — trade-off accettato dato che l'app stessa e' unsigned.
// In packaged SIGNED (futura release con secrets Apple) torniamo al
// keychain proper.
//
// Override esplicito via env: JHT_DESKTOP_DEV_STORAGE=memory|file|keychain
// Utile per debug + per i test in cui vuoi forzare un backend.
//
// Detection signed in packaged: cerca env JHT_PACKAGED_SIGNED=1 (settato
// dal release.yml quando HAS_MAC_SIGNING e' true). Senza quella env,
// in packaged assumiamo unsigned → file storage. Failsafe conservatore.

const fs = require('node:fs')
const path = require('node:path')

const SERVICE = 'jht-desktop-session'

let keyring = null
try {
  keyring = require('@napi-rs/keyring')
} catch (err) {
  // Module load failure (rare — native binding missing). We surface
  // it via getItem/setItem throwing rather than silently no-op'ing,
  // so the user sees "login not available" instead of "login worked
  // but session vanished".
  keyring = null
}

function getElectronApp() {
  try {
    return require('electron').app
  } catch {
    return null
  }
}

// Decide il backend: 'memory' | 'file' | 'keychain'.
function chooseBackend() {
  const override = (process.env.JHT_DESKTOP_DEV_STORAGE || '').toLowerCase()
  if (override === 'memory' || override === 'file' || override === 'keychain') {
    return override
  }
  const app = getElectronApp()
  // Fuori da Electron (test runner): default keychain — i test
  // dovrebbero mockare comunque.
  if (!app) return 'keychain'
  if (!app.isPackaged) return 'memory'
  // Packaged: keychain solo se l'app e' firmata (env settata dal
  // workflow di release con HAS_MAC_SIGNING=true), altrimenti file.
  if (process.env.JHT_PACKAGED_SIGNED === '1') return 'keychain'
  return 'file'
}

// In-memory fallback per dev mode.
const memStore = new Map()

// File storage fallback per packaged-unsigned.
function getFilePath(account) {
  const app = getElectronApp()
  const base = app ? app.getPath('userData') : require('node:os').tmpdir()
  // Una sub-dir dedicata per non mischiarsi con altri file utente
  // (preferences.json, ssh/, logs/, ecc.).
  return path.join(base, 'session', `${account}.txt`)
}

function fileRead(account) {
  try {
    return fs.readFileSync(getFilePath(account), 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}

function fileWrite(account, value) {
  const p = getFilePath(account)
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 })
  } catch { /* ignore EEXIST */ }
  // Scrittura atomica: tmp + rename, cosi' un crash a meta' non
  // lascia file half-written che Supabase legge come JSON corrotto.
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, String(value), { mode: 0o600 })
  fs.renameSync(tmp, p)
}

function fileDelete(account) {
  try {
    fs.unlinkSync(getFilePath(account))
  } catch (err) {
    if (err && err.code === 'ENOENT') return
    throw err
  }
}

function entry(account) {
  if (!keyring) {
    throw new Error('Keyring native binding unavailable on this platform')
  }
  return new keyring.Entry(SERVICE, account)
}

// Supabase's localStorage shim API is synchronous; @napi-rs/keyring is
// synchronous too (with async variants we don't use here).
function createKeyringStorage() {
  const backend = chooseBackend()
  return {
    _backend: backend,
    getItem(account) {
      if (backend === 'memory') {
        return memStore.has(account) ? memStore.get(account) : null
      }
      if (backend === 'file') {
        return fileRead(account)
      }
      try {
        return entry(account).getPassword()
      } catch (err) {
        if (/no.*(matching|such).*entry|entry.*not.*found/i.test(String(err?.message || err))) {
          return null
        }
        throw err
      }
    },
    setItem(account, value) {
      if (backend === 'memory') {
        memStore.set(account, String(value))
        return
      }
      if (backend === 'file') {
        fileWrite(account, value)
        return
      }
      entry(account).setPassword(String(value))
    },
    removeItem(account) {
      if (backend === 'memory') {
        memStore.delete(account)
        return
      }
      if (backend === 'file') {
        fileDelete(account)
        return
      }
      try {
        entry(account).deletePassword()
      } catch (err) {
        if (/no.*(matching|such).*entry|entry.*not.*found/i.test(String(err?.message || err))) {
          return
        }
        throw err
      }
    },
  }
}

module.exports = { createKeyringStorage, SERVICE, chooseBackend }
