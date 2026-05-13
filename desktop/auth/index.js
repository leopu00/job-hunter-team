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

const { getClient } = require('./supabase-client')
const { startCallbackServer } = require('./callback-server')
const { openInChosenBrowser } = require('./browser-picker')

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
      // Ask the user which installed browser should receive the
      // authorize URL. The pre-flight dialog avoids the "auto-logged
      // into the wrong account" surprise that happens when the
      // default browser already has a session for another Google
      // account.
      await openInChosenBrowser(data.url, {
        title: 'Sign in with ' + (PROVIDER_LABEL[provider] || provider),
        message: `Con quale browser vuoi aprire il login ${PROVIDER_LABEL[provider] || provider}?`,
      })
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

// Generate the opaque pairing token the desktop app will pass to
// `install.sh --pairing-token <token>` on a fresh VPS. The token is
// base64(JSON({supabase_url, user_id, refresh_token, issued_at})).
//
// install.sh decodes it, calls Supabase /auth/v1/token?grant_type=
// refresh_token to mint an access_token, then registers the VPS as a
// device of `user_id`. From that point the VPS can talk to Supabase
// as the user without ever needing an interactive `jht cloud login`
// inside the VPS shell (decisione 2026-05-13 lockata #4 — vedi memoria
// project_vps_setup_decisions.md).
//
// Why refresh_token and not access_token:
//   - access_token scade in ~1h → install.sh dovrebbe finire entro
//     l'ora, gli script fall-through richiedono retry, troppo fragile.
//   - refresh_token e' long-lived (giorni) e via grant_type=refresh
//     ottiene access_token freschi finche' l'utente non si delogga.
//
// Trade-off accettato: chi ha il pairing token PUO' agire come l'utente
// finche' non revochiamo la session. La superficie e' limitata (token
// passato solo localmente da app a install.sh via SSH), ma in v1 con
// `device_pairings` table + Supabase function torneremo a un token
// scoped invece di una refresh_token raw.
async function getPairingToken() {
  try {
    const client = getClient()
    const { data, error } = await client.auth.getSession()
    if (error) return { ok: false, error: error.message }
    if (!data?.session) return { ok: false, error: 'Not signed in' }
    const supabaseUrl =
      process.env.JHT_SUPABASE_URL ||
      'https://smittwvohsnwwwisqdrh.supabase.co'
    const payload = {
      supabase_url: supabaseUrl,
      user_id: data.session.user.id,
      refresh_token: data.session.refresh_token,
      issued_at: new Date().toISOString(),
    }
    const token = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    return { ok: true, token }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

module.exports = { getStatus, signIn, signOut, getPairingToken, SUPPORTED_PROVIDERS }
