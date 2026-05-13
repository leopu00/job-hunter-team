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
  STEP_VPS_PROVISION,
  STEP_SETUP,
  STEP_CONTAINER,
  STEP_SUBSCRIPTION_NOTICE,
  STEP_MODEL_COMPARE,
  STEP_PROVIDER_CHOOSE,
  STEP_PROVIDER_INSTALL,
  STEP_PROVIDER_LOGIN,
  STEP_READY,
  LOCATION_LOCAL,
  LOCATION_VPS,
  PROVIDER_OPTIONS,
  PROVIDER_PLANS,
  MODEL_VARIANTS,
  PROVIDER_SUBSCRIBE_URL,
} from './constants.js'
import { clearChildren, refreshDockerStatus, onInstallWindowsStack } from './docker-card.js'
import { enterProviderLogin } from './terminal-login.js'

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
  // Adapt copy + skip-button visibility to the chosen path.
  if (dom.supabaseHint) {
    const key = state.location === LOCATION_VPS ? 'supabase.lead.vps' : 'supabase.lead.local'
    dom.supabaseHint.setAttribute('data-i18n', key)
    dom.supabaseHint.textContent = t(key)
  }
  if (dom.btnSupabaseSkip) {
    dom.btnSupabaseSkip.hidden = state.location === LOCATION_VPS
  }
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
  if (dom.btnSupabaseContinue) {
    // Local path: continue always enabled (skip is also available).
    // VPS path: continue only enabled once signed in.
    dom.btnSupabaseContinue.disabled = state.location === LOCATION_VPS && !signedIn
  }
}

async function doSupabaseSignIn(provider) {
  log.info('supabase.signin.click', { provider })
  if (!window.authApi?.signIn) {
    log.warn('supabase.signin.no-api')
    return
  }
  if (dom.btnSupabaseGoogle) dom.btnSupabaseGoogle.disabled = true
  if (dom.btnSupabaseGithub) dom.btnSupabaseGithub.disabled = true
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
    if (dom.btnSupabaseGoogle) dom.btnSupabaseGoogle.disabled = false
    if (dom.btnSupabaseGithub) dom.btnSupabaseGithub.disabled = false
    renderSupabaseStep()
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
//   - VPS   → skip local Docker checks entirely, jump straight to
//             the VPS provisioning wizard (decisione 2026-05-13: il
//             container vive sulla VPS, niente Docker locale).
function advanceAfterSupabase() {
  if (state.location === LOCATION_VPS) {
    enterVpsProvision()
  } else {
    enterSetup()
  }
}

dom.btnSetupBack.addEventListener('click', () => enterSupabaseLogin())

dom.btnSetupContinue.addEventListener('click', () => {
  const dockerOk = state.docker?.check.state === 'ok'
  const depsOk = !state.extraDeps || state.extraDeps.allRequiredOk !== false
  if (!dockerOk || !depsOk) return
  showStep(STEP_CONTAINER)
  startContainerPrep()
})

if (dom.btnWinInstallEverything) {
  dom.btnWinInstallEverything.addEventListener('click', onInstallWindowsStack)
}

dom.btnContainerBack.addEventListener('click', async () => {
  if (state.containerBusy) return
  await enterSetup()
})

async function enterSetup() {
  showStep(STEP_SETUP)
  await refreshDockerStatus()
}

dom.btnContainerRetry.addEventListener('click', () => {
  if (state.containerBusy) return
  startContainerPrep()
})

dom.btnContainerContinue.addEventListener('click', () => {
  if (state.containerReady) {
    showStep(STEP_SUBSCRIPTION_NOTICE)
  }
})

dom.btnSubscriptionBack.addEventListener('click', () => {
  // VPS path skipped both setup + container locally, so back from
  // subscription returns to the VPS provisioning step. Local path
  // keeps the old behavior.
  if (state.location === LOCATION_VPS) {
    enterVpsProvision()
  } else {
    showStep(STEP_CONTAINER)
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
if (dom.btnVpsOpenHetzner) dom.btnVpsOpenHetzner.addEventListener('click', onVpsOpenHetzner)
if (dom.btnVpsConnect) dom.btnVpsConnect.addEventListener('click', onVpsConnect)
if (dom.vpsIp) dom.vpsIp.addEventListener('input', updateVpsConnectState)
if (dom.btnVpsBack) dom.btnVpsBack.addEventListener('click', () => enterSupabaseLogin())
if (dom.btnVpsContinue) {
  dom.btnVpsContinue.addEventListener('click', () => {
    if (!state.vps.installed) return
    showStep(STEP_SUBSCRIPTION_NOTICE)
  })
}

dom.btnSubscriptionContinue.addEventListener('click', () => {
  enterModelCompare()
})

function enterModelCompare() {
  renderModelCharts()
  showStep(STEP_MODEL_COMPARE)
}

dom.btnModelCompareBack.addEventListener('click', () => {
  showStep(STEP_SUBSCRIPTION_NOTICE)
})

dom.btnModelCompareContinue.addEventListener('click', () => {
  enterProviderChoose()
})

// Render 3 bar charts (intelligence / speed / cost), each with one
// bar per model variant in MODEL_VARIANTS. Bar height is normalized
// to the chart's max; for cost we invert so lower $ becomes the
// taller "affordability" bar.
function renderModelCharts() {
  const root = dom.modelCharts
  if (!root) return
  clearChildren(root)

  const metrics = [
    { key: 'intelligence', titleKey: 'modelCompare.intelligence', unitKey: 'modelCompare.intelligenceUnit', higherIsBetter: true,  format: (v) => `${v.toFixed(1)}%` },
    { key: 'speed',        titleKey: 'modelCompare.speed',        unitKey: 'modelCompare.speedUnit',        higherIsBetter: true,  format: (v) => `${v} t/s` },
    { key: 'cost',         titleKey: 'modelCompare.cost',         unitKey: 'modelCompare.costUnit',         higherIsBetter: false, format: (v) => `$${v}` },
  ]

  for (const metric of metrics) {
    const values = MODEL_VARIANTS.map((m) => m[metric.key])
    const max = Math.max(...values)
    const min = Math.min(...values)

    const chart = document.createElement('div')
    chart.className = 'model-chart'

    const header = document.createElement('div')
    header.className = 'model-chart__header'
    const title = document.createElement('span')
    title.className = 'model-chart__title'
    title.setAttribute('data-i18n', metric.titleKey)
    title.textContent = t(metric.titleKey)
    const unit = document.createElement('span')
    unit.className = 'model-chart__unit'
    unit.setAttribute('data-i18n', metric.unitKey)
    unit.textContent = t(metric.unitKey)
    header.appendChild(title)
    header.appendChild(unit)
    chart.appendChild(header)

    const barsRow = document.createElement('div')
    barsRow.className = 'model-chart__bars'
    barsRow.style.gridTemplateColumns = `repeat(${MODEL_VARIANTS.length}, 1fr)`

    let previousProviderId = null
    for (const model of MODEL_VARIANTS) {
      const value = model[metric.key]
      // Normalize to 8–100% so the smallest bar isn't invisible.
      let pct
      if (metric.higherIsBetter) {
        pct = max > 0 ? Math.max(8, Math.round((value / max) * 100)) : 8
      } else {
        pct = max > 0 ? Math.max(8, Math.round((min / value) * 100)) : 8
      }
      const isWinner = metric.higherIsBetter ? value === max : value === min

      const bar = document.createElement('div')
      bar.className = 'model-bar'
      if (isWinner) bar.classList.add('model-bar--winner')
      // Visual separator between providers so the user reads Claude /
      // Codex / Kimi as distinct groups inside a single chart.
      if (previousProviderId && previousProviderId !== model.providerId) {
        bar.classList.add('model-bar--group-start')
      }
      previousProviderId = model.providerId

      const valueLabel = document.createElement('div')
      valueLabel.className = 'model-bar__value'
      valueLabel.textContent = metric.format(value)

      const track = document.createElement('div')
      track.className = 'model-bar__track'
      const fill = document.createElement('div')
      fill.className = 'model-bar__fill'
      fill.style.height = `${pct}%`
      fill.style.background = model.color
      track.appendChild(fill)

      // Split name into a primary line + sub line so "GPT-5.3 xhigh"
      // renders as two tidy lines instead of breaking mid-token.
      const nameLabel = document.createElement('div')
      nameLabel.className = 'model-bar__name'
      const firstSpace = model.modelName.indexOf(' ')
      if (firstSpace > 0) {
        const primary = document.createElement('span')
        primary.textContent = model.modelName.slice(0, firstSpace)
        const sub = document.createElement('span')
        sub.className = 'model-bar__name-sub'
        sub.textContent = model.modelName.slice(firstSpace + 1)
        nameLabel.appendChild(primary)
        nameLabel.appendChild(sub)
      } else {
        nameLabel.textContent = model.modelName
      }

      bar.appendChild(valueLabel)
      bar.appendChild(track)
      bar.appendChild(nameLabel)
      barsRow.appendChild(bar)
    }

    chart.appendChild(barsRow)
    root.appendChild(chart)
  }
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
  dom.btnProviderContinue.disabled = !(state.selectedProvider && state.selectedPlan)
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
      // Clear the plan when the provider changes — the tier options
      // are provider-specific and re-rendering will repaint them.
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

    const plans = PROVIDER_PLANS[opt.id] || []
    const isProviderSelected = state.selectedProvider === opt.id

    if (plans.length > 0) {
      // Subscription plan table: one COLUMN per tier. Header row holds
      // the radio that lets the user mark which subscription they own
      // — only enabled once this provider is selected. The selected
      // tier is saved so the runtime sentinel can size context windows
      // against the user's actual quota later on.
      const table = document.createElement('table')
      table.className = 'plans-table'

      // Helper: stamp the same `plans-table__col--recommended` class on
      // every cell in the recommended tier's column so we can highlight
      // it vertically.
      const colClass = (p) => (p.recommended ? ' plans-table__col--recommended' : '')

      const thead = document.createElement('thead')
      const trHead = document.createElement('tr')
      for (const p of plans) {
        const th = document.createElement('th')
        th.className = `plans-table__header${colClass(p)}`
        const planRadio = document.createElement('input')
        planRadio.type = 'radio'
        planRadio.name = `plan-select-${opt.id}`
        planRadio.className = 'plans-table__radio'
        planRadio.value = p.id
        planRadio.checked = isProviderSelected && state.selectedPlan === p.id
        planRadio.disabled = !isProviderSelected
        planRadio.addEventListener('change', () => {
          if (!planRadio.checked) return
          state.selectedProvider = opt.id
          state.selectedPlan = p.id
          state.selectedProviders = new Set([opt.id])
          renderProviderOptions()
        })
        const label = document.createElement('label')
        label.className = 'plans-table__header-label'
        label.appendChild(planRadio)
        const nameSpan = document.createElement('span')
        nameSpan.textContent = p.name
        label.appendChild(nameSpan)
        th.appendChild(label)
        if (p.recommended) {
          const badge = document.createElement('span')
          badge.className = 'plans-table__badge'
          badge.textContent = t('provider.recommended')
          th.appendChild(badge)
          if (p.recommendedTag) {
            const tag = document.createElement('span')
            tag.className = 'plans-table__badge-tag'
            tag.textContent = t(`provider.recommendedTag.${p.recommendedTag}`)
            th.appendChild(tag)
          }
        }
        trHead.appendChild(th)
      }
      thead.appendChild(trHead)
      table.appendChild(thead)

      const cell = (plan, text, extraClass) => {
        const td = document.createElement('td')
        td.className = `${extraClass || ''}${colClass(plan)}`.trim()
        td.textContent = text
        return td
      }

      const tbody = document.createElement('tbody')
      const trModel = document.createElement('tr')
      trModel.className = 'plans-table__model-row'
      for (const p of plans) trModel.appendChild(cell(p, p.model || '—'))

      const trPrice = document.createElement('tr')
      trPrice.className = 'plans-table__price-row'
      for (const p of plans) trPrice.appendChild(cell(p, p.price))

      const trWeekly = document.createElement('tr')
      trWeekly.className = 'plans-table__weekly-row'
      for (const p of plans) trWeekly.appendChild(cell(p, p.monthly || '—'))

      // "$/M" row: monthly price ÷ monthly token allowance. Simple
      // rule of thumb — "$100/mo buys you 400M tokens ≈ $0.25/M".
      const trUnit = document.createElement('tr')
      trUnit.className = 'plans-table__unit-row'
      for (const p of plans) {
        let text = '—'
        if (typeof p.priceUsd === 'number' && typeof p.monthlyM === 'number' && p.monthlyM > 0) {
          const per = p.priceUsd / p.monthlyM
          text = `~$${per.toFixed(2)}/M tok`
        }
        trUnit.appendChild(cell(p, text))
      }

      const trEst = document.createElement('tr')
      trEst.className = 'plans-table__estimate-row'
      for (const p of plans) trEst.appendChild(cell(p, p.estimate))

      tbody.appendChild(trModel)
      tbody.appendChild(trPrice)
      tbody.appendChild(trWeekly)
      tbody.appendChild(trUnit)
      tbody.appendChild(trEst)
      table.appendChild(tbody)
      body.appendChild(table)
    }

    // "Don't have a subscription yet?" link — opens the provider's
    // pricing page in the default browser. Always visible, so users
    // can subscribe on the spot before coming back to mark the tier.
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
  enterModelCompare()
})

dom.btnProviderContinue.addEventListener('click', async () => {
  if (!state.selectedProvider || !state.selectedPlan) return
  // Persist the single-provider + plan selection. The plan value is
  // informational; the CLI picks up the actual account entitlements
  // from its own login. We save regardless of install success so the
  // sentinel can still read the intended plan later.
  try {
    await window.setupApi.saveSelection({
      provider: state.selectedProvider,
      plan: state.selectedPlan,
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
  if (state.providerInstallDone) enterProviderLogin()
})

async function startProviderInstall() {
  if (state.providerInstallBusy) return
  state.providerInstallBusy = true
  state.providerInstallDone = false
  dom.providerLog.textContent = ''
  dom.btnProviderInstallRetry.hidden = true
  dom.btnProviderInstallContinue.disabled = true
  setProgressState(dom.providerBar, dom.providerIcon, 'busy')

  const ids = Array.from(state.selectedProviders)
  const firstName = providerLabel(ids[0]) || ids[0]
  dom.providerMessage.textContent = t('provider.installStatus.running', { name: firstName })

  try {
    const result = await window.setupApi.installProviders(ids)
    if (result?.ok) {
      state.providerInstallDone = true
      setProgressState(dom.providerBar, dom.providerIcon, 'ok')
      dom.providerMessage.textContent = t('provider.installStatus.allDone')
      dom.btnProviderInstallContinue.disabled = false
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

window.setupApi.onProviderLog((line) => {
  dom.providerLog.textContent = line
  const match = /── Installing (.+) ──/.exec(line)
  if (match) {
    dom.providerMessage.textContent = t('provider.installStatus.running', { name: match[1] })
  }
})

// -------- Step: ready (summary) --------

export async function enterReady() {
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
