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
const log = require('../logger').child('auth')

const SUPPORTED_PROVIDERS = new Set(['google', 'github'])

// Map our concise provider id to the user-facing label we log /
// surface in the renderer (no user-facing text comes from main, but
// we want consistent error strings).
const PROVIDER_LABEL = { google: 'Google', github: 'GitHub' }

let inFlightSignIn = null
let inFlightServer = null
let inFlightCancelled = false

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
    if (error) {
      log.warn('status.session-error', { err: error.message })
      return { signedIn: false, user: null, error: error.message }
    }
    if (!data?.session) {
      log.debug('status.signed-out')
      return { signedIn: false, user: null }
    }
    log.debug('status.signed-in', { userId: data.session.user?.id })
    return { signedIn: true, user: userFromSession(data.session) }
  } catch (err) {
    log.error('status.crashed', { err })
    return { signedIn: false, user: null, error: err.message || String(err) }
  }
}

async function signIn(provider, { onUrlReady } = {}) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    log.warn('signin.unsupported-provider', { provider })
    return { ok: false, error: `Unsupported provider: ${provider}` }
  }
  // Coalesce concurrent signIn() calls — clicking the button twice
  // shouldn't spawn two callback servers.
  if (inFlightSignIn) {
    log.debug('signin.coalesced', { provider })
    return inFlightSignIn
  }
  log.info('signin.start', { provider })
  inFlightCancelled = false
  inFlightSignIn = (async () => {
    let server = null
    try {
      const client = getClient()
      server = await startCallbackServer()
      inFlightServer = server
      log.debug('signin.callback-server.ready', { redirectUri: server.redirectUri })
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
        log.error('signin.authorize-url-missing', { err: error?.message })
        throw new Error(error?.message || 'Supabase did not return an authorize URL')
      }
      log.debug('signin.authorize-url.ready')
      // Surface the URL to the renderer BEFORE opening the browser
      // so the user has a "Copy link" / "Cancel" fallback even if
      // the browser fails to open or opens with the wrong session.
      if (typeof onUrlReady === 'function') {
        try { onUrlReady(data.url) } catch (e) { log.warn('signin.on-url-ready.failed', { err: e?.message }) }
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
      log.info('signin.browser-launched', { provider })
      const { code } = await server.waitForCallback()
      if (inFlightCancelled) {
        throw new Error('Sign-in cancelled by user')
      }
      log.debug('signin.callback-received')
      const { data: exchangeData, error: exchangeError } =
        await client.auth.exchangeCodeForSession(code)
      if (exchangeError) {
        log.error('signin.exchange-failed', { err: exchangeError.message })
        throw new Error(exchangeError.message)
      }
      const user = userFromSession(exchangeData?.session)
      log.info('signin.success', { provider, userId: user?.id, email: user?.email })
      return { ok: true, user, provider: PROVIDER_LABEL[provider] || provider }
    } catch (err) {
      log.error('signin.failed', { provider, err })
      return { ok: false, error: err.message || String(err) }
    } finally {
      if (server) {
        try { server.close() } catch { /* ignore */ }
      }
      inFlightServer = null
      inFlightSignIn = null
    }
  })()
  return inFlightSignIn
}

function cancelSignIn() {
  if (!inFlightSignIn) {
    log.debug('cancel-signin.noop')
    return { ok: true, cancelled: false }
  }
  log.info('cancel-signin.request')
  inFlightCancelled = true
  if (inFlightServer) {
    try { inFlightServer.close({ reason: 'Sign-in cancelled by user' }) } catch { /* ignore */ }
  }
  return { ok: true, cancelled: true }
}

async function signOut() {
  log.info('signout.start')
  try {
    const client = getClient()
    const { error } = await client.auth.signOut()
    if (error) {
      log.warn('signout.failed', { err: error.message })
      return { ok: false, error: error.message }
    }
    log.info('signout.success')
    return { ok: true }
  } catch (err) {
    log.error('signout.crashed', { err })
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
  log.debug('pairing-token.request')
  try {
    const client = getClient()
    const { data, error } = await client.auth.getSession()
    if (error) {
      log.warn('pairing-token.session-error', { err: error.message })
      return { ok: false, error: error.message }
    }
    if (!data?.session) {
      log.warn('pairing-token.not-signed-in')
      return { ok: false, error: 'Not signed in' }
    }
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
    log.info('pairing-token.issued', { userId: payload.user_id, supabaseUrl })
    return { ok: true, token }
  } catch (err) {
    log.error('pairing-token.crashed', { err })
    return { ok: false, error: err.message || String(err) }
  }
}

module.exports = { getStatus, signIn, signOut, cancelSignIn, getPairingToken, SUPPORTED_PROVIDERS }
