// Auth orchestrator for the launcher main process. Wraps the
// Supabase client + loopback callback server into a 3-call API:
//   getStatus() -> { signedIn, user, error? }
//   signIn(provider) -> { ok, user? error? }
//   signOut() -> { ok, error? }
//
// signIn() opens the system browser to Supabase's authorize URL,
// waits for the user to complete OAuth, exchanges the returned code
// for a session via supabase.auth.exchangeCodeForSession, and stores
// the session via the keyring storage adapter.

const { shell } = require('electron')
const { getClient } = require('./supabase-client')
const { startCallbackServer } = require('./callback-server')

const SUPPORTED_PROVIDERS = new Set(['google', 'github'])

// Map our concise provider id to the user-facing label we log /
// surface in the renderer (no user-facing text comes from main, but
// we want consistent error strings).
const PROVIDER_LABEL = { google: 'Google', github: 'GitHub' }

let inFlightSignIn = null

function userFromSession(session) {
  if (!session?.user) return null
  const { id, email, app_metadata, user_metadata } = session.user
  return {
    id,
    email: email || null,
    provider: app_metadata?.provider || null,
    name: user_metadata?.full_name || user_metadata?.name || null,
    avatarUrl: user_metadata?.avatar_url || null,
  }
}

async function getStatus() {
  try {
    const client = getClient()
    const { data, error } = await client.auth.getSession()
    if (error) return { signedIn: false, user: null, error: error.message }
    if (!data?.session) return { signedIn: false, user: null }
    return { signedIn: true, user: userFromSession(data.session) }
  } catch (err) {
    return { signedIn: false, user: null, error: err.message || String(err) }
  }
}

async function signIn(provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return { ok: false, error: `Unsupported provider: ${provider}` }
  }
  // Coalesce concurrent signIn() calls — clicking the button twice
  // shouldn't spawn two callback servers.
  if (inFlightSignIn) return inFlightSignIn
  inFlightSignIn = (async () => {
    let server = null
    try {
      const client = getClient()
      server = await startCallbackServer()
      // Per-provider authorize options. Google supports prompt=
      // select_account so the user can pick which Google account
      // when their browser has multiple sessions open. GitHub does
      // not support prompt at all — passing it makes the consent
      // screen reject with 400, so we omit it for github.
      const authorizeOptions = {
        redirectTo: server.redirectUri,
        skipBrowserRedirect: true,
      }
      if (provider === 'google') {
        authorizeOptions.queryParams = { prompt: 'select_account' }
      }
      const { data, error } = await client.auth.signInWithOAuth({
        provider,
        options: authorizeOptions,
      })
      if (error || !data?.url) {
        throw new Error(error?.message || 'Supabase did not return an authorize URL')
      }
      // Open the authorize URL in the user's default browser. We use
      // shell.openExternal (Electron) instead of opener libs so the
      // default browser is honored even if it's not Chromium.
      await shell.openExternal(data.url)
      const { code } = await server.waitForCallback()
      const { data: exchangeData, error: exchangeError } =
        await client.auth.exchangeCodeForSession(code)
      if (exchangeError) {
        throw new Error(exchangeError.message)
      }
      const user = userFromSession(exchangeData?.session)
      return { ok: true, user, provider: PROVIDER_LABEL[provider] || provider }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    } finally {
      if (server) {
        try { server.close() } catch { /* ignore */ }
      }
      inFlightSignIn = null
    }
  })()
  return inFlightSignIn
}

async function signOut() {
  try {
    const client = getClient()
    const { error } = await client.auth.signOut()
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

module.exports = { getStatus, signIn, signOut, SUPPORTED_PROVIDERS }
