// Storage adapter for @supabase/supabase-js that persists the auth
// session in the OS keychain via @napi-rs/keyring. Supabase calls
// getItem/setItem/removeItem with a single key (the storageKey we
// configure). We map that key 1:1 onto a keyring entry.
//
// Service name `jht-desktop-session` is intentionally different from
// `jht-credentials` (shared/credentials/passphrase.ts) so launcher
// session and CLI passphrase don't collide in the same OS keychain
// row.
//
// Dev mode (`app.isPackaged === false` OR `JHT_DESKTOP_DEV_STORAGE=memory`):
// usa storage in memoria invece del keychain. Motivo: Electron in dev
// e' un binary unsigned, macOS Keychain non lo riconosce con un'identita'
// stable e re-prompta l'utente per autorizzazione ad OGNI lettura → loop
// di prompt infinito che blocca lo sviluppo. In modalita' packaged
// (DMG firmato + notarized) il keychain riconosce l'app e il prompt
// avviene una volta sola con "Always Allow".
//
// La session resta in memoria finche' Electron non muore: in dev devi
// rifare il sign-in ad ogni `npm run dev`. Accettabile per testare il
// flow del wizard; per testare la persistenza serve un packaged build.

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

function isDevMode() {
  if (process.env.JHT_DESKTOP_DEV_STORAGE === 'memory') return true
  if (process.env.JHT_DESKTOP_DEV_STORAGE === 'keychain') return false
  try {
    const { app } = require('electron')
    return !app.isPackaged
  } catch {
    // Non in Electron main process (es. test runner): default keychain.
    return false
  }
}

function entry(account) {
  if (!keyring) {
    throw new Error('Keyring native binding unavailable on this platform')
  }
  return new keyring.Entry(SERVICE, account)
}

// In-memory fallback: una Map condivisa nel processo Electron. Salva
// solo finche' l'app resta accesa.
const memStore = new Map()

// Supabase's localStorage shim API is synchronous; @napi-rs/keyring is
// synchronous too (with async variants we don't use here).
function createKeyringStorage() {
  const dev = isDevMode()
  return {
    getItem(account) {
      if (dev) {
        return memStore.has(account) ? memStore.get(account) : null
      }
      try {
        return entry(account).getPassword()
      } catch (err) {
        // `getPassword` throws when the entry doesn't exist. Supabase
        // expects null for "no value", not an exception.
        if (/no.*(matching|such).*entry|entry.*not.*found/i.test(String(err?.message || err))) {
          return null
        }
        // Real error (e.g. user denied access to keychain) — let it
        // bubble up so the auth flow doesn't silently corrupt state.
        throw err
      }
    },
    setItem(account, value) {
      if (dev) {
        memStore.set(account, String(value))
        return
      }
      entry(account).setPassword(String(value))
    },
    removeItem(account) {
      if (dev) {
        memStore.delete(account)
        return
      }
      try {
        entry(account).deletePassword()
      } catch (err) {
        // Idempotent: deleting a missing key is fine.
        if (/no.*(matching|such).*entry|entry.*not.*found/i.test(String(err?.message || err))) {
          return
        }
        throw err
      }
    },
  }
}

module.exports = { createKeyringStorage, SERVICE }
