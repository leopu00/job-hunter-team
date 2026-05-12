// Single Supabase JS client for the launcher main process. Persists
// the session via the OS keychain (see keyring-storage.js) so the
// user stays signed in across launcher restarts.
//
// We use @supabase/supabase-js directly (NOT @supabase/ssr) because:
//   - ssr requires Next cookies()/headers() bridges we don't have in
//     an Electron main process.
//   - the launcher is a single long-running Node process — no SSR
//     hydration concern.

const { createClient } = require('@supabase/supabase-js')
const { createKeyringStorage } = require('./keyring-storage')

// Public Supabase project — anon key safe to ship. Mirrors
// web/lib/supabase/config.ts. Env override for self-hosted instances.
const DEFAULT_URL = 'https://smittwvohsnwwwisqdrh.supabase.co'
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtaXR0d3ZvaHNud3d3aXNxZHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMDIzMDgsImV4cCI6MjA4OTY3ODMwOH0.g7twGaXdmmqBtukaioaJ1OV2mXVJqpEhkyzXaEIH44I'

const STORAGE_KEY = 'jht-desktop-auth-session'

let cached = null

function getClient() {
  if (cached) return cached
  const url = process.env.JHT_SUPABASE_URL || DEFAULT_URL
  const anonKey = process.env.JHT_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY
  cached = createClient(url, anonKey, {
    auth: {
      // PKCE flow — required for native apps without a browser
      // session/cookie context. Supabase generates the code_verifier
      // and stores it via our storage adapter.
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // we handle the callback ourselves
      storage: createKeyringStorage(),
      storageKey: STORAGE_KEY,
    },
  })
  return cached
}

module.exports = { getClient, STORAGE_KEY }
