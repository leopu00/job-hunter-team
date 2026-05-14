import { state, showStep, appendLog } from './state.js'
import { t, getCurrentLang, setLang, initLangDropdown } from './i18n.js'
import {
  STEP_WELCOME,
  STEP_READY,
  STEP_PROVIDER_CHOOSE,
  STEP_PROVIDER_LOGIN,
  PROVIDER_OPTIONS,
  PROVIDER_PLANS,
  LOCATION_VPS,
} from './constants.js'

// Helper: location resolution dalle preferences (in-memory state si
// perde tra restart). Tutti i check VPS della home passano per questo.
async function isVpsMode() {
  if (state.location === LOCATION_VPS) return true
  if (state.location) return false
  if (!window.prefsApi?.get) return false
  try {
    const saved = await window.prefsApi.get('location')
    if (saved === LOCATION_VPS || saved === 'local') state.location = saved
    return saved === LOCATION_VPS
  } catch {
    return false
  }
}

const VPS_DASHBOARD_URL = 'https://jobhunterteam.ai/dashboard'

// -------- Home (post-setup dashboard) --------

const HOME_SECTIONS = ['team', 'provider', 'docker', 'account', 'language', 'advanced']

const homeDom = {
  root: document.getElementById('home'),
  wizardRoot: document.getElementById('wizard'),
  navItems: Array.from(document.querySelectorAll('.home__nav-item')),
  panels: Array.from(document.querySelectorAll('.home__panel')),
  teamSubtitle: document.getElementById('home-team-subtitle'),
  teamDot: document.getElementById('home-team-dot'),
  teamStatus: document.getElementById('home-team-status'),
  teamInfo: document.getElementById('home-team-info'),
  teamAdvanced: document.getElementById('home-team-advanced'),
  teamLog: document.getElementById('home-team-log'),
  teamDockerWarning: document.getElementById('home-team-docker-warning'),
  teamDockerWarningText: document.getElementById('home-team-docker-warning-text'),
  btnTeamDockerAction: document.getElementById('home-team-docker-action'),
  btnStart: document.getElementById('home-btn-start'),
  btnOpen: document.getElementById('home-btn-open'),
  btnStop: document.getElementById('home-btn-stop'),
  providerName: document.getElementById('home-provider-name'),
  providerPlan: document.getElementById('home-provider-plan'),
  providerAuth: document.getElementById('home-provider-auth'),
  btnProviderLogin: document.getElementById('home-btn-provider-login'),
  btnProviderChange: document.getElementById('home-btn-provider-change'),
  dockerState: document.getElementById('home-docker-state'),
  dockerImage: document.getElementById('home-docker-image'),
  dockerImageNameRow: document.getElementById('home-docker-image-name-row'),
  dockerImageName: document.getElementById('home-docker-image-name'),
  dockerImageVersionRow: document.getElementById('home-docker-image-version-row'),
  dockerImageVersion: document.getElementById('home-docker-image-version'),
  dockerImageCreatedRow: document.getElementById('home-docker-image-created-row'),
  dockerImageCreated: document.getElementById('home-docker-image-created'),
  dockerImageSizeRow: document.getElementById('home-docker-image-size-row'),
  dockerImageSize: document.getElementById('home-docker-image-size'),
  dockerImageReleases: document.getElementById('home-docker-image-releases'),
  btnDockerRefresh: document.getElementById('home-btn-docker-refresh'),
  btnDockerOpen: document.getElementById('home-btn-docker-open'),
  btnReopenWizard: document.getElementById('home-btn-reopen-wizard'),
  devCard: document.getElementById('home-dev-card'),
  devStatus: document.getElementById('home-dev-status'),
  btnDevStart: document.getElementById('home-btn-dev-start'),
  btnDevOpen: document.getElementById('home-btn-dev-open'),
  btnDevStop: document.getElementById('home-btn-dev-stop'),
  devAddWorktree: document.getElementById('home-dev-add-worktree'),
  devAddPort: document.getElementById('home-dev-add-port'),
  btnDevAddStart: document.getElementById('home-btn-dev-add-start'),
  devAddActive: document.getElementById('home-dev-add-active'),
  accountGuest: document.getElementById('home-account-guest'),
  accountSignedIn: document.getElementById('home-account-signedin'),
  accountBusy: document.getElementById('home-account-busy'),
  accountBusyMessage: document.getElementById('home-account-busy-message'),
  accountEmail: document.getElementById('home-account-email'),
  accountProvider: document.getElementById('home-account-provider'),
  accountError: document.getElementById('home-account-error'),
  btnAccountSigninGoogle: document.getElementById('home-account-signin-google'),
  btnAccountSigninGithub: document.getElementById('home-account-signin-github'),
  btnAccountSignout: document.getElementById('home-account-signout'),
  syncCard: document.getElementById('home-sync-card'),
  syncSubtitle: document.getElementById('home-sync-subtitle'),
  syncDisabled: document.getElementById('home-sync-disabled'),
  syncLocked: document.getElementById('home-sync-locked'),
  syncUnlocked: document.getElementById('home-sync-unlocked'),
  syncSetupPassphrase: document.getElementById('home-sync-setup-passphrase'),
  syncSetupPassphraseConfirm: document.getElementById('home-sync-setup-passphrase-confirm'),
  btnSyncSetup: document.getElementById('home-sync-setup-btn'),
  syncSetupError: document.getElementById('home-sync-setup-error'),
  syncUnlockPassphrase: document.getElementById('home-sync-unlock-passphrase'),
  btnSyncUnlock: document.getElementById('home-sync-unlock-btn'),
  btnSyncReset: document.getElementById('home-sync-reset-btn'),
  syncUnlockError: document.getElementById('home-sync-unlock-error'),
  syncMeta: document.getElementById('home-sync-meta'),
  btnSyncPush: document.getElementById('home-sync-push-btn'),
  btnSyncPull: document.getElementById('home-sync-pull-btn'),
  btnSyncLock: document.getElementById('home-sync-lock-btn'),
  btnSyncDisable: document.getElementById('home-sync-disable-btn'),
  syncActionError: document.getElementById('home-sync-action-error'),
  syncActionSuccess: document.getElementById('home-sync-action-success'),
}

// Wizard appears only on first launch. The discriminator is "has the
// user ever picked a provider": `providers.saved.length > 0` means they
// already went through onboarding at least once, so on later launches
// land them on the home view even if Docker is down or kimi isn't
// authed — those are recoverable runtime states the home surfaces with
// banners, not setup-incomplete states that warrant the full wizard.
export function isSetupComplete(status) {
  if (!status) return false
  const saved = Array.isArray(status.providers?.saved) ? status.providers.saved : []
  return saved.length > 0
}

export function showWizard(step = STEP_WELCOME) {
  homeDom.root.hidden = true
  homeDom.wizardRoot.hidden = false
  state.view = 'wizard'
  stopTeamPanelPoll()
  showStep(step)
}

export async function showHome(section = 'team') {
  homeDom.wizardRoot.hidden = true
  homeDom.root.hidden = false
  state.view = 'home'
  setHomeSection(section)
  await refreshHomeAll()
}

// Background poll for the team panel: while the user is looking at it
// we re-check team + docker state every 5s so the warning appears as
// soon as Docker is closed externally and clears as soon as it comes
// back. The post-click polling (3s, capped at 90s) is layered on top
// for the spinner UX — see startTeamDockerPolling.
let teamPanelTimer = null
const TEAM_PANEL_POLL_MS = 5000

function startTeamPanelPoll() {
  if (teamPanelTimer) return
  teamPanelTimer = setInterval(() => {
    refreshHomeTeam().catch(() => {})
  }, TEAM_PANEL_POLL_MS)
}

function stopTeamPanelPoll() {
  if (teamPanelTimer) {
    clearInterval(teamPanelTimer)
    teamPanelTimer = null
  }
}

function setHomeSection(name) {
  if (!HOME_SECTIONS.includes(name)) name = 'team'
  state.homeSection = name
  for (const btn of homeDom.navItems) {
    const active = btn.dataset.section === name
    btn.classList.toggle('is-active', active)
    btn.setAttribute('aria-selected', active ? 'true' : 'false')
  }
  for (const panel of homeDom.panels) {
    panel.hidden = panel.dataset.section !== name
  }
  if (name === 'team') {
    refreshHomeTeam()
    startTeamPanelPoll()
  } else {
    stopTeamPanelPoll()
    if (name === 'provider') refreshHomeProvider()
    else if (name === 'docker') refreshHomeDocker()
  }
}

async function refreshHomeAll() {
  await Promise.all([
    refreshHomeTeam().catch(() => {}),
    refreshHomeProvider().catch(() => {}),
    refreshHomeDocker().catch(() => {}),
    refreshHomeAccount().catch(() => {}),
  ])
}

function setAccountState(name, { message } = {}) {
  // Mutually-exclusive cards inside the account panel: guest | signedin
  // | busy. We toggle hidden rather than swapping innerHTML so the
  // [data-i18n] inside survives applyTranslations re-runs.
  homeDom.accountGuest.hidden = name !== 'guest'
  homeDom.accountSignedIn.hidden = name !== 'signedin'
  homeDom.accountBusy.hidden = name !== 'busy'
  if (name === 'busy' && message && homeDom.accountBusyMessage) {
    homeDom.accountBusyMessage.textContent = message
  }
  if (name !== 'guest' && homeDom.accountError) {
    homeDom.accountError.hidden = true
    homeDom.accountError.textContent = ''
  }
}

async function refreshHomeAccount() {
  if (!window.authApi?.getStatus) return
  try {
    const status = await window.authApi.getStatus()
    if (status?.signedIn && status.user) {
      homeDom.accountEmail.textContent = status.user.email || status.user.name || status.user.id
      homeDom.accountProvider.textContent = status.user.provider
        ? `via ${status.user.provider}`
        : ''
      setAccountState('signedin')
      if (homeDom.syncCard) homeDom.syncCard.hidden = false
      await refreshHomeSync()
    } else {
      setAccountState('guest')
      if (homeDom.syncCard) homeDom.syncCard.hidden = true
    }
  } catch {
    setAccountState('guest')
    if (homeDom.syncCard) homeDom.syncCard.hidden = true
  }
}

function setSyncState(name) {
  if (homeDom.syncDisabled) homeDom.syncDisabled.hidden = name !== 'disabled'
  if (homeDom.syncLocked) homeDom.syncLocked.hidden = name !== 'locked'
  if (homeDom.syncUnlocked) homeDom.syncUnlocked.hidden = name !== 'unlocked'
  // Clear stale messages when switching state.
  for (const el of [homeDom.syncSetupError, homeDom.syncUnlockError, homeDom.syncActionError, homeDom.syncActionSuccess]) {
    if (el) { el.hidden = true; el.textContent = '' }
  }
}

function formatSyncMeta(status) {
  const fmt = (iso) => {
    if (!iso) return null
    try {
      return new Date(iso).toLocaleString(getCurrentLang() || undefined, {
        year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }
  const parts = []
  if (status.lastLocalSyncAt) {
    parts.push(t('home.sync.metaLastSync', { ts: fmt(status.lastLocalSyncAt) }))
  } else {
    parts.push(t('home.sync.metaNeverSynced'))
  }
  if (status.cloudExists && status.cloudUpdatedAt) {
    parts.push(t('home.sync.metaCloudUpdated', { ts: fmt(status.cloudUpdatedAt) }))
  } else if (!status.cloudExists) {
    parts.push(t('home.sync.metaNoCloudData'))
  }
  return parts.join(' · ')
}

async function refreshHomeSync() {
  if (!window.syncApi?.getStatus || !homeDom.syncCard) return
  try {
    const status = await window.syncApi.getStatus()
    if (!status?.ok) {
      setSyncState('disabled')
      return
    }
    if (!status.enabled) {
      setSyncState('disabled')
      return
    }
    if (!status.unlocked) {
      setSyncState('locked')
      return
    }
    if (homeDom.syncMeta) homeDom.syncMeta.textContent = formatSyncMeta(status)
    setSyncState('unlocked')
  } catch {
    setSyncState('disabled')
  }
}

function showSyncError(el, msg) {
  if (!el) return
  el.textContent = msg
  el.hidden = false
}

function showSyncSuccess(msg) {
  if (!homeDom.syncActionSuccess) return
  homeDom.syncActionSuccess.textContent = msg
  homeDom.syncActionSuccess.hidden = false
  setTimeout(() => {
    if (homeDom.syncActionSuccess) homeDom.syncActionSuccess.hidden = true
  }, 4000)
}

// Collect the minimal launcher state we round-trip through the cloud.
// Intentionally NOT included: auth tokens, CLI credentials, anything
// in `~/.jht/credentials/` — those live in the OS keychain by design
// (ADR 0004) and must not leave the device.
async function collectSyncPayload() {
  const payload = { version: 1, savedAt: new Date().toISOString() }
  try {
    const selection = await window.setupApi.getSelection()
    payload.providerSelection = selection || null
  } catch {
    payload.providerSelection = null
  }
  return payload
}

async function applySyncPayload(data) {
  if (!data?.providerSelection) return
  try {
    await window.setupApi.saveSelection(data.providerSelection)
  } catch {
    // best-effort apply; user will see the meta updated but config not applied.
  }
}

async function onSyncSetup() {
  const p1 = homeDom.syncSetupPassphrase?.value || ''
  const p2 = homeDom.syncSetupPassphraseConfirm?.value || ''
  if (p1.length < 8) {
    showSyncError(homeDom.syncSetupError, t('home.sync.errorTooShort'))
    return
  }
  if (p1 !== p2) {
    showSyncError(homeDom.syncSetupError, t('home.sync.errorMismatch'))
    return
  }
  const res = await window.syncApi.setup({ passphrase: p1 })
  if (!res?.ok) {
    showSyncError(homeDom.syncSetupError, res?.error || t('home.sync.errorGeneric'))
    return
  }
  if (homeDom.syncSetupPassphrase) homeDom.syncSetupPassphrase.value = ''
  if (homeDom.syncSetupPassphraseConfirm) homeDom.syncSetupPassphraseConfirm.value = ''
  // Immediate first push of current state so the cloud has something
  // to pull on the next device.
  const payload = await collectSyncPayload()
  const pushRes = await window.syncApi.push({ data: payload })
  if (!pushRes?.ok) {
    showSyncError(homeDom.syncSetupError, pushRes?.error || t('home.sync.errorGeneric'))
  }
  await refreshHomeSync()
}

async function onSyncUnlock() {
  const p = homeDom.syncUnlockPassphrase?.value || ''
  if (!p) {
    showSyncError(homeDom.syncUnlockError, t('home.sync.errorEmpty'))
    return
  }
  const res = await window.syncApi.unlock({ passphrase: p })
  if (!res?.ok) {
    showSyncError(homeDom.syncUnlockError, res?.error || t('home.sync.errorGeneric'))
    return
  }
  if (homeDom.syncUnlockPassphrase) homeDom.syncUnlockPassphrase.value = ''
  await refreshHomeSync()
}

async function onSyncReset() {
  const res = await window.syncApi.disable({ wipeCloud: false })
  if (!res?.ok) {
    showSyncError(homeDom.syncUnlockError, res?.error || t('home.sync.errorGeneric'))
    return
  }
  await refreshHomeSync()
}

async function onSyncPush() {
  const payload = await collectSyncPayload()
  const res = await window.syncApi.push({ data: payload })
  if (!res?.ok) {
    showSyncError(homeDom.syncActionError, res?.error || t('home.sync.errorGeneric'))
    return
  }
  showSyncSuccess(t('home.sync.pushedOk'))
  await refreshHomeSync()
}

async function onSyncPull() {
  const res = await window.syncApi.pull()
  if (!res?.ok) {
    showSyncError(homeDom.syncActionError, res?.error || t('home.sync.errorGeneric'))
    return
  }
  await applySyncPayload(res.data)
  showSyncSuccess(t('home.sync.pulledOk'))
  await refreshHomeSync()
}

async function onSyncLock() {
  await window.syncApi.lock()
  await refreshHomeSync()
}

async function onSyncDisable() {
  const res = await window.syncApi.disable({ wipeCloud: true })
  if (!res?.ok) {
    showSyncError(homeDom.syncActionError, res?.error || t('home.sync.errorGeneric'))
    return
  }
  await refreshHomeSync()
}

if (homeDom.btnSyncSetup) homeDom.btnSyncSetup.addEventListener('click', onSyncSetup)
if (homeDom.btnSyncUnlock) homeDom.btnSyncUnlock.addEventListener('click', onSyncUnlock)
if (homeDom.btnSyncReset) homeDom.btnSyncReset.addEventListener('click', onSyncReset)
if (homeDom.btnSyncPush) homeDom.btnSyncPush.addEventListener('click', onSyncPush)
if (homeDom.btnSyncPull) homeDom.btnSyncPull.addEventListener('click', onSyncPull)
if (homeDom.btnSyncLock) homeDom.btnSyncLock.addEventListener('click', onSyncLock)
if (homeDom.btnSyncDisable) homeDom.btnSyncDisable.addEventListener('click', onSyncDisable)

async function startSignIn(provider) {
  if (!window.authApi?.signIn) return
  setAccountState('busy', { message: t('home.account.busy') })
  try {
    const res = await window.authApi.signIn(provider)
    if (!res?.ok) {
      setAccountState('guest')
      if (homeDom.accountError) {
        homeDom.accountError.textContent = res?.error
          ? t('home.account.error', { msg: res.error })
          : t('home.account.errorGeneric')
        homeDom.accountError.hidden = false
      }
      return
    }
    await refreshHomeAccount()
  } catch (err) {
    setAccountState('guest')
    if (homeDom.accountError) {
      homeDom.accountError.textContent = t('home.account.error', { msg: err.message || err })
      homeDom.accountError.hidden = false
    }
  }
}

async function signOut() {
  if (!window.authApi?.signOut) return
  try {
    await window.authApi.signOut()
  } finally {
    await refreshHomeAccount()
  }
}

if (homeDom.btnAccountSigninGoogle) {
  homeDom.btnAccountSigninGoogle.addEventListener('click', () => startSignIn('google'))
}
if (homeDom.btnAccountSigninGithub) {
  homeDom.btnAccountSigninGithub.addEventListener('click', () => startSignIn('github'))
}
if (homeDom.btnAccountSignout) {
  homeDom.btnAccountSignout.addEventListener('click', () => signOut())
}

function renderHomeTeamStatus(status, { vps = false, vpsIp = null } = {}) {
  const mode = status?.mode
  // In VPS mode il team gira sulla VPS remota, sempre "running" dal punto
  // di vista del desktop launcher (il container e' stato installato e
  // partito da install.sh sulla VPS). Il dot è verde, niente Start
  // button locale, l'Open apre la dashboard cloud.
  if (vps) {
    homeDom.teamDot.dataset.state = 'running'
    homeDom.teamStatus.textContent = t('home.team.statusVpsRunning')
    homeDom.teamSubtitle.textContent = t('home.team.subtitleVps')
    homeDom.btnStart.hidden = true
    homeDom.btnOpen.hidden = false
    homeDom.btnStop.hidden = true
    homeDom.teamInfo.innerHTML = ''
    const pushRow = (label, value) => {
      if (!value) return
      const row = document.createElement('div')
      row.className = 'info-row'
      const l = document.createElement('span')
      l.className = 'info-row__label'
      l.textContent = label
      const v = document.createElement('span')
      v.className = 'info-row__value'
      v.textContent = value
      row.append(l, v)
      homeDom.teamInfo.appendChild(row)
    }
    pushRow(t('home.team.vpsIp'), vpsIp || '—')
    pushRow(t('home.team.dashboardUrl'), VPS_DASHBOARD_URL)
    homeDom.teamInfo.hidden = false
    homeDom.teamAdvanced.hidden = true
    homeDom.teamLog.textContent = ''
    // Docker warning del Team panel: in VPS mode il Docker e' remoto,
    // niente da segnalare lato launcher.
    if (homeDom.teamDockerWarning) homeDom.teamDockerWarning.hidden = true
    return
  }
  const running = !!status?.running && (mode === 'running' || mode === 'external')
  const starting = mode === 'starting' || mode === 'warming'
  const errored = mode === 'error'
  let dotState = 'stopped'
  let subtitleKey = 'home.team.subtitleStopped'
  let statusKey = 'home.team.statusStopped'
  if (running) {
    dotState = 'running'
    subtitleKey = 'home.team.subtitleRunning'
    statusKey = 'home.team.statusRunning'
  } else if (starting) {
    dotState = 'starting'
    subtitleKey = 'home.team.subtitleStarting'
    statusKey = 'home.team.statusStarting'
  } else if (errored) {
    dotState = 'error'
    statusKey = 'home.team.statusError'
  }
  homeDom.teamDot.dataset.state = dotState
  homeDom.teamStatus.textContent = t(statusKey)
  homeDom.teamSubtitle.textContent = t(subtitleKey)
  homeDom.btnStart.hidden = running || starting
  homeDom.btnOpen.hidden = !running
  homeDom.btnStop.hidden = !(running || starting)
  // Info rows
  homeDom.teamInfo.innerHTML = ''
  const pushRow = (label, value) => {
    if (value === undefined || value === null || value === '') return
    const row = document.createElement('div')
    row.className = 'info-row'
    const l = document.createElement('span')
    l.className = 'info-row__label'
    l.textContent = label
    const v = document.createElement('span')
    v.className = 'info-row__value'
    v.textContent = value
    row.append(l, v)
    homeDom.teamInfo.appendChild(row)
  }
  if (status?.url) pushRow(t('running.info.url'), status.url)
  if (status?.port) pushRow(t('running.info.port'), String(status.port))
  if (mode) pushRow(t('running.info.mode'), mode)
  homeDom.teamInfo.hidden = homeDom.teamInfo.childElementCount === 0
  if (status?.lastError) {
    homeDom.teamAdvanced.hidden = false
    homeDom.teamLog.textContent = String(status.lastError)
  } else {
    homeDom.teamAdvanced.hidden = true
    homeDom.teamLog.textContent = ''
  }
}

// Polls docker status every 3s after the user clicked the warning's
// action button (Open Docker Desktop / Start Colima). Stops as soon as
// the gate clears (state=ok), or after 90s. While polling, the button
// shows a spinner and the body text switches to "waiting for Docker".
let teamDockerPollTimer = null
const TEAM_DOCKER_POLL_MS = 3000
const TEAM_DOCKER_POLL_MAX = 30

function stopTeamDockerPolling() {
  if (teamDockerPollTimer) {
    clearInterval(teamDockerPollTimer)
    teamDockerPollTimer = null
  }
  state.teamDockerPolling = false
}

function startTeamDockerPolling() {
  if (state.teamDockerPolling) return
  state.teamDockerPolling = true
  let tries = 0
  // Render the busy state immediately (don't wait for the first tick).
  refreshHomeTeam().catch(() => {})
  teamDockerPollTimer = setInterval(async () => {
    tries += 1
    try {
      await refreshHomeTeam()
    } catch (_) { /* keep polling */ }
    if (homeDom.btnStart.dataset.dockerBlocked !== '1') {
      stopTeamDockerPolling()
      return
    }
    if (tries >= TEAM_DOCKER_POLL_MAX) {
      stopTeamDockerPolling()
      refreshHomeTeam().catch(() => {})
    }
  }, TEAM_DOCKER_POLL_MS)
}

function setActionButtonBusy(label) {
  homeDom.btnTeamDockerAction.hidden = false
  homeDom.btnTeamDockerAction.disabled = true
  homeDom.btnTeamDockerAction.innerHTML = ''
  const spinner = document.createElement('span')
  spinner.className = 'status-icon'
  spinner.dataset.state = 'busy'
  const text = document.createElement('span')
  text.textContent = label
  homeDom.btnTeamDockerAction.append(spinner, ' ', text)
}

function setActionButtonIdle(label, action) {
  homeDom.btnTeamDockerAction.hidden = false
  homeDom.btnTeamDockerAction.disabled = false
  homeDom.btnTeamDockerAction.textContent = label
  homeDom.btnTeamDockerAction.dataset.action = action
}

async function refreshHomeTeamDockerGate(teamStatus, { vps = false } = {}) {
  if (vps) {
    // VPS mode: Docker gira sulla VPS, non sul desktop. Nessun gate.
    if (homeDom.teamDockerWarning) homeDom.teamDockerWarning.hidden = true
    if (homeDom.btnStart) {
      homeDom.btnStart.disabled = false
      delete homeDom.btnStart.dataset.dockerBlocked
    }
    stopTeamDockerPolling()
    return
  }
  // Always evaluate Docker independently of team state: a "running"
  // team without a healthy Docker daemon is a misleading state — the
  // dashboard might still respond but the agents aren't working. The
  // warning is informative, not just a Start-button gate.
  let dockerStatus = null
  try {
    dockerStatus = await window.setupApi.getDockerStatus()
  } catch (error) {
    appendLog(`refreshHomeTeamDockerGate: ${error.message || error}`)
    return
  }
  const s = dockerStatus?.check?.state
  if (s === 'ok') {
    homeDom.teamDockerWarning.hidden = true
    homeDom.btnStart.disabled = false
    delete homeDom.btnStart.dataset.dockerBlocked
    stopTeamDockerPolling()
    return
  }
  const platform = dockerStatus?.platform || window.platformInfo?.platform || 'linux'
  // Polling overrides the body+button: unified "starting" UX regardless
  // of the current sub-state (Desktop process up but daemon not, etc).
  if (state.teamDockerPolling) {
    homeDom.teamDockerWarningText.textContent = t('home.team.dockerWarning.bodyAutoCheck')
    setActionButtonBusy(t('home.team.dockerWarning.starting'))
  } else {
    let bodyKey = 'home.team.dockerWarning.bodyGeneric'
    if (s === 'not-running') bodyKey = `home.team.dockerWarning.bodyNotRunning.${platform}`
    else if (s === 'missing') bodyKey = 'home.team.dockerWarning.bodyMissing'
    else if (s === 'starting') bodyKey = 'home.team.dockerWarning.bodyStarting'
    else if (s === 'needs-reboot') bodyKey = 'home.team.dockerWarning.bodyNeedsReboot'
    let body = t(bodyKey)
    if (body === bodyKey) body = t('home.team.dockerWarning.bodyGeneric')
    homeDom.teamDockerWarningText.textContent = body
    if (platform === 'win32' && (s === 'not-running' || s === 'starting')) {
      setActionButtonIdle(t('home.docker.openDesktop'), 'openDesktop')
    } else if (platform === 'darwin' && (s === 'not-running' || s === 'needs-reboot')) {
      setActionButtonIdle(t('docker.action.startColima'), 'startColima')
    } else {
      setActionButtonIdle(t('home.team.dockerWarning.recheck'), 'recheck')
    }
  }
  homeDom.teamDockerWarning.hidden = false
  homeDom.btnStart.disabled = true
  homeDom.btnStart.dataset.dockerBlocked = '1'
}

async function refreshHomeTeam() {
  try {
    const vps = await isVpsMode()
    if (vps) {
      const vpsIp = (await window.prefsApi?.get('vpsIp').catch(() => null)) || state.vps?.ip || null
      renderHomeTeamStatus(null, { vps: true, vpsIp })
      await refreshHomeTeamDockerGate(null, { vps: true })
      return
    }
    const status = await window.launcherApi.getStatus()
    renderHomeTeamStatus(status)
    await refreshHomeTeamDockerGate(status)
  } catch (error) {
    appendLog(`refreshHomeTeam: ${error.message || error}`)
  }
}

async function startTeamFromHome() {
  if (state.starting) return
  // Carica location dalle prefs se non gia' in state (perso ai restart).
  if (!state.location && window.prefsApi?.get) {
    try {
      const saved = await window.prefsApi.get('location')
      if (saved === 'local' || saved === 'vps') state.location = saved
    } catch { /* ignore */ }
  }
  // VPS mode: il team gira sulla VPS, NON sul Mac. Skippa Docker probe +
  // payload download + container locale + browser localhost — apre la
  // dashboard cloud (Supabase sincronizza dalla VPS). Vedi
  // docs/internal/onboarding-flow.md § Path 2.
  if (state.location === 'vps') {
    const dashboardUrl = 'https://jobhunterteam.ai/dashboard'
    try {
      await window.launcherApi.openExternal(dashboardUrl)
    } catch (error) {
      appendLog(`startTeamFromHome vps openExternal: ${error.message || error}`)
    }
    return
  }
  // Always re-probe Docker right before starting: the dockerBlocked
  // flag is only as fresh as the last gate run, and Docker may have
  // died between refreshes (the panel poll runs every 5s, leaving a
  // window where Start would slip through). If the daemon is not ok,
  // refresh the gate (which surfaces the warning) and bail.
  try {
    const dockerStatus = await window.setupApi.getDockerStatus()
    if (dockerStatus?.check?.state !== 'ok') {
      await refreshHomeTeam()
      return
    }
  } catch (error) {
    appendLog(`startTeamFromHome docker probe: ${error.message || error}`)
    await refreshHomeTeam()
    return
  }
  state.starting = true
  homeDom.btnStart.disabled = true
  const original = homeDom.btnStart.textContent
  homeDom.btnStart.textContent = t('running.startingBtn')
  renderHomeTeamStatus({ mode: 'starting', running: false })
  try {
    const payloadInfo = await window.launcherApi.getPayloadDir()
    if (!payloadInfo?.present) {
      const result = await window.launcherApi.ensurePayload({ update: false })
      if (!result?.ok) throw new Error(result?.error || 'download failed')
    }
    const status = await window.launcherApi.start({})
    renderHomeTeamStatus(status)
    if (status?.running && status?.url) {
      await window.launcherApi.openBrowser().catch(() => {})
    }
  } catch (error) {
    appendLog(`startTeamFromHome: ${error.message || error}`)
    renderHomeTeamStatus({ mode: 'error', lastError: error.message || String(error) })
  } finally {
    state.starting = false
    homeDom.btnStart.disabled = false
    homeDom.btnStart.textContent = original
  }
}

async function stopTeamFromHome() {
  homeDom.btnStop.disabled = true
  try {
    await window.launcherApi.stop()
    await refreshHomeTeam()
  } catch (error) {
    appendLog(`stopTeamFromHome: ${error.message || error}`)
  } finally {
    homeDom.btnStop.disabled = false
  }
}

async function refreshHomeProvider() {
  try {
    const sel = await window.setupApi.getSelection()
    const opt = PROVIDER_OPTIONS.find((p) => p.id === sel?.provider)
    homeDom.providerName.textContent = opt ? opt.label : (sel?.provider || '—')
    const plan = sel?.plan ? (PROVIDER_PLANS[sel.provider] || []).find((p) => p.id === sel.plan) : null
    homeDom.providerPlan.textContent = plan ? plan.name : (sel?.plan || '—')
    const authResp = await window.setupApi.getAuthStates()
    const authList = Array.isArray(authResp?.auth) ? authResp.auth : []
    const row = authList.find((a) => a.id === sel?.provider)
    if (row?.authed) {
      homeDom.providerAuth.textContent = t('home.provider.authed')
      homeDom.providerAuth.style.color = 'var(--success)'
    } else {
      homeDom.providerAuth.textContent = t('home.provider.unauthed')
      homeDom.providerAuth.style.color = 'var(--danger)'
    }
  } catch (error) {
    appendLog(`refreshHomeProvider: ${error.message || error}`)
  }
}

function formatImageSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1 }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatImageDate(iso) {
  if (typeof iso !== 'string' || !iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  // Locale-aware short date + HH:MM. Falls back gracefully if Intl is
  // unavailable (older Electron / stripped builds).
  try {
    return d.toLocaleString(getCurrentLang() || undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

function formatImageVersion(image) {
  // Prefer the registry digest (the immutable identifier behind ":latest"
  // — what actually changes when a new image is published). Fall back to
  // the local image id if the image was built locally and has no digest.
  const digest = Array.isArray(image?.digests) && image.digests.length
    ? image.digests[0]
    : null
  const sha = digest && digest.includes('@')
    ? digest.split('@').pop()
    : (typeof image?.id === 'string' ? image.id : null)
  if (typeof sha === 'string' && sha.startsWith('sha256:')) {
    return sha.slice(7, 19) // short 12-char SHA
  }
  return null
}

function renderDockerImageMetadata(image) {
  const setRow = (rowEl, valueEl, value) => {
    if (value) {
      valueEl.textContent = value
      rowEl.hidden = false
    } else {
      rowEl.hidden = true
    }
  }
  if (!image || !image.present) {
    homeDom.dockerImageNameRow.hidden = true
    homeDom.dockerImageVersionRow.hidden = true
    homeDom.dockerImageCreatedRow.hidden = true
    homeDom.dockerImageSizeRow.hidden = true
    return
  }
  const name = (Array.isArray(image.tags) && image.tags[0]) || image.image || null
  setRow(homeDom.dockerImageNameRow, homeDom.dockerImageName, name)
  setRow(homeDom.dockerImageVersionRow, homeDom.dockerImageVersion, formatImageVersion(image))
  setRow(homeDom.dockerImageCreatedRow, homeDom.dockerImageCreated, formatImageDate(image.created))
  setRow(homeDom.dockerImageSizeRow, homeDom.dockerImageSize, formatImageSize(image.size))
}

async function refreshHomeDocker() {
  try {
    if (await isVpsMode()) {
      // VPS mode: Docker e' remoto. Sostituisci stato locale con
      // info VPS (IP + image registry link). Nascondi i bottoni che
      // gestiscono il daemon locale (Open Docker Desktop / Colima).
      const vpsIp = (await window.prefsApi?.get('vpsIp').catch(() => null)) || state.vps?.ip || '—'
      homeDom.dockerState.textContent = t('home.docker.vpsCompany', { ip: vpsIp })
      homeDom.dockerState.style.color = 'var(--success)'
      homeDom.dockerImage.textContent = t('home.docker.vpsImageCompany')
      homeDom.dockerImage.style.color = 'var(--text-dim)'
      renderDockerImageMetadata(null)
      homeDom.btnDockerOpen.hidden = true
      return
    }
    const dockerStatus = await window.setupApi.getDockerStatus()
    const s = dockerStatus?.check?.state
    if (s === 'ok') {
      homeDom.dockerState.textContent = t('docker.state.ok')
      homeDom.dockerState.style.color = 'var(--success)'
    } else {
      const key = `docker.state.${s || 'missing'}`
      const label = t(key)
      homeDom.dockerState.textContent = label !== key ? label : (s || '—')
      homeDom.dockerState.style.color = 'var(--warn)'
    }
    const full = await window.setupApi.getStatus()
    const imgOk = full?.image?.present === true
    homeDom.dockerImage.textContent = imgOk ? t('home.docker.imagePresent') : t('home.docker.imageMissing')
    homeDom.dockerImage.style.color = imgOk ? 'var(--success)' : 'var(--warn)'
    renderDockerImageMetadata(imgOk ? full?.image : null)
    // Bottone "accendi runtime": label e azione cambiano per OS.
    // Linux: nessun bottone (il daemon parte da systemctl). Mac: "Avvia
    // Colima" → fa partire il VM Colima. Win: "Apri Docker Desktop".
    // Mostrato solo se il runtime non è già pronto.
    const platform = dockerStatus?.platform
    const isOk = s === 'ok'
    if (platform === 'linux' || isOk) {
      homeDom.btnDockerOpen.hidden = true
    } else {
      homeDom.btnDockerOpen.hidden = false
      homeDom.btnDockerOpen.textContent = platform === 'darwin'
        ? t('docker.action.startColima')
        : t('home.docker.openDesktop')
    }
  } catch (error) {
    appendLog(`refreshHomeDocker: ${error.message || error}`)
  }
}

// Wiring home
for (const btn of homeDom.navItems) {
  btn.addEventListener('click', () => setHomeSection(btn.dataset.section))
}
homeDom.btnStart.addEventListener('click', startTeamFromHome)
homeDom.btnStop.addEventListener('click', stopTeamFromHome)
homeDom.btnOpen.addEventListener('click', async () => {
  // In VPS mode "Apri team" punta alla dashboard cloud, non al
  // localhost:3000 del container desktop (che non esiste). In Local
  // mode mantiene il comportamento storico (openBrowser → localhost).
  if (await isVpsMode()) {
    try { await window.launcherApi.openExternal(VPS_DASHBOARD_URL) }
    catch (e) { appendLog(`btnOpen vps: ${e.message || e}`) }
    return
  }
  window.launcherApi.openBrowser()
})
homeDom.btnTeamDockerAction.addEventListener('click', async () => {
  if (state.teamDockerPolling) return
  const action = homeDom.btnTeamDockerAction.dataset.action
  if (action === 'recheck') {
    await refreshHomeTeam()
    return
  }
  // Flip to busy + start the poll BEFORE the IPC: openDockerDesktop on
  // win32 launches the GUI and returns instantly, but the daemon takes
  // 20-60s to come up. Polling drives the warning to "ok" automatically.
  startTeamDockerPolling()
  try {
    if (action === 'openDesktop') {
      await window.setupApi.openDockerDesktop()
    } else if (action === 'startColima') {
      const r = await window.setupApi.startColima()
      if (!r?.ok) appendLog(`startColima: ${r?.error || 'failed'}`)
    }
  } catch (error) {
    appendLog(`teamDockerAction: ${error.message || error}`)
    stopTeamDockerPolling()
    await refreshHomeTeam()
  }
})
// Origin marker: il listener btnLoginBack/btnLoginContinue lo legge per
// riportare alla home invece che a STEP_READY (che farebbe partire il
// runtime del wizard di primo setup — non e' quello che vuole un utente
// gia' settato che sta solo cambiando provider).
homeDom.btnProviderLogin.addEventListener('click', () => {
  state.loginOrigin = 'home'
  showWizard(STEP_PROVIDER_LOGIN)
})
homeDom.btnProviderChange.addEventListener('click', () => {
  state.loginOrigin = 'home'
  showWizard(STEP_PROVIDER_CHOOSE)
})
homeDom.btnDockerRefresh.addEventListener('click', () => refreshHomeDocker())
homeDom.dockerImageReleases.addEventListener('click', (event) => {
  event.preventDefault()
  // GHCR packages page for the JHT image — shows tags, digests, and
  // publish dates for every release. The URL is derived from the image
  // ref (`ghcr.io/<owner>/<name>`) we ship in container-prep.js.
  window.launcherApi.openExternal('https://github.com/leopu00/job-hunter-team/pkgs/container/jht')
})
homeDom.btnDockerOpen.addEventListener('click', async () => {
  const platform = window.platformInfo?.platform
  if (platform === 'darwin') {
    const original = homeDom.btnDockerOpen.textContent
    homeDom.btnDockerOpen.disabled = true
    homeDom.btnDockerOpen.textContent = t('docker.install.daemonStart') || 'Avvio Colima...'
    try {
      const r = await window.setupApi.startColima()
      if (!r?.ok) appendLog(`startColima: ${r?.error || 'failed'}`)
    } catch (error) {
      appendLog(`startColima: ${error.message || error}`)
    } finally {
      homeDom.btnDockerOpen.disabled = false
      homeDom.btnDockerOpen.textContent = original
      await refreshHomeDocker()
    }
  } else {
    await window.setupApi.openDockerDesktop()
  }
})
homeDom.btnReopenWizard.addEventListener('click', () => showWizard(STEP_WELCOME))

// Dev mode card: probe sincrono al boot. Se Electron e' packaged la
// card resta nascosta (l'IPC ritorna available:false e scripts/dev-up.sh
// non e' disponibile nell'app distribuita). Quando visibile, la card
// rifletta lo stato runtime di Next host su :3001 (probe HEAD ogni 4s
// solo mentre l'utente e' nel pannello Avanzate).
async function refreshDevStatus() {
  try {
    const probe = await window.launcherApi.devProbe()
    const running = !!probe?.running
    homeDom.devStatus.textContent = running
      ? t('home.advanced.devRunning')
      : t('home.advanced.devIdle')
    homeDom.devStatus.style.color = running ? 'var(--success)' : 'var(--text-dim)'
    homeDom.btnDevStart.hidden = running
    homeDom.btnDevStop.hidden = !running
  } catch {
    /* probe failed: lascia ultima label */
  }
}

;(async () => {
  try {
    // VPS mode: la dev-card e' next dev locale (web :3001 con bind-mount).
    // Su VPS nessun container locale → la card non ha senso e confonde.
    if (await isVpsMode()) return
    const probe = await window.launcherApi.devIsAvailable()
    if (!probe?.available) return
    homeDom.devCard.hidden = false
    homeDom.devStatus.textContent = t('home.advanced.devIdle')

    homeDom.btnDevStart.addEventListener('click', async () => {
      homeDom.btnDevStart.disabled = true
      homeDom.devStatus.textContent = t('home.advanced.devStarting')
      try {
        const res = await window.launcherApi.devLaunch()
        if (!res?.ok) {
          homeDom.devStatus.textContent = t('home.advanced.devError', { msg: res?.error || '?' })
          return
        }
        await refreshDevStatus()
      } catch (error) {
        homeDom.devStatus.textContent = t('home.advanced.devError', { msg: error?.message || error })
      } finally {
        homeDom.btnDevStart.disabled = false
      }
    })

    homeDom.btnDevStop.addEventListener('click', async () => {
      homeDom.btnDevStop.disabled = true
      homeDom.devStatus.textContent = t('home.advanced.devStopping')
      try {
        const res = await window.launcherApi.devStop()
        if (!res?.ok) {
          homeDom.devStatus.textContent = t('home.advanced.devError', { msg: res?.error || '?' })
          return
        }
        await refreshDevStatus()
      } catch (error) {
        homeDom.devStatus.textContent = t('home.advanced.devError', { msg: error?.message || error })
      } finally {
        homeDom.btnDevStop.disabled = false
      }
    })

    homeDom.btnDevOpen.addEventListener('click', () => {
      window.launcherApi.openExternal('http://localhost:3001').catch(() => {})
    })

    // Stato iniziale + polling solo mentre il pannello Avanzate è attivo.
    await refreshDevStatus()
    setInterval(() => {
      if (state.view === 'home' && state.homeSection === 'advanced') refreshDevStatus()
    }, 4000)

    // ── Dev secondario (porta != 3001 su qualsiasi worktree) ────────────
    async function refreshDevAddWorktrees() {
      try {
        const res = await window.launcherApi.devAdditionalListWorktrees()
        if (!res?.ok) return
        const sel = homeDom.devAddWorktree
        const current = sel.value
        sel.innerHTML = '<option value="">— scegli worktree —</option>'
        for (const wt of res.worktrees || []) {
          const opt = document.createElement('option')
          opt.value = wt.path
          // Mostra "<branch> — <path>" troncato per leggibilità
          const shortPath = wt.path.replace(/^.*\//, '')
          opt.textContent = `${wt.branch} — ${shortPath}`
          sel.appendChild(opt)
        }
        if (current) sel.value = current
      } catch {
        /* ignore */
      }
    }

    async function refreshDevAddActive() {
      try {
        const res = await window.launcherApi.devAdditionalListActive()
        if (!res?.ok) return
        const list = res.active || []
        if (list.length === 0) {
          homeDom.devAddActive.textContent = ''
          return
        }
        homeDom.devAddActive.innerHTML = ''
        for (const dev of list) {
          const row = document.createElement('div')
          row.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0;'
          const label = document.createElement('span')
          const uptime = Math.floor(dev.uptimeMs / 1000)
          const shortPath = dev.worktree.replace(/^.*\//, '')
          label.textContent = `:${dev.port} (${shortPath}, uptime ${uptime}s)`
          label.style.flex = '1'
          const openBtn = document.createElement('button')
          openBtn.className = 'btn btn--ghost'
          openBtn.style.cssText = 'padding: 0.2rem 0.5rem; font-size: 0.85em;'
          openBtn.textContent = `Apri :${dev.port}`
          openBtn.addEventListener('click', () => {
            window.launcherApi.openExternal(dev.url || `http://localhost:${dev.port}`).catch(() => {})
          })
          const stopBtn = document.createElement('button')
          stopBtn.className = 'btn btn--ghost'
          stopBtn.style.cssText = 'padding: 0.2rem 0.5rem; font-size: 0.85em;'
          stopBtn.textContent = 'Ferma'
          stopBtn.addEventListener('click', async () => {
            stopBtn.disabled = true
            stopBtn.textContent = '…'
            try {
              await window.launcherApi.devAdditionalStop({ port: dev.port })
              await refreshDevAddActive()
            } finally {
              stopBtn.disabled = false
            }
          })
          row.appendChild(label)
          row.appendChild(openBtn)
          row.appendChild(stopBtn)
          homeDom.devAddActive.appendChild(row)
        }
      } catch {
        /* ignore */
      }
    }

    homeDom.btnDevAddStart.addEventListener('click', async () => {
      const worktree = homeDom.devAddWorktree.value
      const port = Number(homeDom.devAddPort.value)
      if (!worktree) {
        alert('Scegli un worktree dal menu')
        return
      }
      homeDom.btnDevAddStart.disabled = true
      const originalText = homeDom.btnDevAddStart.textContent
      homeDom.btnDevAddStart.textContent = 'Avvio…'
      try {
        const res = await window.launcherApi.devAdditionalLaunch({ worktree, port })
        if (!res?.ok) {
          alert(`Errore: ${res?.error || 'unknown'}`)
        } else if (!res.ready) {
          alert(`Avviato su :${port}, ma non risponde ancora dopo 30s. Controlla log: ${res.LOG || ''}`)
        }
        await refreshDevAddActive()
      } catch (error) {
        alert(`Errore: ${error?.message || error}`)
      } finally {
        homeDom.btnDevAddStart.disabled = false
        homeDom.btnDevAddStart.textContent = originalText
      }
    })

    await refreshDevAddWorktrees()
    await refreshDevAddActive()
    setInterval(() => {
      if (state.view === 'home' && state.homeSection === 'advanced') refreshDevAddActive()
    }, 4000)
  } catch {
    // probe failed (old Electron or packaged) — leave card hidden.
  }
})()

initLangDropdown(document.getElementById('home-lang-select'), {
  onPick: (lang) => setLang(lang),
})

// Poll team status only while the home→Team panel is visible. Same
// cadence as the wizard's running-step poller (3s) — not cumulative,
// the two run in different views.
setInterval(() => {
  if (state.view === 'home' && state.homeSection === 'team') refreshHomeTeam()
}, 3000)
