// Storage adapter for @supabase/supabase-js that persists the auth
// session in the OS keychain via @napi-rs/keyring. Supabase calls
// getItem/setItem/removeItem with a single key (the storageKey we
// configure). We map that key 1:1 onto a keyring entry.
//
// Service name `jht-desktop-session` is intentionally different from
// `jht-credentials` (shared/credentials/passphrase.ts) so launcher
// session and CLI passphrase don't collide in the same OS keychain
// row.

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

function entry(account) {
  if (!keyring) {
    throw new Error('Keyring native binding unavailable on this platform')
  }
  return new keyring.Entry(SERVICE, account)
}

// Supabase's localStorage shim API is synchronous; @napi-rs/keyring is
// synchronous too (with async variants we don't use here).
function createKeyringStorage() {
  return {
    getItem(account) {
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
      entry(account).setPassword(String(value))
    },
    removeItem(account) {
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
