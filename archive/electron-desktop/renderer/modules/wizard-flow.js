import { state, dom, showStep } from './state.js'
import { t } from './i18n.js'

// Logger renderer → main (vedi desktop/preload.js, esposto come
// `window.jhtLog`). Best-effort: se preload non e' caricato per qualche
// ragione, fall back a console.log così non rompiamo il flow utente.
const log = (typeof window !== 'undefined' && window.jhtLog && window.jhtLog.scope)
  ? window.jhtLog.scope('wizard')
  : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
import {
  STEP_WELCOME,
  STEP_LOCATION,
  STEP_SUPABASE_LOGIN,
  STEP_TELEGRAM_INTRO,
  STEP_TELEGRAM_TOKENS,
  STEP_VPS_PROVISION,
  STEP_SETUP,
  STEP_CONTAINER,
  STEP_PROVIDER_CHOOSE,
  STEP_PROVIDER_INSTALL,
  STEP_PROVIDER_LOGIN,
  STEP_WORKING_HOURS,
  STEP_PROFILE_UPLOAD,
  STEP_EMAIL_SETUP,
  STEP_READY,
  LOCATION_LOCAL,
  LOCATION_VPS,
  PROVIDER_OPTIONS,
  PROVIDER_SUBSCRIBE_URL,
} from './constants.js'
import { refreshDockerStatus, onInstallWindowsStack } from './docker-card.js'
import { enterProviderLogin } from './terminal-login.js'
import {
  enterTelegramTokens,
  setTelegramTokensBeforeEnter,
  getTelegramBotsForSave,
  isTelegramTokensReady,
} from './telegram-tokens.js'

// Decide which step the user actually needs to see, based on what is
// already set up on their machine. Jumps past steps whose prerequisite
// is already satisfied so a re-launch doesn't force them through the
// whole wizard again.
export async function smartAdvanceFromWelcome() {
  // Walk the wizard in order — each step self-reports its status with
  // a checkmark and lets the user click Continue. No steps are hidden
  // from view just because they're already resolved; the user wants
  // to see the state of everything, not jump past it.
  try {
    const status = await window.setupApi.getStatus()
    state.lastStatus = status
    const saved = Array.isArray(status?.providers?.saved) ? status.providers.saved : []
    state.selectedProviders = new Set(saved)
    state.authStates = Array.isArray(status?.providers?.auth) ? status.providers.auth : []
  } catch {
    // Probe failed; walk the wizard anyway.
  }
  await enterLocation()
}

// ── Step: location (Local PC vs VPS Hetzner) ─────────────────
//
// Drives wizard branching from here onward. Selection persists via
// prefsApi (added in a follow-up commit); for now it lives only in
// state.location until the relaunch resumes from welcome anyway.

async function enterLocation() {
  showStep(STEP_LOCATION)
  // Restore any persisted choice so the user sees the previous pick
  // already selected when relaunching.
  try {
    const saved = window.prefsApi?.get ? await window.prefsApi.get('location') : null
    if (saved === LOCATION_LOCAL || saved === LOCATION_VPS) {
      state.location = saved
    }
  } catch {
    // no-op: missing prefsApi is fine
  }
  renderLocationCards()
}

function renderLocationCards() {
  const cards = [
    { el: dom.locationCardLocal, value: LOCATION_LOCAL },
    { el: dom.locationCardVps, value: LOCATION_VPS },
  ]
  for (const { el, value } of cards) {
    if (!el) continue
    el.classList.toggle('is-selected', state.location === value)
  }
  if (dom.btnLocationContinue) {
    dom.btnLocationContinue.disabled = !state.location
  }
}

function onLocationCardClick(value) {
  log.info('location.selected', { value })
  state.location = value
  renderLocationCards()
  // Persist immediately so a relaunch resumes on the right branch.
  try { window.prefsApi?.set?.('location', value) } catch (err) {
    log.warn('location.persist-failed', { err: String(err) })
  }
}

if (dom.locationCardLocal) {
  dom.locationCardLocal.addEventListener('click', () => onLocationCardClick(LOCATION_LOCAL))
}
if (dom.locationCardVps) {
  dom.locationCardVps.addEventListener('click', () => onLocationCardClick(LOCATION_VPS))
}
if (dom.btnLocationBack) {
  dom.btnLocationBack.addEventListener('click', () => showStep(STEP_WELCOME))
}
if (dom.btnLocationContinue) {
  dom.btnLocationContinue.addEventListener('click', () => {
    if (!state.location) return
    enterSupabaseLogin()
  })
}

// ── Step: Supabase OAuth ─────────────────────────────────────
//
// Local path: opt-in (skip button visible, continue always enabled).
// VPS path: required (skip hidden, continue disabled until signed in).

async function enterSupabaseLogin() {
  showStep(STEP_SUPABASE_LOGIN)
  // Adapt copy to the path and to how the user got here. Coming from the
  // "Sign in" entry point (onboardingIntent==='signin') means they already
  // have an account → "welcome back" copy, login required.
  if (dom.supabaseHint) {
    const key =
      state.onboardingIntent === 'signin'
        ? 'supabase.lead.signin'
        : state.location === LOCATION_VPS
          ? 'supabase.lead.vps'
          : 'supabase.lead.local'
    dom.supabaseHint.setAttribute('data-i18n', key)
    dom.supabaseHint.textContent = t(key)
  }
  // Skip/Continue visibility is derived from sign-in state in
  // renderSupabaseStep() below (called at the end of this function).
  // Probe current auth state — the user might already be signed in
  // from a previous session (Supabase session stored in OS keyring).
  try {
    const status = window.authApi?.getStatus ? await window.authApi.getStatus() : null
    state.supabaseUser = status?.signedIn ? status.user : null
  } catch {
    state.supabaseUser = null
  }
  renderSupabaseStep()
}

function renderSupabaseStep() {
  const signedIn = Boolean(state.supabaseUser)
  if (dom.supabaseStatus) {
    if (signedIn) {
      const name = state.supabaseUser.name || state.supabaseUser.email || 'account'
      dom.supabaseStatus.textContent = t('supabase.signedInAs', { name })
      dom.supabaseStatus.hidden = false
    } else {
      dom.supabaseStatus.textContent = ''
      dom.supabaseStatus.hidden = true
    }
  }
  if (dom.btnSupabaseGoogle) dom.btnSupabaseGoogle.hidden = signedIn
  if (dom.btnSupabaseGithub) dom.btnSupabaseGithub.hidden = signedIn
  if (dom.btnSupabaseSignout) dom.btnSupabaseSignout.hidden = !signedIn
  const isVps = state.location === LOCATION_VPS
  // "Continue" only makes sense once you're signed in — otherwise it did
  // exactly the same thing as "Skip" (both proceeded without an account),
  // which confused users. So:
  //   - not signed in, local → show "Skip" only (Continue hidden)
  //   - signed in           → show "Continue" (Skip hidden)
  //   - VPS                 → Continue always shown but disabled until signed in
  if (dom.btnSupabaseContinue) {
    dom.btnSupabaseContinue.disabled = !signedIn
    dom.btnSupabaseContinue.hidden = !isVps && !signedIn
  }
  if (dom.btnSupabaseSkip) {
    // Skip is hidden on VPS (login required), once signed in, and when the
    // user chose "Sign in" on the intro (they came here to log in).
    dom.btnSupabaseSkip.hidden = isVps || signedIn || state.onboardingIntent === 'signin'
  }
}

let currentSigninUrl = null
let urlReadyUnsub = null

function showSigninProgress() {
  if (dom.supabaseSigninProgress) dom.supabaseSigninProgress.hidden = false
  if (dom.btnSupabaseGoogle) dom.btnSupabaseGoogle.disabled = true
  if (dom.btnSupabaseGithub) dom.btnSupabaseGithub.disabled = true
  if (dom.btnSupabaseCopyUrl) {
    dom.btnSupabaseCopyUrl.hidden = true
    dom.btnSupabaseCopyUrl.textContent = t('supabase.signin.copyLink')
  }
  if (dom.supabaseSigninUrlRow) dom.supabaseSigninUrlRow.hidden = true
  if (dom.supabaseSigninUrl) {
    dom.supabaseSigninUrl.textContent = ''
    dom.supabaseSigninUrl.title = ''
  }
}

function hideSigninProgress() {
  if (dom.supabaseSigninProgress) dom.supabaseSigninProgress.hidden = true
  if (dom.btnSupabaseGoogle) dom.btnSupabaseGoogle.disabled = false
  if (dom.btnSupabaseGithub) dom.btnSupabaseGithub.disabled = false
  currentSigninUrl = null
  if (urlReadyUnsub) {
    try { urlReadyUnsub() } catch { /* ignore */ }
    urlReadyUnsub = null
  }
}

async function doSupabaseSignIn(provider) {
  log.info('supabase.signin.click', { provider })
  if (!window.authApi?.signIn) {
    log.warn('supabase.signin.no-api')
    return
  }
  showSigninProgress()
  if (window.authApi.onUrlReady) {
    urlReadyUnsub = window.authApi.onUrlReady(({ url }) => {
      currentSigninUrl = url || null
      if (currentSigninUrl) {
        if (dom.supabaseSigninUrl) {
          // Show short preview, full URL in title + on copy.
          const short = currentSigninUrl.length > 64
            ? currentSigninUrl.slice(0, 64) + '…'
            : currentSigninUrl
          dom.supabaseSigninUrl.textContent = short
          dom.supabaseSigninUrl.title = currentSigninUrl
        }
        if (dom.supabaseSigninUrlRow) dom.supabaseSigninUrlRow.hidden = false
        if (dom.btnSupabaseCopyUrl) dom.btnSupabaseCopyUrl.hidden = false
      }
    })
  }
  try {
    const res = await window.authApi.signIn(provider)
    if (!res?.ok) {
      log.warn('supabase.signin.failed', { provider, err: res?.error })
      if (dom.supabaseStatus) {
        dom.supabaseStatus.textContent = t('supabase.error', { message: res?.error || 'unknown' })
        dom.supabaseStatus.hidden = false
      }
      state.supabaseUser = null
    } else {
      log.info('supabase.signin.success', { provider, userId: res.user?.id })
      state.supabaseUser = res.user || null
    }
  } finally {
    hideSigninProgress()
    renderSupabaseStep()
  }
}

async function doSupabaseCancel() {
  if (!window.authApi?.cancelSignIn) return
  try { await window.authApi.cancelSignIn() } catch { /* ignore */ }
}

async function doSupabaseCopyUrl() {
  if (!currentSigninUrl) return
  try {
    if (window.clipboardApi?.write) {
      await window.clipboardApi.write(currentSigninUrl)
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(currentSigninUrl)
    }
    if (dom.btnSupabaseCopyUrl) {
      dom.btnSupabaseCopyUrl.textContent = t('supabase.signin.copyLink.done')
      setTimeout(() => {
        if (dom.btnSupabaseCopyUrl) {
          dom.btnSupabaseCopyUrl.textContent = t('supabase.signin.copyLink')
        }
      }, 2500)
    }
  } catch (err) {
    log.warn('supabase.signin.copy.failed', { err: err?.message })
  }
}

async function doSupabaseSignOut() {
  if (!window.authApi?.signOut) return
  try { await window.authApi.signOut() } catch { /* ignore */ }
  state.supabaseUser = null
  renderSupabaseStep()
}

if (dom.btnSupabaseGoogle) {
  dom.btnSupabaseGoogle.addEventListener('click', () => doSupabaseSignIn('google'))
}
if (dom.btnSupabaseGithub) {
  dom.btnSupabaseGithub.addEventListener('click', () => doSupabaseSignIn('github'))
}
if (dom.btnSupabaseSignout) {
  dom.btnSupabaseSignout.addEventListener('click', () => doSupabaseSignOut())
}
if (dom.btnSupabaseCancel) {
  dom.btnSupabaseCancel.addEventListener('click', () => doSupabaseCancel())
}
if (dom.btnSupabaseCopyUrl) {
  dom.btnSupabaseCopyUrl.addEventListener('click', () => doSupabaseCopyUrl())
}
if (dom.btnSupabaseBack) {
  dom.btnSupabaseBack.addEventListener('click', () => enterLocation())
}
if (dom.btnSupabaseSkip) {
  // Skip is only visible on Local path (hidden on VPS — Supabase
  // is required there). So Skip always goes to the local Docker
  // check step.
  dom.btnSupabaseSkip.addEventListener('click', () => enterSetup())
}
if (dom.btnSupabaseContinue) {
  dom.btnSupabaseContinue.addEventListener('click', () => {
    if (dom.btnSupabaseContinue.disabled) return
    advanceAfterSupabase()
  })
}

// After Supabase login the path forks:
//   - Local → Docker check on this PC (STEP_SETUP)
//   - VPS   → straight to VPS provisioning. The Telegram bot setup
//             moved to the END of the wizard (2026-05-19) so the user
//             can chat with bot 1 while waiting for BotFather's
//             rate-limit cooldown on bots 2/3 (team is already up by
//             the time Telegram tokens are entered).
function advanceAfterSupabase() {
  if (state.location === LOCATION_VPS) {
    enterVpsProvision()
  } else {
    enterSetup()
  }
}

// ─── Telegram intro + create steps (NEW) ─────────────────────────
// These two pages sit between Supabase login and Telegram tokens
// in VPS mode. They walk a non-tech user through:
//   1. What @BotFather is (telegram-intro)
//   2. Three suggested usernames they can paste into BotFather
//      (telegram-create), regenerable per role if collisions happen
// Mirrors cli/wizard/setup-steps.js::promptTelegramRequired pattern
// (b000dec5 — userTag + 3 indipendenti suffix).
const TG_CREATE_ROLES = ['assistente', 'capitano', 'mentor']
// Official emojis lifted from each agent prompt header (agents/<role>/<role>.md).
// Used both as the bot display name prefix in BotFather and as the
// section header for each row.
const TG_ROLE_EMOJI = {
  assistente: '\u{1F469}\u200D\u{1F4BC}', // 👩‍💼
  capitano:   '\u{1F468}\u200D\u2708\uFE0F', // 👨‍✈️
  mentor:     '\u{1F9D9}\u200D\u2642\uFE0F', // 🧙‍♂️
}
const TG_BOTFATHER_URL = 'https://t.me/BotFather'

function botDisplayName(role) {
  const emoji = TG_ROLE_EMOJI[role] || ''
  const name = (typeof t === 'function' && t(`telegram.agent.${role}`)) || role
  // Pattern: "<emoji> JHT <Role>" — JHT prefix is brand identifier so
  // the user's @BotFather bot list visibly groups all three JHT bots
  // among their other Telegram bots.
  return emoji ? `${emoji} JHT ${name}` : `JHT ${name}`
}

function roleHeader(role) {
  // Section header: just the translated role name, no emoji. Emoji
  // appears only in the copy-paste-into-BotFather name field below.
  return (typeof t === 'function' && t(`telegram.agent.${role}`)) || role
}

function generatePrivacySuffix(length = 6) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  const arr = new Uint8Array(length)
  // crypto.getRandomValues exists in the renderer (Electron exposes Web Crypto).
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256)
  }
  for (let i = 0; i < length; i++) out += alphabet[arr[i] % alphabet.length]
  return out
}

function defaultUserTag() {
  const email = state.supabaseUser?.email || ''
  const local = email.split('@')[0] || ''
  return local.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user'
}

function ensureTgCreateState() {
  if (!state.tgCreate) {
    state.tgCreate = { userTag: defaultUserTag(), suffixes: {} }
    for (const role of TG_CREATE_ROLES) state.tgCreate.suffixes[role] = generatePrivacySuffix(6)
  }
}

// Max len Telegram bot username = 32. Pattern: <role>_<tag>_<6>_bot
// Fixed bytes (separators + suffix + _bot) = 12. So tag.length ≤ 20 -
// role.length. Worst case is role "assistente" (10) → tag max 10. Use
// the WORST-CASE cap globally so all 3 bot usernames carry the same
// (truncated) tag — user-recognizable cross-bot.
//
// Observed 2026-05-19: a 12-char tag + role "assistente"
// produced 34-char username, rejected by BotFather with
// "Sorry, this username is invalid".
const TG_USERNAME_MAX = 32
const TG_TAG_MAX = 10

function suggestedUsername(role) {
  ensureTgCreateState()
  const tag = (state.tgCreate.userTag || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, TG_TAG_MAX) || 'user'
  return `${role}_${tag}_${state.tgCreate.suffixes[role]}_bot`
}

function makeCopyBtn(getText) {
  const btn = document.createElement('button')
  btn.className = 'btn btn--ghost btn--small'
  btn.type = 'button'
  btn.textContent = t('telegram.create.copy')
  btn.addEventListener('click', async () => {
    try {
      const text = getText()
      if (window.clipboardApi?.write) await window.clipboardApi.write(text)
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      btn.textContent = t('telegram.create.copy.done')
      setTimeout(() => { btn.textContent = t('telegram.create.copy') }, 1800)
    } catch { /* ignore */ }
  })
  return btn
}

// Build the "Insert this name + Insert this username" meta block for a
// single role and drop it into the per-row #tg-meta-<role> slot of the
// unified telegram-tokens page. Called once per role from
// renderAllTgMeta() — re-runs idempotently every time the user changes
// userTag or hits Regenerate.
function renderTgMetaForRow(role) {
  const slot = document.getElementById(`tg-meta-${role}`)
  if (!slot) return

  // Name field — what the user types into BotFather when asked "How
  // are we going to call it?". Value: "<emoji> JHT <Role>".
  const nameField = document.createElement('div')
  nameField.className = 'tg-create__field'
  const nameLabel = document.createElement('div')
  nameLabel.className = 'tg-create__field-label'
  nameLabel.textContent = t('telegram.create.nameLabel')
  const nameRow = document.createElement('div')
  nameRow.className = 'tg-create__row-actions'
  const nameValue = document.createElement('div')
  nameValue.className = 'tg-create__username'
  nameValue.textContent = botDisplayName(role)
  nameRow.append(nameValue, makeCopyBtn(() => botDisplayName(role)))
  nameField.append(nameLabel, nameRow)

  // Username field — regen-able random suffix, must end in `bot`.
  const userField = document.createElement('div')
  userField.className = 'tg-create__field'
  const userLabel = document.createElement('div')
  userLabel.className = 'tg-create__field-label'
  userLabel.textContent = t('telegram.create.usernameLabel')
  const userRow = document.createElement('div')
  userRow.className = 'tg-create__row-actions'
  const usernameEl = document.createElement('div')
  usernameEl.className = 'tg-create__username'
  usernameEl.textContent = '@' + suggestedUsername(role)
  const regenBtn = document.createElement('button')
  regenBtn.className = 'btn btn--ghost btn--small'
  regenBtn.type = 'button'
  regenBtn.textContent = t('telegram.create.regen')
  regenBtn.addEventListener('click', () => {
    ensureTgCreateState()
    state.tgCreate.suffixes[role] = generatePrivacySuffix(6)
    usernameEl.textContent = '@' + suggestedUsername(role)
  })
  userRow.append(usernameEl, makeCopyBtn(() => suggestedUsername(role)), regenBtn)
  userField.append(userLabel, userRow)

  slot.replaceChildren(nameField, userField)
}

export function renderAllTgMeta() {
  ensureTgCreateState()
  for (const role of TG_CREATE_ROLES) renderTgMetaForRow(role)
}

// Register a hook so when telegram-tokens.js's enterTelegramTokens()
// runs, the meta slots get populated first. This bridges the unified
// step's two halves (suggested name/username + token paste) without
// circular imports.
setTelegramTokensBeforeEnter(() => {
  ensureTgCreateState()
  if (dom.tgCreateUsertag) dom.tgCreateUsertag.value = state.tgCreate.userTag
  renderAllTgMeta()
})

export function enterTelegramIntro() {
  showStep(STEP_TELEGRAM_INTRO)
}

if (dom.tgIntroLink) {
  // Anchor href is set to t.me/BotFather but we intercept the click to
  // route through shell.openExternal — keeps everything in the system
  // browser and avoids any CSP weirdness with target=_blank.
  dom.tgIntroLink.addEventListener('click', (e) => {
    e.preventDefault()
    if (window.launcherApi?.openExternal) window.launcherApi.openExternal(TG_BOTFATHER_URL)
    else window.open(TG_BOTFATHER_URL, '_blank')
  })
}
// Telegram intro sits after provider-login in the new sequence
// (2026-05-19). Back goes to provider-login.
if (dom.btnTgIntroBack) dom.btnTgIntroBack.addEventListener('click', () => {
  // Lo step precedente è l'email in locale, l'upload CV in VPS (l'email è
  // saltata in VPS: working-hours + CV ora precedono Telegram, gap b3).
  if (state.location === LOCATION_VPS) enterProfileUpload()
  else enterEmailSetup()
})
// Intro Continue jumps straight to the unified tokens step — there
// used to be a separate "create" step in between, dropped 2026-05-19
// (telegram-tokens.js calls renderAllTgMeta on its enter to populate
// the per-row meta slots).
if (dom.btnTgIntroContinue) dom.btnTgIntroContinue.addEventListener('click', () => enterTelegramTokens())
// Telegram OPZIONALE (direction shift "interaction planes", 2026-06-16): lo
// skip salta i 3 bot e va diretto a "ready" (in VPS = home). Il team gira
// senza Telegram (runtime tollerante); si configura dopo da `jht config` o
// rilanciando il wizard. Speculare al confirm del wizard CLI
// (promptTelegramOptional). Chi e' gia' nello step token salta via Back → intro.
if (dom.btnTgIntroSkip) dom.btnTgIntroSkip.addEventListener('click', () => {
  log.info('telegram.skipped.intro')
  enterReady()
})
if (dom.tgCreateUsertag) {
  dom.tgCreateUsertag.addEventListener('input', () => {
    ensureTgCreateState()
    state.tgCreate.userTag = (dom.tgCreateUsertag.value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, TG_TAG_MAX)
    renderAllTgMeta()
  })
}
if (dom.tgCreateOpenBotfather) {
  dom.tgCreateOpenBotfather.addEventListener('click', (e) => {
    e.preventDefault()
    if (window.launcherApi?.openExternal) window.launcherApi.openExternal(TG_BOTFATHER_URL)
    else window.open(TG_BOTFATHER_URL, '_blank')
  })
}

// Null-guard the setup/container nav wiring: these run at module import
// (before boot). A missing id would throw here and abort the whole renderer
// boot → frozen screen. Guard so a stray HTML change degrades to a dead
// button, not a dead app.
if (dom.btnSetupBack) dom.btnSetupBack.addEventListener('click', () => enterSupabaseLogin())

if (dom.btnSetupContinue) dom.btnSetupContinue.addEventListener('click', () => {
  const dockerOk = state.docker?.check.state === 'ok'
  const depsOk = !state.extraDeps || state.extraDeps.allRequiredOk !== false
  if (!dockerOk || !depsOk) return
  showStep(STEP_CONTAINER)
  startContainerPrep()
})

if (dom.btnWinInstallEverything) {
  dom.btnWinInstallEverything.addEventListener('click', onInstallWindowsStack)
}

if (dom.btnContainerBack) dom.btnContainerBack.addEventListener('click', async () => {
  if (state.containerBusy) return
  await enterSetup()
})

async function enterSetup() {
  showStep(STEP_SETUP)
  await refreshDockerStatus()
}

if (dom.btnContainerRetry) dom.btnContainerRetry.addEventListener('click', () => {
  if (state.containerBusy) return
  startContainerPrep()
})

if (dom.btnContainerContinue) dom.btnContainerContinue.addEventListener('click', () => {
  if (state.containerReady) {
    // 2026-06-23: gli step "Subscriptions, not API keys" e "How the models
    // compare" sono stati rimossi (solo informativi) → si va dritti alla
    // scelta del provider.
    enterProviderChoose()
  }
})

// ── Step: VPS provisioning (Hetzner, manual + guided) ───────
//
// Three sub-steps inside one wizard page:
//   1. Generate SSH keypair via window.vpsApi.generateKey
//   2. Show pubkey for the user to paste on Hetzner + open portal
//   3. User pastes IP, app SSHs over and runs install.sh remotely
//
// IPC backing (vpsApi.{generateKey, getPublicKey, runInstall}) is
// added in task 12-13; this module only owns the UX choreography.
// When vpsApi isn't wired yet the buttons stay graceful (status
// message instead of crashes).

async function enterVpsProvision() {
  showStep(STEP_VPS_PROVISION)
  // If a key was generated previously (relaunch), restore it so the
  // user doesn't have to regenerate. Pubkey is non-secret.
  try {
    const existing = window.vpsApi?.getPublicKey ? await window.vpsApi.getPublicKey() : null
    if (existing?.ok && existing.pubkey) {
      state.vps.pubkey = existing.pubkey
    }
  } catch {
    // no-op: IPC not available yet
  }
  renderVpsStep()
}

function renderVpsStep() {
  const hasKey = Boolean(state.vps.pubkey)
  if (dom.vpsStep2) dom.vpsStep2.hidden = !hasKey
  if (dom.vpsStep3) dom.vpsStep3.hidden = !hasKey
  if (dom.vpsPubkey) dom.vpsPubkey.value = state.vps.pubkey || ''
  if (dom.btnVpsGenerateKey) {
    dom.btnVpsGenerateKey.textContent = hasKey
      ? t('vps.step1.regenerate')
      : t('vps.step1.generate')
  }
  updateVpsConnectState()
  if (dom.btnVpsContinue) dom.btnVpsContinue.disabled = !state.vps.installed
}

function updateVpsConnectState() {
  if (!dom.btnVpsConnect) return
  const ipOk = isValidIPv4(dom.vpsIp?.value || '')
  dom.btnVpsConnect.disabled = !state.vps.pubkey || !ipOk || state.vps.busy
}

function isValidIPv4(s) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(s || '').trim())
}

function setVpsStatus(key, vars, kind) {
  if (!dom.vpsStatus) return
  dom.vpsStatus.textContent = t(key, vars)
  dom.vpsStatus.hidden = false
  dom.vpsStatus.dataset.kind = kind || 'info'
}

async function onVpsGenerateKey() {
  log.info('vps.generate-key.click')
  if (!window.vpsApi?.generateKey) {
    log.error('vps.generate-key.no-api')
    setVpsStatus('vps.status.error', { message: 'SSH backend not wired yet' }, 'error')
    return
  }
  if (dom.btnVpsGenerateKey) dom.btnVpsGenerateKey.disabled = true
  try {
    // Chiave SEMPRE senza passphrase: la privkey resta in
    // app.getPath('userData')/ssh/ con chmod 600 → la protezione
    // arriva dai permessi filesystem, non da una passphrase che
    // complicava il flusso askpass su OpenSSH 10. Pattern usato da
    // Slack/Discord/Cursor unsigned.
    const res = await window.vpsApi.generateKey({})
    if (!res?.ok) {
      log.error('vps.generate-key.failed', { err: res?.error })
      setVpsStatus('vps.status.error', { message: res?.error || 'unknown' }, 'error')
      return
    }
    log.info('vps.generate-key.success', { pubkeyLen: res.pubkey?.length || 0 })
    state.vps.pubkey = res.pubkey
    state.vps.installed = false
    renderVpsStep()
  } finally {
    if (dom.btnVpsGenerateKey) dom.btnVpsGenerateKey.disabled = false
  }
}

async function onVpsCopyPubkey() {
  if (!state.vps.pubkey) return
  try {
    await window.clipboardApi?.write?.(state.vps.pubkey)
    if (dom.btnVpsCopyPubkey) {
      const original = dom.btnVpsCopyPubkey.textContent
      dom.btnVpsCopyPubkey.textContent = t('vps.step2.copied')
      setTimeout(() => { dom.btnVpsCopyPubkey.textContent = original }, 1500)
    }
  } catch { /* ignore */ }
}

function onVpsOpenHetzner() {
  window.launcherApi?.openExternal?.('https://console.hetzner.cloud/projects')
}

async function onVpsConnect() {
  const ip = (dom.vpsIp?.value || '').trim()
  log.info('vps.connect.click', { ip })
  if (!isValidIPv4(ip) || !state.vps.pubkey) {
    log.warn('vps.connect.invalid-input', { ipValid: isValidIPv4(ip), hasPubkey: !!state.vps.pubkey })
    return
  }
  if (!window.vpsApi?.runInstall) {
    log.error('vps.connect.no-api')
    setVpsStatus('vps.status.error', { message: 'SSH runner not wired yet' }, 'error')
    return
  }
  state.vps.busy = true
  state.vps.ip = ip
  // Persisti vpsIp nelle prefs: state in-memory si perde al restart Electron
  // ma il VPS rimane attivo. Dopo restart, il provider install / start team
  // necessitano vpsIp per fare SSH+docker exec — letto qui se manca da state.
  try { window.prefsApi?.set?.('vpsIp', ip) } catch (err) {
    log.warn('vps.ip.persist-failed', { err: String(err) })
  }
  updateVpsConnectState()
  setVpsStatus('vps.status.connecting', { ip }, 'info')
  if (dom.vpsInstallLog) {
    dom.vpsInstallLog.hidden = false
    dom.vpsInstallLog.textContent = ''
  }
  const unsubscribe = window.vpsApi.onInstallLog
    ? window.vpsApi.onInstallLog((line) => {
        if (dom.vpsInstallLog) dom.vpsInstallLog.textContent += `${line}\n`
      })
    : null
  try {
    setVpsStatus('vps.status.installing', { ip }, 'info')
    const res = await window.vpsApi.runInstall({ ip })
    if (!res?.ok) {
      log.error('vps.connect.failed', {
        ip,
        err: res?.error,
        exitCode: res?.exitCode,
        kind: res?.kind,
        phase: res?.phase,
      })
      // Errore actionable: il backend ora ritorna {error, hint, kind, phase}
      // quando ha categorizzato il fallimento (pre-flight SSH). Stampiamo
      // sia titolo che hint nel pannello log cosi' l'utente capisce subito
      // cosa fare senza dover scavare nei log.
      const lines = []
      if (res?.error) lines.push(`Errore: ${res.error}`)
      if (res?.hint) lines.push(`Suggerimento: ${res.hint}`)
      if (lines.length && dom.vpsInstallLog) {
        dom.vpsInstallLog.textContent += '\n' + lines.join('\n') + '\n'
      }
      setVpsStatus('vps.status.error', { message: res?.error || 'unknown' }, 'error')
      state.vps.installed = false
    } else {
      log.info('vps.connect.success', { ip })
      setVpsStatus('vps.status.done', { ip }, 'ok')
      state.vps.installed = true
    }
  } finally {
    state.vps.busy = false
    if (typeof unsubscribe === 'function') unsubscribe()
    renderVpsStep()
  }
}

if (dom.btnVpsGenerateKey) dom.btnVpsGenerateKey.addEventListener('click', onVpsGenerateKey)
if (dom.btnVpsCopyPubkey) dom.btnVpsCopyPubkey.addEventListener('click', onVpsCopyPubkey)
if (dom.btnVpsOpenKeyFolder) {
  dom.btnVpsOpenKeyFolder.addEventListener('click', async () => {
    if (!window.vpsApi?.openKeyFolder) return
    try {
      const res = await window.vpsApi.openKeyFolder()
      if (!res?.ok) log.warn('vps.open-key-folder.failed', { err: res?.error })
      else log.info('vps.open-key-folder.ok', { path: res.path })
    } catch (err) {
      log.warn('vps.open-key-folder.crashed', { err: err?.message })
    }
  })
}
if (dom.btnVpsOpenHetzner) dom.btnVpsOpenHetzner.addEventListener('click', onVpsOpenHetzner)
if (dom.btnVpsConnect) dom.btnVpsConnect.addEventListener('click', onVpsConnect)
if (dom.vpsIp) dom.vpsIp.addEventListener('input', updateVpsConnectState)
if (dom.btnVpsBack) {
  // VPS provisioning sits right after Supabase login now (Telegram
  // moved to the end of the wizard). Both modes go back to Supabase.
  dom.btnVpsBack.addEventListener('click', () => enterSupabaseLogin())
}
if (dom.btnVpsContinue) {
  dom.btnVpsContinue.addEventListener('click', () => {
    if (!state.vps.installed) return
    // Telegram tokens are collected AT THE END of the wizard now
    // (2026-05-19), so no persist step here. Advance straight to provider
    // choose → install → login → telegram → ready (subscription-notice +
    // model-compare removed 2026-06-23). In VPS mode the backend is
    // SSH-aware (T2): provider-install/login work on the REMOTE container.
    enterProviderChoose()
  })
}

// Persist the Telegram bot tokens collected in STEP_TELEGRAM_TOKENS.
// Local mode → ~/.jht/jht.config.json (channels.telegram.bots) via IPC.
// VPS mode  → /root/.jht/jht.config.json over SSH. Returns true on success;
// false surfaces the error in the telegram step's tg-save-status element so
// the user can retry the Continue click.
async function persistTelegramToVps() {
  const statusEl = document.getElementById('tg-save-status')
  // ── Local mode: salva i bot nel config locale (niente VPS/SSH) ──
  if (state.location !== LOCATION_VPS) {
    if (!isTelegramTokensReady()) {
      if (statusEl) {
        statusEl.textContent = t('tgSetup.save.notReady')
        statusEl.hidden = false
      }
      return false
    }
    try {
      const res = window.telegramApi?.saveBotsLocal
        ? await window.telegramApi.saveBotsLocal(getTelegramBotsForSave())
        : { ok: false, error: 'no-api' }
      if (!res?.ok) {
        if (statusEl) {
          statusEl.textContent = t('tgSetup.save.failed', { error: res?.error || 'unknown' })
          statusEl.hidden = false
        }
        return false
      }
      log.info('telegram.save.local.ok')
      return true
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = t('tgSetup.save.failed', { error: e?.message || e })
        statusEl.hidden = false
      }
      return false
    }
  }
  if (!isTelegramTokensReady()) {
    if (statusEl) {
      statusEl.textContent = t('tgSetup.save.notReady')
      statusEl.hidden = false
    }
    return false
  }
  if (!state.vps.ip) {
    if (statusEl) {
      statusEl.textContent = t('tgSetup.save.missingIp')
      statusEl.hidden = false
    }
    return false
  }
  state.telegramSaveBusy = true
  if (statusEl) {
    statusEl.textContent = t('tgSetup.save.saving')
    statusEl.hidden = false
  }
  let res
  try {
    res = await window.telegramApi.saveBotsToVps({
      vpsIp: state.vps.ip,
      bots: getTelegramBotsForSave(),
    })
  } catch (e) {
    res = { ok: false, error: e?.message || 'unknown' }
  }
  state.telegramSaveBusy = false
  if (!res?.ok) {
    state.telegramSaveError = res?.error || 'unknown error'
    if (statusEl) {
      statusEl.textContent = t('tgSetup.save.failed', { error: state.telegramSaveError })
      statusEl.hidden = false
    }
    log.warn('telegram.save.failed', { error: state.telegramSaveError })
    return false
  }
  state.telegramSaveError = null
  if (statusEl) {
    statusEl.textContent = t('tgSetup.save.done', { path: res.path || '/root/.jht/jht.config.json' })
    statusEl.hidden = false
  }
  log.info('telegram.save.ok', { path: res.path })
  return true
}

// ── Telegram-tokens step wiring (back/continue) ─────────────────────
// New flow (2026-05-19): Telegram is the LAST wizard step before ready.
// Back → telegram-intro (the previous step). Continue → VPS save the
// 3 tokens (incremental remote write via SshExec) → enterReady which
// in VPS mode bypasses to home (the team starts from there).
if (dom.btnTelegramBack) {
  dom.btnTelegramBack.addEventListener('click', () => enterTelegramIntro())
}
if (dom.btnTelegramContinue) {
  dom.btnTelegramContinue.addEventListener('click', async () => {
    if (dom.btnTelegramContinue.disabled) return
    if (!isTelegramTokensReady()) return
    const saved = await persistTelegramToVps()
    if (!saved) return // error already surfaced
    enterReady()
  })
}


async function enterProviderChoose() {
  showStep(STEP_PROVIDER_CHOOSE)
  // Restore any previously saved single-provider selection (with plan
  // tier). Legacy multi-select state is still populated from getProviders
  // for the rest of the wizard's logic that expects an array.
  try {
    const sel = window.setupApi.getSelection
      ? await window.setupApi.getSelection()
      : { provider: null, plan: null }
    state.selectedProvider = sel && sel.provider ? sel.provider : null
    state.selectedPlan = sel && sel.plan ? sel.plan : null
    state.selectedProviders = new Set(state.selectedProvider ? [state.selectedProvider] : [])
  } catch {
    // no-op: missing selection is fine
  }
  renderProviderOptions()
}

function updateProviderContinueState() {
  // 2026-06-23: si sceglie solo il NOME del provider (niente più tier di
  // abbonamento) → Continue abilitato appena un provider è selezionato.
  dom.btnProviderContinue.disabled = !state.selectedProvider
}

function renderProviderOptions() {
  const container = dom.providerOptions
  container.innerHTML = ''
  for (const opt of PROVIDER_OPTIONS) {
    const providerRadioId = `prov-${opt.id}`
    const row = document.createElement('label')
    row.className = 'provider-option'
    row.htmlFor = providerRadioId

    // Single-select: only one provider active at a time.
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'provider-select'
    radio.id = providerRadioId
    radio.value = opt.id
    radio.checked = state.selectedProvider === opt.id
    radio.addEventListener('change', () => {
      if (!radio.checked) return
      state.selectedProvider = opt.id
      state.selectedPlan = null
      state.selectedProviders = new Set([opt.id])
      renderProviderOptions()
    })

    const body = document.createElement('div')
    body.className = 'provider-option__body'

    const name = document.createElement('div')
    name.className = 'provider-option__name'
    name.textContent = opt.label

    const vendor = document.createElement('div')
    vendor.className = 'provider-option__vendor'
    vendor.textContent = opt.vendor

    body.appendChild(name)
    body.appendChild(vendor)

    const isProviderSelected = state.selectedProvider === opt.id

    // "Don't have a subscription yet?" link — opens the provider's
    // pricing page in the default browser. Always visible, so users
    // can subscribe on the spot before coming back.
    const subscribeUrl = PROVIDER_SUBSCRIBE_URL[opt.id]
    if (subscribeUrl) {
      const hint = document.createElement('p')
      hint.className = 'provider-option__subscribe-hint'
      const text = document.createElement('span')
      text.textContent = t('provider.noSubscription') + ' '
      const link = document.createElement('a')
      link.href = '#'
      link.className = 'provider-option__subscribe-link'
      link.textContent = t('provider.subscribeCta')
      link.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        window.launcherApi.openExternal(subscribeUrl).catch(() => {})
      })
      hint.appendChild(text)
      hint.appendChild(link)
      body.appendChild(hint)
    }

    row.appendChild(radio)
    row.appendChild(body)
    if (isProviderSelected) row.classList.add('provider-option--active')
    container.appendChild(row)
  }
  updateProviderContinueState()
}

dom.btnProviderBack.addEventListener('click', () => {
  // Lo step model-compare è stato rimosso (2026-06-23): Back torna al punto
  // precedente del flow — provisioning VPS in modalità VPS, altrimenti il
  // check del container locale.
  if (state.location === LOCATION_VPS) {
    enterVpsProvision()
  } else {
    showStep(STEP_CONTAINER)
  }
})

dom.btnProviderContinue.addEventListener('click', async () => {
  if (!state.selectedProvider) return
  // Persist the single-provider selection (niente più tier di abbonamento:
  // il CLI legge le entitlement reali dal proprio login, e il team
  // distribuisce comunque il budget su qualsiasi piano). Salviamo a
  // prescindere dall'esito dell'install.
  try {
    await window.setupApi.saveSelection({
      provider: state.selectedProvider,
      plan: null,
    })
  } catch { /* best-effort, not critical for the install flow */ }
  showStep(STEP_PROVIDER_INSTALL)
  startProviderInstall()
})

dom.btnProviderInstallBack.addEventListener('click', () => {
  if (state.providerInstallBusy) return
  showStep(STEP_PROVIDER_CHOOSE)
})

dom.btnProviderInstallRetry.addEventListener('click', () => {
  if (state.providerInstallBusy) return
  startProviderInstall()
})

dom.btnProviderInstallContinue.addEventListener('click', () => {
  log.info('provider-install.continue.click', {
    providerInstallDone: state.providerInstallDone,
    providerInstallBusy: state.providerInstallBusy,
  })
  if (state.providerInstallDone) {
    log.info('provider-install.continue.enterProviderLogin')
    try {
      enterProviderLogin()
    } catch (e) {
      log.error('provider-install.continue.crashed', { err: String(e?.message || e) })
    }
  } else {
    log.warn('provider-install.continue.gated', { reason: 'install not done' })
  }
})

async function startProviderInstall() {
  if (state.providerInstallBusy) return
  state.providerInstallBusy = true
  state.providerInstallDone = false
  dom.providerLog.textContent = ''
  dom.btnProviderInstallRetry.hidden = true
  dom.btnProviderInstallContinue.disabled = true
  setProgressState(dom.providerBar, dom.providerIcon, 'busy')

  // Lazy load vpsIp dalle prefs se manca in state (perso ai restart Electron).
  // Senza, host=vps fallisce con "vpsIp required" nel backend.
  if (state.location === LOCATION_VPS && !state.vps?.ip && window.prefsApi?.get) {
    try {
      const saved = await window.prefsApi.get('vpsIp')
      if (saved) {
        state.vps = state.vps || {}
        state.vps.ip = saved
        log.info('provider-install.vps-ip-restored-from-prefs', { ip: saved })
      }
    } catch (err) {
      log.warn('provider-install.prefs-read-failed', { err: String(err) })
    }
  }

  const ids = Array.from(state.selectedProviders)
  const firstName = providerLabel(ids[0]) || ids[0]
  dom.providerMessage.textContent = t('provider.installStatus.running', { name: firstName })

  // VPS mode: il backend instrada l'install via SSH al container REMOTO.
  // Local mode: omettiamo host/vpsIp, il main.js handler resta sul path
  // back-compat (docker compose run --rm jht ...).
  const installArgs = state.location === LOCATION_VPS
    ? { providerIds: ids, host: 'vps', vpsIp: state.vps?.ip || null }
    : { providerIds: ids }

  log.info('provider-install.start', { providers: ids, host: installArgs.host || 'local' })
  try {
    const result = await window.setupApi.installProviders(installArgs)
    log.info('provider-install.result', {
      ok: result?.ok,
      failedAt: result?.failedAt,
      err: result?.error,
    })
    if (result?.ok) {
      state.providerInstallDone = true
      setProgressState(dom.providerBar, dom.providerIcon, 'ok')
      dom.providerMessage.textContent = t('provider.installStatus.allDone')
      dom.btnProviderInstallContinue.disabled = false
      // VPS mode: scrive active_provider in /root/.jht/jht.config.json
      // così al primo boot del container pid1+start-agent.sh non
      // ripiegano sul default 'claude' (che non è installato). Niente
      // fallback su exception: il pair sarebbe inutile senza questo.
      if (state.location === LOCATION_VPS && state.vps?.ip && window.providerApi?.saveToVps) {
        try {
          const saveRes = await window.providerApi.saveToVps({
            vpsIp: state.vps.ip,
            provider: ids[0],
            authMethod: 'oauth',
          })
          if (!saveRes?.ok) {
            log.warn('provider-install.save-active-failed', { err: saveRes?.error })
          } else {
            log.info('provider-install.save-active-ok', { provider: ids[0] })
          }
        } catch (err) {
          log.warn('provider-install.save-active-crashed', { err: String(err) })
        }
      }
    } else {
      setProgressState(dom.providerBar, dom.providerIcon, 'error')
      const name = providerLabel(result?.failedAt) || result?.failedAt || '?'
      const err = result?.error || 'unknown'
      dom.providerMessage.textContent = t('provider.installStatus.error', { name, error: err })
      dom.btnProviderInstallRetry.hidden = false
    }
  } catch (error) {
    setProgressState(dom.providerBar, dom.providerIcon, 'error')
    const err = error instanceof Error ? error.message : String(error)
    dom.providerMessage.textContent = t('provider.installStatus.error', { name: '?', error: err })
    dom.btnProviderInstallRetry.hidden = false
  } finally {
    state.providerInstallBusy = false
  }
}

function providerLabel(id) {
  const opt = PROVIDER_OPTIONS.find((p) => p.id === id)
  return opt ? opt.label : null
}

// Guard the preload API + DOM ref: a partial preload or missing element must
// not throw at module import (would abort the whole renderer boot).
if (window.setupApi?.onProviderLog) {
  window.setupApi.onProviderLog((line) => {
    if (dom.providerLog) dom.providerLog.textContent = line
    const match = /── Installing (.+) ──/.exec(line)
    if (match && dom.providerMessage) {
      dom.providerMessage.textContent = t('provider.installStatus.running', { name: match[1] })
    }
  })
}

// ── Step: working hours (local tail) ────────────────────────────────
// L'utente sceglie quando il team lavora. Salvato in jht.config.json
// (team.working_hours) via teamApi → main → ~/.jht. Lo legge il runtime
// (working_hours.py) al boot. "24/7" = windows vuoto (nessuna restrizione).

const HOURS_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const hoursSelectedDays = new Set(['mon', 'tue', 'wed', 'thu', 'fri'])

function renderHoursDays() {
  if (!dom.hoursDays) return
  dom.hoursDays.innerHTML = ''
  for (const day of HOURS_DAYS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'hours-day-chip'
    btn.dataset.day = day
    btn.textContent = t(`hours.day.${day}`)
    if (hoursSelectedDays.has(day)) btn.classList.add('is-selected')
    btn.addEventListener('click', () => {
      if (hoursSelectedDays.has(day)) hoursSelectedDays.delete(day)
      else hoursSelectedDays.add(day)
      btn.classList.toggle('is-selected')
      updateHoursContinueState()
    })
    dom.hoursDays.appendChild(btn)
  }
}

function hoursIsAlwaysOn() {
  return Boolean(dom.hoursModeAlways && dom.hoursModeAlways.checked)
}

function applyHoursMode() {
  const always = hoursIsAlwaysOn()
  if (dom.hoursWindowFields) dom.hoursWindowFields.classList.toggle('is-disabled', always)
  // Disabilita i campi finestra quando 24/7 è scelto (chiarezza visiva).
  for (const el of [dom.hoursStart, dom.hoursEnd]) {
    if (el) el.disabled = always
  }
  if (dom.hoursDays) {
    for (const chip of dom.hoursDays.querySelectorAll('.hours-day-chip')) chip.disabled = always
  }
  updateHoursContinueState()
}

function updateHoursContinueState() {
  if (!dom.btnHoursContinue) return
  // 24/7 sempre valido; finestra valida solo con ≥1 giorno selezionato.
  dom.btnHoursContinue.disabled = !hoursIsAlwaysOn() && hoursSelectedDays.size === 0
}

// Risolve l'IP della VPS: state in-memory, con fallback sulle prefs
// (vpsIp si perde a un restart Electron ma la VPS resta su). I save VPS-aware
// (orari + upload) lo richiedono per fare SSH; senza, niente target remoto.
async function resolveVpsIp() {
  if (state.vps?.ip) return state.vps.ip
  try {
    const saved = window.prefsApi?.get ? await window.prefsApi.get('vpsIp') : null
    if (saved) {
      state.vps = state.vps || {}
      state.vps.ip = saved
      return saved
    }
  } catch { /* no-op */ }
  return null
}

export async function enterWorkingHours() {
  showStep(STEP_WORKING_HOURS)
  if (dom.hoursStatus) dom.hoursStatus.hidden = true
  // Timezone rilevato dal sistema (mostrato, non modificabile qui).
  let tz = 'UTC'
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { /* keep UTC */ }
  state.hoursTimezone = tz
  if (dom.hoursTz) dom.hoursTz.textContent = t('hours.tz', { tz })
  // Ripristina una scelta salvata in precedenza (relaunch). VPS mode: legge
  // team.working_hours dal config REMOTO via SSH; locale: da ~/.jht.
  try {
    let res = null
    if (state.location === LOCATION_VPS) {
      const vpsIp = await resolveVpsIp()
      res = vpsIp && window.teamApi?.getWorkingHoursVps
        ? await window.teamApi.getWorkingHoursVps({ vpsIp })
        : null
    } else {
      res = window.teamApi?.getWorkingHours ? await window.teamApi.getWorkingHours() : null
    }
    const wh = res && res.ok ? res.working_hours : null
    if (wh && Array.isArray(wh.windows) && wh.windows.length && Array.isArray(wh.windows[0].days)) {
      hoursSelectedDays.clear()
      for (const d of wh.windows[0].days) if (HOURS_DAYS.includes(d)) hoursSelectedDays.add(d)
      if (dom.hoursStart && wh.windows[0].start) dom.hoursStart.value = wh.windows[0].start
      if (dom.hoursEnd && wh.windows[0].end) dom.hoursEnd.value = wh.windows[0].end
      if (dom.hoursModeWindow) dom.hoursModeWindow.checked = true
      if (wh.timezone) { state.hoursTimezone = wh.timezone; if (dom.hoursTz) dom.hoursTz.textContent = t('hours.tz', { tz: wh.timezone }) }
    } else if (wh && Array.isArray(wh.windows) && wh.windows.length === 0) {
      // windows: [] salvato = 24/7
      if (dom.hoursModeAlways) dom.hoursModeAlways.checked = true
    }
  } catch { /* default Mon–Fri 09–18 */ }
  renderHoursDays()
  applyHoursMode()
}

async function saveWorkingHours() {
  let payload = null
  if (!hoursIsAlwaysOn()) {
    const start = (dom.hoursStart && dom.hoursStart.value) || '09:00'
    const end = (dom.hoursEnd && dom.hoursEnd.value) || '18:00'
    payload = {
      timezone: state.hoursTimezone || 'UTC',
      windows: [{ days: HOURS_DAYS.filter((d) => hoursSelectedDays.has(d)), start, end }],
    }
  } // else null → 24/7 (windows vuoto lato main)
  try {
    // VPS mode: scrive team.working_hours nel jht.config.json REMOTO via SSH;
    // locale: in ~/.jht. Senza questo il team VPS girava 24/7 (gap b3).
    let res
    if (state.location === LOCATION_VPS) {
      const vpsIp = await resolveVpsIp()
      if (!vpsIp) {
        log.warn('working-hours.vps.no-ip')
        if (dom.hoursStatus) { dom.hoursStatus.textContent = t('hours.saveError'); dom.hoursStatus.hidden = false }
        return false
      }
      res = window.teamApi?.setWorkingHoursVps
        ? await window.teamApi.setWorkingHoursVps({ vpsIp, working_hours: payload })
        : { ok: true }
    } else {
      res = window.teamApi?.setWorkingHours ? await window.teamApi.setWorkingHours(payload) : { ok: true }
    }
    if (!res?.ok) {
      log.warn('working-hours.save.failed', { err: res?.error })
      if (dom.hoursStatus) { dom.hoursStatus.textContent = t('hours.saveError'); dom.hoursStatus.hidden = false }
      return false
    }
    log.info('working-hours.saved', { alwaysOn: hoursIsAlwaysOn() })
    return true
  } catch (err) {
    log.warn('working-hours.save.crashed', { err: String(err) })
    if (dom.hoursStatus) { dom.hoursStatus.textContent = t('hours.saveError'); dom.hoursStatus.hidden = false }
    return false
  }
}

if (dom.hoursModeWindow) dom.hoursModeWindow.addEventListener('change', applyHoursMode)
if (dom.hoursModeAlways) dom.hoursModeAlways.addEventListener('change', applyHoursMode)
if (dom.btnHoursBack) dom.btnHoursBack.addEventListener('click', () => enterProviderLogin())
if (dom.btnHoursContinue) {
  dom.btnHoursContinue.addEventListener('click', async () => {
    if (dom.btnHoursContinue.disabled) return
    const ok = await saveWorkingHours()
    if (!ok) return
    enterProfileUpload()
  })
}

// ── Step: profile upload (CV obbligatorio) ──────────────────────────
// L'utente carica CV + documenti; il main li copia in ~/Documents/Job
// Hunter Team/allegati (bind /jht_user) e l'Assistente li legge al boot
// per costruire il profilo. Sostituisce l'onboarding-chat: serve ≥1 file
// per proseguire.

function renderUploadList(files) {
  const list = dom.uploadList
  if (!list) return
  list.innerHTML = ''
  const arr = Array.isArray(files) ? files : []
  for (const f of arr) {
    const li = document.createElement('li')
    li.className = 'upload-list__item'
    const icon = document.createElement('span')
    icon.className = 'upload-list__icon'
    icon.textContent = '📄'
    const name = document.createElement('span')
    name.className = 'upload-list__name'
    name.textContent = f.name
    li.appendChild(icon)
    li.appendChild(name)
    list.appendChild(li)
  }
  if (dom.uploadEmpty) dom.uploadEmpty.hidden = arr.length > 0
  if (dom.btnUploadContinue) dom.btnUploadContinue.disabled = arr.length === 0
}

export async function enterProfileUpload() {
  showStep(STEP_PROFILE_UPLOAD)
  let files = []
  try {
    // VPS mode: ls della drop-zone allegati REMOTA; locale: ~/Documents.
    let res = null
    if (state.location === LOCATION_VPS) {
      const vpsIp = await resolveVpsIp()
      res = vpsIp && window.profileApi?.listDocsVps
        ? await window.profileApi.listDocsVps({ vpsIp })
        : null
    } else {
      res = window.profileApi?.listDocs ? await window.profileApi.listDocs() : null
    }
    if (res?.ok && Array.isArray(res.files)) files = res.files
  } catch { /* empty */ }
  renderUploadList(files)
}

if (dom.btnUploadPick) {
  dom.btnUploadPick.addEventListener('click', async () => {
    const isVps = state.location === LOCATION_VPS
    if (isVps ? !window.profileApi?.uploadDocsVps : !window.profileApi?.uploadDocs) return
    dom.btnUploadPick.disabled = true
    try {
      // VPS mode: file-picker locale → upload nella drop-zone REMOTA via SSH;
      // locale: copia in ~/Documents. Stesso re-list per il merge.
      let res
      if (isVps) {
        const vpsIp = await resolveVpsIp()
        if (!vpsIp) { log.warn('profile-upload.vps.no-ip'); return }
        res = await window.profileApi.uploadDocsVps({ vpsIp })
      } else {
        res = await window.profileApi.uploadDocs()
      }
      if (res?.ok) {
        // Ri-leggo l'elenco completo della cartella (merge upload precedenti).
        let listed = null
        if (isVps) {
          const vpsIp = await resolveVpsIp()
          listed = vpsIp && window.profileApi.listDocsVps
            ? await window.profileApi.listDocsVps({ vpsIp })
            : null
        } else {
          listed = window.profileApi.listDocs ? await window.profileApi.listDocs() : null
        }
        renderUploadList(listed?.ok ? listed.files : res.files)
      } else {
        log.warn('profile-upload.failed', { err: res?.error })
      }
    } finally {
      dom.btnUploadPick.disabled = false
    }
  })
}
if (dom.btnUploadBack) dom.btnUploadBack.addEventListener('click', () => enterWorkingHours())
if (dom.btnUploadContinue) {
  dom.btnUploadContinue.addEventListener('click', () => {
    if (dom.btnUploadContinue.disabled) return
    // VPS mode: salta lo step email (le credenziali email_monitor.json sono
    // solo locali, gap a parte) e va dritto a Telegram → ready(home). Locale:
    // email → telegram come prima.
    if (state.location === LOCATION_VPS) enterTelegramIntro()
    else enterEmailSetup()
  })
}

// ── Step: team email inbox (obbligatorio) ───────────────────────────
// Casella DEDICATA che il team monitora per i job alert. Le credenziali
// vanno validate con un round-trip reale (IMAP login + invio SMTP di un
// codice + rilettura via IMAP) prima di poter proseguire; va anche spuntata
// la conferma "è una casella dedicata, non personale". Su validazione OK il
// main salva le credenziali in ~/.jht/credentials/email_monitor.json.

let emailValidated = false

function setEmailStatus(msg, kind) {
  if (!dom.emailSetupStatus) return
  if (!msg) { dom.emailSetupStatus.hidden = true; dom.emailSetupStatus.textContent = ''; return }
  dom.emailSetupStatus.textContent = msg
  dom.emailSetupStatus.dataset.kind = kind || 'info'
  dom.emailSetupStatus.hidden = false
}

function updateEmailContinueState() {
  if (!dom.btnEmailContinue) return
  const confirmed = Boolean(dom.emailDedicatedConfirm && dom.emailDedicatedConfirm.checked)
  dom.btnEmailContinue.disabled = !(emailValidated && confirmed)
}

// Qualsiasi modifica a email/password invalida la verifica precedente: vanno
// riverificate (le credenziali salvate potrebbero non corrispondere più).
function invalidateEmailValidation() {
  if (!emailValidated) return
  emailValidated = false
  setEmailStatus(null)
  updateEmailContinueState()
}

function emailErrorMessage(res) {
  const stage = res && res.stage
  const err = res && res.error
  if (stage === 'format' && err === 'invalid-email') return t('email.err.email')
  if (stage === 'format' && err === 'invalid-password') return t('email.err.password')
  if (stage === 'imap-login') return t('email.err.login')
  if (stage === 'smtp-send') return t('email.err.smtp')
  if (stage === 'imap-read') return t('email.err.notReceived')
  if (stage === 'save') return t('email.err.save')
  return t('email.err.generic')
}

async function onEmailVerify() {
  const email = (dom.emailAddressInput && dom.emailAddressInput.value || '').trim()
  const password = (dom.emailPasswordInput && dom.emailPasswordInput.value) || ''
  if (!email || !password) {
    setEmailStatus(t('email.err.empty'), 'error')
    return
  }
  emailValidated = false
  updateEmailContinueState()
  if (dom.btnEmailVerify) dom.btnEmailVerify.disabled = true
  setEmailStatus(t('email.verifying'), 'info')
  try {
    const res = window.emailApi?.validate
      ? await window.emailApi.validate({ email, password })
      : { ok: false, stage: 'unknown' }
    if (res && res.ok) {
      emailValidated = true
      // Niente più avviso "personal-style": l'indirizzo personale/dedicato non
      // ci interessa — la checkbox di conferma basta. Sempre messaggio di OK.
      setEmailStatus(t('email.ok'), 'ok')
      log.info('email-setup.validated')
    } else {
      emailValidated = false
      setEmailStatus(emailErrorMessage(res), 'error')
      log.warn('email-setup.validate-failed', { stage: res?.stage, err: res?.error })
    }
  } catch (err) {
    emailValidated = false
    setEmailStatus(t('email.err.generic'), 'error')
    log.warn('email-setup.validate-crashed', { err: String(err) })
  } finally {
    if (dom.btnEmailVerify) dom.btnEmailVerify.disabled = false
    updateEmailContinueState()
  }
}

export async function enterEmailSetup() {
  showStep(STEP_EMAIL_SETUP)
  emailValidated = false
  setEmailStatus(null)
  // Prefill dell'indirizzo se già configurato in precedenza (relaunch).
  try {
    const st = window.emailApi?.getStatus ? await window.emailApi.getStatus() : null
    if (st && st.email && dom.emailAddressInput && !dom.emailAddressInput.value) {
      dom.emailAddressInput.value = st.email
    }
  } catch { /* no-op */ }
  updateEmailContinueState()
}

// Due click su Google: (1) attiva la 2FA, (2) crea l'app-password. Più il
// link alla guida completa sul sito. Tutti aprono nel browser di sistema.
const GMAIL_2FA_URL = 'https://myaccount.google.com/signinoptions/twosv'
const GMAIL_APP_PW_URL = 'https://myaccount.google.com/apppasswords'
const TEAM_GMAIL_DOCS_URL = 'https://jobhunterteam.ai/docs/guides/team-gmail'
function openExternalUrl(url) {
  if (window.launcherApi?.openExternal) window.launcherApi.openExternal(url).catch(() => {})
  else window.open(url, '_blank')
}
if (dom.btnEmail2fa) dom.btnEmail2fa.addEventListener('click', () => openExternalUrl(GMAIL_2FA_URL))
if (dom.btnEmailAppPw) dom.btnEmailAppPw.addEventListener('click', () => openExternalUrl(GMAIL_APP_PW_URL))
if (dom.btnEmailDocs) dom.btnEmailDocs.addEventListener('click', () => openExternalUrl(TEAM_GMAIL_DOCS_URL))
if (dom.emailAddressInput) dom.emailAddressInput.addEventListener('input', invalidateEmailValidation)
if (dom.emailPasswordInput) dom.emailPasswordInput.addEventListener('input', invalidateEmailValidation)
if (dom.emailDedicatedConfirm) dom.emailDedicatedConfirm.addEventListener('change', updateEmailContinueState)
if (dom.btnEmailVerify) dom.btnEmailVerify.addEventListener('click', onEmailVerify)
if (dom.btnEmailBack) dom.btnEmailBack.addEventListener('click', () => enterProfileUpload())
// Email OPZIONALE (2026-06-24): "Configura dopo" salta senza salvare credenziali
// → il team farà web sourcing; l'utente può configurarla dopo dal pannello home.
if (dom.btnEmailSkip) dom.btnEmailSkip.addEventListener('click', () => {
  log.info('email-setup.skipped')
  enterTelegramIntro()
})
if (dom.btnEmailContinue) {
  dom.btnEmailContinue.addEventListener('click', () => {
    if (dom.btnEmailContinue.disabled) return
    enterTelegramIntro()
  })
}

// -------- Step: ready (summary) --------

export async function enterReady() {
  // VPS mode: skip STEP_READY (la schermata "All set" con Start button
  // pensata per il flusso locale). L'utente VPS non avvia niente da qui
  // — il team gira gia' sulla VPS remota dopo install.sh + pairing.
  // Va direttamente alla home del launcher, dove vedra' i pannelli
  // location-aware (Team, Provider, ...).
  if (state.location === LOCATION_VPS) {
    log.info('enterReady.vps.bypass-to-home')
    const { showHome } = await import('./home.js')
    await showHome('team')
    return
  }
  const status = state.lastStatus || (await safeGetStatus())
  renderSummary(status)
  showStep(STEP_READY)
}

async function safeGetStatus() {
  try { return await window.setupApi.getStatus() } catch { return null }
}

function appendSummaryRow(list, text, { logoutProviderId } = {}) {
  const li = document.createElement('li')
  li.className = 'summary-list__item'
  const icon = document.createElement('span')
  icon.className = 'summary-list__check'
  icon.textContent = '✓'
  const label = document.createElement('span')
  label.className = 'summary-list__label'
  label.textContent = text
  li.appendChild(icon)
  li.appendChild(label)
  if (logoutProviderId) {
    // Provider rows on the "All set" screen need a logout escape hatch
    // so the user can switch accounts without re-entering the wizard
    // from scratch. The button wipes the CLI's credential files on the
    // host bind-mount and re-renders the summary.
    const btn = document.createElement('button')
    btn.className = 'btn btn--ghost btn--small summary-list__action'
    btn.textContent = t('login.action.logout')
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        await window.setupApi.logoutProvider(logoutProviderId)
      } finally {
        btn.disabled = false
        const status = await safeGetStatus()
        renderSummary(status)
      }
    })
    li.appendChild(btn)
  }
  list.appendChild(li)
}

function renderSummary(status) {
  const list = dom.summaryList
  list.innerHTML = ''
  if (status?.docker?.state === 'ok') appendSummaryRow(list, t('summary.docker'))
  const wsl = status?.extra?.deps?.find((d) => d.id === 'wsl')
  if (wsl && wsl.ok) appendSummaryRow(list, t('summary.wsl'))
  if (status?.image?.present) appendSummaryRow(list, t('summary.image'))
  const authed = Array.isArray(status?.providers?.authed) ? status.providers.authed : []
  for (const id of authed) {
    const opt = PROVIDER_OPTIONS.find((p) => p.id === id)
    appendSummaryRow(
      list,
      t('summary.provider', { name: opt ? opt.label : id }),
      { logoutProviderId: id },
    )
  }
}

function setProgressState(barEl, iconEl, stateName) {
  if (barEl) barEl.dataset.state = stateName
  if (iconEl) iconEl.dataset.state = stateName
}

async function startContainerPrep() {
  if (state.containerBusy) return
  state.containerBusy = true
  state.containerReady = false
  dom.containerLog.textContent = ''
  dom.btnContainerRetry.hidden = true
  dom.btnContainerContinue.disabled = true
  setProgressState(dom.containerBar, dom.containerIcon, 'busy')
  dom.containerMessage.textContent = t('container.status.pulling')

  try {
    const result = await window.setupApi.ensureContainer()
    if (result?.ok) {
      state.containerReady = true
      setProgressState(dom.containerBar, dom.containerIcon, 'ok')
      dom.containerMessage.textContent = t('container.status.ready')
      dom.btnContainerContinue.disabled = false
    } else {
      setProgressState(dom.containerBar, dom.containerIcon, 'error')
      const msg = result?.error || 'unknown'
      dom.containerMessage.textContent = t('container.status.error', { error: msg })
      dom.btnContainerRetry.hidden = false
    }
  } catch (error) {
    setProgressState(dom.containerBar, dom.containerIcon, 'error')
    const msg = error instanceof Error ? error.message : String(error)
    dom.containerMessage.textContent = t('container.status.error', { error: msg })
    dom.btnContainerRetry.hidden = false
  } finally {
    state.containerBusy = false
  }
}

window.setupApi.onInstallLog((line) => {
  // Route the stream to whichever log panel is actually mounted for the
  // current platform (darwin → dockerInstallLog inside the docker card,
  // win32 → winInstallLog below the unified checklist).
  const target = (window.platformInfo && window.platformInfo.platform === 'win32')
    ? dom.winInstallLog : dom.dockerInstallLog
  if (!target) return
  const prev = target.textContent || ''
  const combined = `${prev}${line}\n`
  // Cap at ~4000 chars to avoid runaway memory during long installs.
  target.textContent =
    combined.length > 4000 ? combined.slice(combined.length - 4000) : combined
  target.scrollTop = target.scrollHeight
})

if (window.setupApi.onInstallStage) {
  window.setupApi.onInstallStage(({ stage, status }) => {
    setStepState(stage, status, '')
  })
}

window.setupApi.onContainerLog((line) => {
  dom.containerLog.textContent = line
  // Switch the status label heuristically when compose falls back to build.
  if (/falling back to local build/i.test(line) || /compose build/i.test(line)) {
    dom.containerMessage.textContent = t('container.status.building')
  }
})
