import { state, dom, appendLog } from './state.js'
import { t, platformFromHintKey } from './i18n.js'

export function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

const STEP_DOM = {
  homebrew: { li: 'stepHomebrew', hint: 'stepHomebrewHint' },
  colima: { li: 'stepColima', hint: 'stepColimaHint' },
  daemon: { li: 'stepDaemon', hint: 'stepDaemonHint' },
}

function setStepState(name, state, hintHtml) {
  const entry = STEP_DOM[name]
  if (!entry) return
  const li = dom[entry.li]
  const hint = dom[entry.hint]
  if (li) li.setAttribute('data-state', state)
  if (hint) hint.innerHTML = hintHtml || ''
}

function paintStepsFromStatus(status) {
  const platform = status.platform || platformFromHintKey(status.check && status.check.hintKey)
  // Only darwin uses the sequential-install checklist UX for now.
  // We set BOTH the `hidden` attribute and an inline `display:none`
  // because the .install-steps stylesheet rule has `display: flex`
  // which overrides the user-agent default for `[hidden]` (no
  // `.install-steps[hidden]` rule in the CSS to pull it back).
  // The Homebrew/Colima/daemon checklist is Colima-specific. Hide it on
  // non-darwin and when the user picked Docker Desktop (their own app).
  if (platform !== 'darwin' || effectiveRuntimeChoice() === 'docker-desktop') {
    if (dom.dockerSteps) {
      dom.dockerSteps.hidden = true
      dom.dockerSteps.style.display = 'none'
    }
    return
  }
  if (dom.dockerSteps) {
    dom.dockerSteps.hidden = false
    dom.dockerSteps.style.display = ''
  }

  const steps = status.steps || { homebrew: 'missing', colima: 'missing', daemon: 'missing' }
  setStepState('homebrew', steps.homebrew === 'ok' ? 'ok' : 'pending', '')
  setStepState('colima', steps.colima === 'ok' ? 'ok' : 'pending')
  setStepState('daemon', steps.daemon === 'ok' ? 'ok' : 'pending')
}

// Paint platform-specific text and visibility on the docker card before
// any IPC round-trip. Called at boot from the synchronous
// window.platformInfo.platform so the wizard never flashes the
// wrong-platform skeleton (e.g. macOS Homebrew/Colima checklist on
// Windows) while waiting for setup:get-docker-status to reply.
function showIf(el, visible) {
  if (!el) return
  el.hidden = !visible
  el.style.display = visible ? '' : 'none'
}

export function applyPlatformSkeleton(platform) {
  if (!platform) return
  if (dom.dockerName) {
    dom.dockerName.textContent = t(`docker.name.${platform}`)
  }
  if (dom.dockerSubtitle) {
    const subtitleKey = `docker.subtitle.${platform}`
    const value = t(subtitleKey)
    dom.dockerSubtitle.textContent = value === subtitleKey ? '' : value
  }
  if (dom.setupLead) {
    const leadKey = `setup.lead.${platform}`
    const value = t(leadKey)
    if (value !== leadKey) dom.setupLead.innerHTML = value
  }
  // The macOS install-steps checklist only belongs on darwin. Force
  // both the hidden attribute and the inline display so neither the
  // CSS specificity nor a stripped rule can leak it back in.
  if (dom.dockerSteps) {
    showIf(dom.dockerSteps, platform === 'darwin')
  }
  // Windows gets a unified Docker/WSL/Git checklist that REPLACES the
  // docker card + extra-deps cards above it. Swap them now so the first
  // paint already has the right layout — avoids an FOUC of the darwin
  // shape being visible while we wait for the setup:get-docker-status
  // IPC reply.
  const isWin = platform === 'win32'
  showIf(dom.dockerCard, !isWin)
  showIf(dom.extraDeps, !isWin)
  showIf(dom.winRequirements, isWin)
  showIf(dom.winInstallActions, isWin)
}

const DOCKER_DESKTOP_URL = 'https://www.docker.com/products/docker-desktop/'

// macOS container-runtime choice (ADR-0006). 'auto'/'colima' both surface as
// "Colima" visually (auto prefers Colima, our default); only an explicit
// 'docker-desktop' flips the card to the Docker-Desktop flow.
function effectiveRuntimeChoice() {
  const c = state.containerRuntime && state.containerRuntime.choice
  return c === 'docker-desktop' ? 'docker-desktop' : 'colima'
}

export async function loadContainerRuntime() {
  if (!window.setupApi || !window.setupApi.getContainerRuntime) return
  try {
    state.containerRuntime = await window.setupApi.getContainerRuntime()
  } catch {
    state.containerRuntime = null
  }
}

async function onSelectRuntime(choice) {
  if (!window.setupApi || !window.setupApi.setContainerRuntime) return
  try {
    await window.setupApi.setContainerRuntime(choice)
  } catch {
    // best-effort: if the write fails we still reflect the intent locally
  }
  await loadContainerRuntime()
  await refreshDockerStatus()
}

// Two-option chooser shown only on macOS: Colima (recommended) vs the user's
// own Docker Desktop. Lives at the top of the docker card so it also doubles
// as the "switch later" control whenever the setup card is on screen.
function renderRuntimeChooser(platform) {
  const host = dom.runtimeChooser
  if (!host) return
  if (platform !== 'darwin') {
    host.hidden = true
    host.style.display = 'none'
    clearChildren(host)
    return
  }
  host.hidden = false
  host.style.display = ''
  clearChildren(host)

  const selected = effectiveRuntimeChoice()
  const title = document.createElement('p')
  title.className = 'runtime-chooser__title'
  title.textContent = t('docker.runtime.title')
  host.appendChild(title)

  const options = document.createElement('div')
  options.className = 'runtime-chooser__options'
  host.appendChild(options)

  const make = (value, labelKey, hintKey, recommended) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'runtime-option' + (selected === value ? ' runtime-option--active' : '')
    btn.setAttribute('aria-pressed', selected === value ? 'true' : 'false')

    const head = document.createElement('span')
    head.className = 'runtime-option__label'
    head.textContent = t(labelKey)
    if (recommended) {
      const tag = document.createElement('span')
      tag.className = 'runtime-option__tag'
      tag.textContent = t('docker.runtime.recommended')
      head.appendChild(tag)
    }
    btn.appendChild(head)

    const hint = document.createElement('span')
    hint.className = 'runtime-option__hint'
    hint.textContent = t(hintKey)
    btn.appendChild(hint)

    btn.addEventListener('click', () => onSelectRuntime(value))
    return btn
  }

  options.appendChild(
    make('colima', 'docker.runtime.colima.label', 'docker.runtime.colima.hint', true),
  )
  options.appendChild(
    make('docker-desktop', 'docker.runtime.dockerDesktop.label', 'docker.runtime.dockerDesktop.hint', false),
  )
}

// macOS: start the user's Docker Desktop, then poll status until the daemon
// answers (cold start is 20-60s) so the card flips to green on its own.
let macDockerPollTimer = null
export async function onStartDockerDesktopMac() {
  setBusy(true)
  try {
    const result = await window.setupApi.startDockerDesktop()
    if (!result?.ok) appendLog(`startDockerDesktop: ${result?.error || 'failed'}`)
  } finally {
    setBusy(false)
  }
  if (macDockerPollTimer) return
  let tries = 0
  const MAX_TRIES = 30 // 30 × 3s = 90s
  macDockerPollTimer = setInterval(async () => {
    tries += 1
    try {
      await refreshDockerStatus()
      const ok = state.docker && state.docker.check && state.docker.check.state === 'ok'
      if (ok || tries >= MAX_TRIES) {
        clearInterval(macDockerPollTimer)
        macDockerPollTimer = null
      }
    } catch (_) { /* keep polling */ }
  }, 3000)
}

export function renderDockerCard(status) {
  const check = status.check
  const card = dom.dockerCard
  card.classList.remove('dep-card--ok', 'dep-card--warn', 'dep-card--missing')

  const platform = status.platform || platformFromHintKey(check.hintKey)
  if (platform && dom.dockerName) {
    dom.dockerName.textContent = t(`docker.name.${platform}`)
  }
  if (platform && dom.dockerSubtitle) {
    const subtitleKey = `docker.subtitle.${platform}`
    dom.dockerSubtitle.textContent = t(subtitleKey) === subtitleKey ? '' : t(subtitleKey)
  }
  if (platform && dom.setupLead) {
    dom.setupLead.innerHTML = t(`setup.lead.${platform}`)
  }

  // Render the macOS runtime chooser before the early `ok` return so the
  // user can still switch runtime when everything is already green.
  renderRuntimeChooser(platform)

  if (check.state === 'ok') {
    dom.dockerBadge.textContent = t('docker.state.ok')
    card.classList.add('dep-card--ok')
  } else if (check.state === 'not-running') {
    dom.dockerBadge.textContent = t('docker.state.notRunning')
    card.classList.add('dep-card--warn')
  } else if (check.state === 'starting') {
    dom.dockerBadge.textContent = t('docker.state.starting')
    card.classList.add('dep-card--warn')
  } else if (check.state === 'needs-reboot') {
    dom.dockerBadge.textContent = t('docker.state.needsReboot')
    card.classList.add('dep-card--warn')
  } else {
    dom.dockerBadge.textContent = t('docker.state.missing')
    card.classList.add('dep-card--missing')
  }

  paintStepsFromStatus(status)

  clearChildren(dom.dockerActions)

  // On Windows the "Install everything" button must surface even when
  // Docker is already ready, because we also need to install WSL/Git
  // for any non-ok extra dep. We treat those as a unified install
  // because the user experience must be one click → reboot → done.
  const extraDeps = state.extraDeps && Array.isArray(state.extraDeps.deps)
    ? state.extraDeps.deps : []
  const anyExtraMissing = extraDeps.some((d) => d.required && !d.ok)

  if (platform === 'win32' && (check.state !== 'ok' || anyExtraMissing)) {
    const installAll = document.createElement('button')
    installAll.className = 'btn btn--primary'
    installAll.textContent = t('docker.action.installEverything')
    installAll.addEventListener('click', onInstallWindowsStack)
    dom.dockerActions.appendChild(installAll)

    if (check.state === 'not-running') {
      const openDesktop = document.createElement('button')
      openDesktop.className = 'btn btn--ghost'
      openDesktop.textContent = t('docker.action.openDesktop')
      openDesktop.addEventListener('click', onOpenDockerDesktop)
      dom.dockerActions.appendChild(openDesktop)
    }
    return
  }

  if (check.state === 'ok') return

  if (platform === 'darwin') {
    // Docker Desktop path: it is the user's own app — we never silent-install
    // it. Offer "Start" if it's installed, else "Download". No checklist.
    if (effectiveRuntimeChoice() === 'docker-desktop') {
      const installed = !!(
        state.containerRuntime &&
        state.containerRuntime.detected &&
        state.containerRuntime.detected.dockerDesktopInstalled
      )
      const btn = document.createElement('button')
      btn.className = 'btn btn--primary'
      if (installed) {
        btn.textContent = t('docker.action.startDockerDesktop')
        btn.addEventListener('click', onStartDockerDesktopMac)
      } else {
        btn.textContent = t('docker.action.downloadDockerDesktop')
        btn.addEventListener('click', onDownloadDockerDesktop)
      }
      dom.dockerActions.appendChild(btn)
      return
    }
    // Colima path (default). "Not-running" = Homebrew + Colima are already
    // installed, the daemon is just stopped. Labelling this "Installa tutto"
    // (Install everything) is misleading — nothing is actually being
    // installed, we just need to fire `colima start`. Use "Avvia runtime".
    // The handler is the same install.js pipeline, which is idempotent and
    // turns into a pure `colima start` when the binaries are there.
    const install = document.createElement('button')
    install.className = 'btn btn--primary'
    install.textContent = check.state === 'not-running'
      ? t('docker.action.startColima')
      : t('docker.action.installAll')
    install.addEventListener('click', onInstallDocker)
    dom.dockerActions.appendChild(install)
    return
  }

  // Linux: silent auto-install of Docker Engine via the official
  // get.docker.com script (see installDockerEngineOnLinux in install.js).
  // Drives the same onInstallDocker pipeline + live log as macOS instead of
  // just opening the download page in a browser.
  if (check.state === 'missing') {
    const install = document.createElement('button')
    install.className = 'btn btn--primary'
    install.textContent = t('docker.action.install')
    install.addEventListener('click', onInstallDocker)
    dom.dockerActions.appendChild(install)
    return
  }

  if (check.state === 'not-running') {
    const openDesktop = document.createElement('button')
    openDesktop.className = 'btn btn--primary'
    openDesktop.textContent = t('docker.action.openDesktop')
    openDesktop.addEventListener('click', onOpenDockerDesktop)
    dom.dockerActions.appendChild(openDesktop)
  }
}

function winStepState(ok) { return ok ? 'ok' : 'pending' }

// On Windows we render one unified checklist (Docker / WSL / Git)
// instead of the darwin docker-card + extra-deps split. Each row's icon
// flips to the ok state as soon as the matching dep reports ready; the
// Docker row is the only one with an inline per-item action (Download),
// because Docker Desktop install stays a manual step. WSL and Git ride
// the shared "Install everything" button below.
function renderWindowsRequirements(status, extra) {
  const check = status && status.check
  const dockerOk = check && check.state === 'ok'
  const dockerMissing = !check || check.state === 'missing'
  const deps = (extra && Array.isArray(extra.deps)) ? extra.deps : []
  const wslDep = deps.find((d) => d.id === 'wsl')
  const gitDep = deps.find((d) => d.id === 'git')
  const wslOk = !!(wslDep && wslDep.ok)
  const gitOk = !!(gitDep && gitDep.ok)

  // Docker row visual state has 3 possibilities:
  //   'ok'      — daemon responsive
  //   'busy'    — user just clicked "Open Docker Desktop"; we're polling
  //   'pending' — not ok and not currently starting
  let dockerVisualState = 'pending'
  if (dockerOk) dockerVisualState = 'ok'
  else if (state.winDockerStarting) dockerVisualState = 'busy'
  if (dom.winStepDocker) dom.winStepDocker.setAttribute('data-state', dockerVisualState)
  if (dom.winStepWsl) dom.winStepWsl.setAttribute('data-state', winStepState(wslOk))
  if (dom.winStepGit) dom.winStepGit.setAttribute('data-state', winStepState(gitOk))

  // Docker row action depends on the precise state:
  //   missing          → "Install Docker" (opens the download page)
  //   not-running (idle) → "Start Docker Desktop"
  //   starting (polling) → nothing — the spinner icon tells the story,
  //                        a button here would make the user think they
  //                        need to click something again
  clearChildren(dom.winStepDockerAction)
  if (dockerMissing) {
    const download = document.createElement('button')
    download.className = 'btn btn--ghost btn--compact'
    download.textContent = t('docker.action.install')
    download.addEventListener('click', onOpenDownloadPage)
    dom.winStepDockerAction.appendChild(download)
  } else if (!dockerOk && !state.winDockerStarting) {
    const start = document.createElement('button')
    start.className = 'btn btn--ghost btn--compact'
    start.textContent = t('docker.action.openDesktop')
    start.addEventListener('click', onOpenDockerDesktopAndPoll)
    dom.winStepDockerAction.appendChild(start)
  }

  // "Install everything" only when at least one automatable item (WSL
  // or Git) is actually missing AND we are not currently in the middle
  // of the Docker-starting flow. Otherwise the button appearing while
  // Docker boots is pure noise: the user is waiting on Docker, not on
  // a new WSL/Git run.
  const automatablePending = (!wslOk || !gitOk) && !state.winDockerStarting
  showIf(dom.winInstallActions, automatablePending)
}

export async function refreshDockerStatus() {
  setBusy(true)
  try {
    const [status, extra] = await Promise.all([
      window.setupApi.getDockerStatus(),
      window.setupApi.getExtraDeps(),
    ])
    state.docker = status
    state.extraDeps = extra
    const platform = (status && status.platform)
      || (window.platformInfo && window.platformInfo.platform)
    if (platform === 'win32') {
      renderWindowsRequirements(status, extra)
    } else {
      // macOS: load the runtime choice (Colima / Docker Desktop) before the
      // card renders so the chooser and action buttons reflect the pick.
      if (platform === 'darwin') await loadContainerRuntime()
      renderDockerCard(status)
      renderExtraDeps(extra)
    }
    const dockerOk = status.check.state === 'ok'
    const depsOk = extra && extra.allRequiredOk !== false
    dom.btnSetupContinue.disabled = !(dockerOk && depsOk)
  } finally {
    setBusy(false)
  }
}

function renderExtraDeps(extra) {
  const list = dom.extraDeps
  list.innerHTML = ''
  if (!extra || !Array.isArray(extra.deps)) return
  for (const dep of extra.deps) {
    list.appendChild(buildDepCard(dep))
  }
}

function depStateClass(dep) {
  if (dep.ok) return 'dep-card--ok'
  if (dep.required) return 'dep-card--missing'
  return 'dep-card--warn'
}

function buildDepCard(dep) {
  const card = document.createElement('div')
  card.className = `dep-card dep-card--compact ${depStateClass(dep)}`

  const header = document.createElement('div')
  header.className = 'dep-card__header'

  const name = document.createElement('span')
  name.className = 'dep-card__name'
  name.textContent = t(`deps.${camelId(dep.id)}.name`)
  header.appendChild(name)

  const badge = document.createElement('span')
  badge.className = 'dep-card__badge'
  badge.textContent = t(`deps.${camelId(dep.id)}.state.${camelState(dep.state)}`)
  header.appendChild(badge)
  card.appendChild(header)

  const hint = document.createElement('p')
  hint.className = 'dep-card__hint'
  const hintVars = dep.id === 'ai-cli' && Array.isArray(dep.found)
    ? { found: dep.found.join(', ') }
    : undefined
  hint.textContent = dep.hintKey ? t(dep.hintKey, hintVars) : ''
  card.appendChild(hint)

  return card
}

export function camelId(id) {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function camelState(stateStr) {
  if (!stateStr) return 'missing'
  return stateStr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function setBusy(isBusy) {
  dom.dockerCard.classList.toggle('dep-card--busy', isBusy)
  for (const btn of dom.dockerActions.querySelectorAll('button')) {
    btn.disabled = isBusy
  }
}

export async function onOpenDownloadPage() {
  setBusy(true)
  try {
    await window.setupApi.openDockerDownloadPage()
  } finally {
    setBusy(false)
  }
}

// macOS Docker Desktop choice: open the official download page (their app,
// installed manually — EULA + admin, same friction we accept on Windows).
export async function onDownloadDockerDesktop() {
  setBusy(true)
  try {
    if (window.launcherApi && window.launcherApi.openExternal) {
      await window.launcherApi.openExternal(DOCKER_DESKTOP_URL)
    }
  } finally {
    setBusy(false)
  }
}

function showInstallLog() {
  if (dom.dockerInstallLog) {
    dom.dockerInstallLog.textContent = ''
    dom.dockerInstallLog.hidden = false
  }
}

function hideInstallLog() {
  if (dom.dockerInstallLog) dom.dockerInstallLog.hidden = true
}

export async function onInstallDocker() {
  setBusy(true)
  showInstallLog()
  // Mark all three steps as pending → the live stage listener will promote
  // each to 'busy'/'ok'/'fail' as the backend progresses through them.
  setStepState('homebrew', 'pending', '')
  setStepState('colima', 'pending', '')
  setStepState('daemon', 'pending', '')
  try {
    const result = await window.setupApi.installDocker()
    if (result?.ok) {
      hideInstallLog()
      await refreshDockerStatus()
      return
    }
    if (result?.stage === 'brew-auth-canceled') {
      setStepState('homebrew', 'fail', t('docker.install.authCanceledHint'))
      return
    }
    if (result?.stage === 'brew-install-homebrew' || result?.stage === 'brew-missing') {
      setStepState('homebrew', 'fail', t('docker.install.homebrewFailHint'))
      return
    }
    if (result?.stage === 'brew-install') {
      setStepState('colima', 'fail', t('docker.install.colimaFailHint'))
      return
    }
    if (result?.stage === 'colima-start' || result?.stage === 'daemon-unreachable') {
      setStepState('daemon', 'fail', t('docker.install.daemonFailHint'))
      return
    }
  } catch (error) {
    setStepState('colima', 'fail', error instanceof Error ? error.message : String(error))
  } finally {
    setBusy(false)
  }
}

function winShowLog(text) {
  if (!dom.winInstallLog) return
  dom.winInstallLog.textContent = text
  showIf(dom.winInstallLog, true)
}

function markWinStepsAllOk() {
  // Force the checklist rows to the 'ok' visual state. Necessary because
  // the Electron process cached its PATH at startup — even though Git
  // was just installed successfully, `git --version` from Node would
  // still fail until the process is restarted (which happens at reboot).
  // We trust the installer's exit code here; the post-reboot `getExtraDeps`
  // re-check will either confirm or correct each row.
  for (const id of ['win-step-docker', 'win-step-wsl', 'win-step-git']) {
    const el = document.getElementById(id)
    if (el) el.setAttribute('data-state', 'ok')
  }
  if (dom.winStepDockerAction) clearChildren(dom.winStepDockerAction)
}

function showWinSuccessBanner(rebootRequired = true) {
  if (!dom.winInstallActions) return
  clearChildren(dom.winInstallActions)
  // Big prominent green card instead of a small "Restart now" button
  // tucked under a log. The user explicitly asked for this — "avvisarlo
  // meglio che deve riavviare il computer".
  //
  // When nothing was actually installed (WSL/Git/Docker already present)
  // no reboot is needed: show a "you're all set" variant with a Continue
  // button instead of falsely telling the user to restart.
  const banner = document.createElement('div')
  banner.className = 'win-success'
  banner.innerHTML =
    '<div class="win-success__title">' +
    t(rebootRequired ? 'winSuccess.title' : 'winSuccessNoReboot.title') + '</div>' +
    '<div class="win-success__body">' +
    t(rebootRequired ? 'winSuccess.body' : 'winSuccessNoReboot.body') + '</div>'
  const btn = document.createElement('button')
  btn.className = 'btn btn--primary btn--large'
  if (rebootRequired) {
    btn.textContent = t('docker.action.restartNow')
    btn.addEventListener('click', onRebootNow)
  } else {
    btn.textContent = t('docker.action.continue')
    btn.addEventListener('click', onContinueNoReboot)
  }
  banner.appendChild(btn)
  dom.winInstallActions.appendChild(banner)
  showIf(dom.winInstallActions, true)
  showIf(dom.winInstallLog, false)
}

// No-reboot path: prerequisites were already present, so just re-check
// Docker status and let the wizard advance exactly as it would after a
// post-reboot resume (no OS restart necessary).
async function onContinueNoReboot() {
  showIf(dom.winInstallActions, false)
  await refreshDockerStatus()
}

export async function onInstallWindowsStack() {
  setBusy(true)
  winShowLog(t('docker.install.windowsRunning'))
  try {
    const result = await window.setupApi.installWindowsStack()
    if (result?.ok) {
      // Success either way. Only show the "restart" banner when a reboot
      // is genuinely required (WSL freshly installed); otherwise show the
      // "all set, no reboot" variant — previously we always asked to
      // restart even when nothing was installed.
      markWinStepsAllOk()
      showWinSuccessBanner(result.rebootRequired)
      return
    }
    const stage = result?.stage || 'unknown'
    const errMsg = result?.error || 'installer failed'
    const hintKey =
      stage === 'wsl-install' ? 'docker.install.wslInstallFail' :
      stage === 'git-install' ? 'docker.install.gitInstallFail' :
      stage === 'aborted' ? 'docker.install.aborted' :
      null
    winShowLog(hintKey ? `${t(hintKey)}\n\n${errMsg}` : errMsg)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    winShowLog(msg)
  } finally {
    setBusy(false)
  }
}

export async function onRebootNow() {
  try {
    await window.setupApi.reboot()
  } catch (_) {
    // If reboot couldn't be triggered programmatically, the label
    // message already tells the user to restart manually.
  }
}

export async function onOpenDockerDesktop() {
  setBusy(true)
  try {
    const result = await window.setupApi.openDockerDesktop()
    if (!result?.ok) {
      appendLog(`openDockerDesktop: ${result?.error || 'failed'}`)
    }
  } finally {
    setBusy(false)
  }
}

// Dedicated handler for the Windows checklist: open Docker Desktop
// (launches the installed app that wasn't running yet), then poll the
// docker status every 3s for up to 90s. The engine typically needs
// 20-60s to come up on a cold boot; auto-polling means the Docker row
// flips to green without the user having to click anything else.
let winDockerPollTimer = null
export async function onOpenDockerDesktopAndPoll() {
  if (state.winDockerStarting) return // already starting
  state.winDockerStarting = true
  // Re-render immediately so the Docker row flips to the busy spinner
  // and the "Install everything" button hides — before we wait on the
  // openDockerDesktop IPC.
  if (state.docker) renderWindowsRequirements(state.docker, state.extraDeps)
  await onOpenDockerDesktop()
  if (winDockerPollTimer) return
  let tries = 0
  const MAX_TRIES = 30 // 30 × 3s = 90s
  const finish = () => {
    clearInterval(winDockerPollTimer)
    winDockerPollTimer = null
    state.winDockerStarting = false
    if (state.docker) renderWindowsRequirements(state.docker, state.extraDeps)
  }
  winDockerPollTimer = setInterval(async () => {
    tries += 1
    try {
      await refreshDockerStatus()
      const ok = state.docker && state.docker.check && state.docker.check.state === 'ok'
      if (ok || tries >= MAX_TRIES) finish()
    } catch (_) { /* keep polling */ }
  }, 3000)
}

