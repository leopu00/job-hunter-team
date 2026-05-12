// Wizard renderer: language → welcome → setup → ready → running.
// The user never sees a scrollable dump of state; each step has one job.

import {
  STEP_LANGUAGE,
  STEP_WELCOME,
  STEP_SETUP,
  STEP_CONTAINER,
  STEP_SUBSCRIPTION_NOTICE,
  STEP_MODEL_COMPARE,
  STEP_PROVIDER_CHOOSE,
  STEP_PROVIDER_INSTALL,
  STEP_PROVIDER_LOGIN,
  STEP_READY,
  STEP_RUNNING,
  PROVIDER_OPTIONS,
  PROVIDER_PLANS,
  MODEL_VARIANTS,
  PROVIDER_SUBSCRIBE_URL,
} from './modules/constants.js'
import {
  t,
  setLang,
  applyTranslations,
  platformFromHintKey,
  initLangDropdown,
  onLangChange,
  getCurrentLang,
} from './modules/i18n.js'
import { SUPPORTED_LANGS, LANG_STORAGE_KEY } from './modules/translations.js'
import { state, dom, showStep, appendLog } from './modules/state.js'

import {
  clearChildren,
  camelId,
  renderDockerCard,
  applyPlatformSkeleton,
  refreshDockerStatus,
  onInstallDocker,
  onInstallWindowsStack,
  onRebootNow,
  onOpenDockerDesktop,
  onOpenDockerDesktopAndPoll,
  onOpenDownloadCompany,
} from './modules/docker-card.js'

// -------- Running step --------

function updateRunningUI(status) {
  if (!status) return
  dom.runningInfo.innerHTML = ''
  const row = (label, value) => {
    const el = document.createElement('div')
    el.className = 'info-row'
    const l = document.createElement('span')
    l.className = 'info-row__label'
    l.textContent = label
    const v = document.createElement('span')
    v.className = 'info-row__value'
    v.textContent = value
    el.appendChild(l)
    el.appendChild(v)
    return el
  }
  if (status.url) dom.runningInfo.appendChild(row(t('running.info.url'), status.url))
  if (status.port) dom.runningInfo.appendChild(row(t('running.info.port'), String(status.port)))
  if (status.mode) dom.runningInfo.appendChild(row(t('running.info.mode'), status.mode))
  if (status.running) {
    dom.runningLead.textContent = t('running.leadRunning')
  } else if (status.mode === 'starting') {
    dom.runningLead.textContent = t('running.leadStarting')
  } else if (status.mode === 'error') {
    const msg = status.lastError || t('running.unknownError')
    dom.runningLead.textContent = t('running.errorGeneric', { msg })
  }
}

async function refreshRunningStatus() {
  try {
    const status = await window.launcherApi.getStatus()
    updateRunningUI(status)
  } catch (error) {
    appendLog(`refreshRunningStatus: ${error.message || error}`)
  }
}

async function startTeam() {
  if (state.starting) return
  state.starting = true
  dom.btnStartTeam.disabled = true
  dom.btnStartTeam.textContent = t('running.startingBtn')
  showStep(STEP_RUNNING)
  dom.runningLead.textContent = t('running.leadPrep')
  try {
    const payloadInfo = await window.launcherApi.getPayloadDir()
    if (!payloadInfo?.present) {
      dom.runningLead.textContent = t('running.leadDownload')
      const result = await window.launcherApi.ensurePayload({ update: false })
      if (!result.ok) throw new Error(result.error || 'download failed')
    }
    dom.runningLead.textContent = t('running.leadStartRuntime')
    const status = await window.launcherApi.start({})
    updateRunningUI(status)
    if (status.running && status.url) {
      await window.launcherApi.openBrowser().catch(() => {})
    }
  } catch (error) {
    appendLog(`startTeam error: ${error.message || error}`)
    dom.runningLead.textContent = t('running.errorStart', { msg: error.message || error })
  } finally {
    state.starting = false
    dom.btnStartTeam.disabled = false
    dom.btnStartTeam.textContent = t('ready.start')
  }
}

async function stopTeam() {
  dom.btnStopTeam.disabled = true
  try {
    await window.launcherApi.stop()
    showStep(STEP_READY)
  } finally {
    dom.btnStopTeam.disabled = false
  }
}

// -------- Wiring --------

initLangDropdown(document.getElementById('lang-select'), {
  onPick: (lang) => {
    setLang(lang)
  },
})

// Re-render the docker card on language change: the card has dynamic
// hints/labels built from state, not [data-i18n], so applyTranslations
// alone doesn't catch them.
onLangChange(() => {
  if (state.docker) renderDockerCard(state.docker)
})

document.getElementById('btn-language-continue').addEventListener('click', () => {
  showStep(STEP_WELCOME)
})

dom.btnWelcomeBack.addEventListener('click', () => showStep(STEP_LANGUAGE))

dom.btnWelcomeContinue.addEventListener('click', async () => {
  await smartAdvanceFromWelcome()
})

// Dev-mode shortcut: visibile solo quando Electron gira da sorgente.
// Probe async all'avvio; se disponibile, mostra il pulsante accanto al
// "Continue" della welcome. Click → dev:launch (compose + host Next :3001
// + open browser). Vedi main.js IPC 'dev:launch' e scripts/dev-up.sh.
;(async () => {
  try {
    if (!window.launcherApi?.devIsAvailable) return
    const probe = await window.launcherApi.devIsAvailable()
    if (!probe?.available || !dom.devModeActions || !dom.btnDevMode) return
    dom.devModeActions.hidden = false
    dom.btnDevMode.addEventListener('click', async () => {
      const original = dom.btnDevMode.textContent
      dom.btnDevMode.disabled = true
      dom.btnDevMode.textContent = '⏳ Avvio in corso…'
      // Reset del bottone (testo + disabled) dopo `ms`. Serve perche'
      // senza reset il bottone resta bloccato sul messaggio di stato
      // e l'utente non puo' ri-cliccare per fare restart (scenario
      // tipico: cambio a una branch di dev, voglio re-spawnare container).
      const resetAfter = (ms) => setTimeout(() => {
        dom.btnDevMode.textContent = original
        dom.btnDevMode.disabled = false
      }, ms)
      try {
        const res = await window.launcherApi.devLaunch()
        if (!res?.ok) {
          dom.btnDevMode.textContent = `✗ ${res?.error || 'errore sconosciuto'}`
          resetAfter(5000)
          return
        }
        dom.btnDevMode.textContent = res.ready
          ? '✓ Pronto — browser aperto su :3001 (click per restart)'
          : '⚠ Partito ma non ancora pronto (apri :3001 manualmente)'
        resetAfter(6000)
      } catch (err) {
        dom.btnDevMode.textContent = `✗ ${err?.message || err}`
        resetAfter(5000)
      }
    })
  } catch {
    // probe fallito → prod o Electron vecchio senza l'IPC: lascia nascosto
  }
})()

// Decide which step the user actually needs to see, based on what is
// already set up on their machine. Jumps past steps whose prerequisite
// is already satisfied so a re-launch doesn't force them through the
// whole wizard again.
async function smartAdvanceFromWelcome() {
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
  await enterSetup()
}

dom.btnSetupBack.addEventListener('click', () => showStep(STEP_WELCOME))

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
  showStep(STEP_CONTAINER)
})

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

// -------- Step: provider login (tmux/subscription auth) --------

dom.btnLoginBack.addEventListener('click', () => {
  // Bounce-back per tre origini possibili:
  //   1. STEP_READY  → utente in setup wizard ha cliccato "Manage login"
  //   2. 'home'      → utente in home ha cliccato "Cambia provider" o
  //                    "Provider login": back deve riportare alla home,
  //                    NON al wizard di setup (era il bug "loop wizard").
  //   3. default     → flusso wizard normale, torna a provider-choose.
  if (state.loginOrigin === STEP_READY) {
    state.loginOrigin = null
    enterReady()
  } else if (state.loginOrigin === 'home') {
    state.loginOrigin = null
    showHome('team')
  } else {
    showStep(STEP_PROVIDER_CHOOSE)
  }
})
dom.btnLoginContinue.addEventListener('click', () => {
  if (dom.btnLoginContinue.disabled) return
  // Stesso discriminatore del back: se siamo arrivati dalla home,
  // continue ritorna alla home (provider/auth gia' applicati al
  // jht.config.json dal flow di login). Niente STEP_READY/startTeam:
  // quello e' il flow di primo setup, non un cambio provider runtime.
  if (state.loginOrigin === 'home') {
    state.loginOrigin = null
    showHome('team')
    return
  }
  state.loginOrigin = null
  enterReady()
})

if (dom.btnReadyManageLogin) {
  dom.btnReadyManageLogin.addEventListener('click', () => {
    state.loginOrigin = STEP_READY
    enterProviderLogin()
  })
}

function providerNeedsLoginContinue() {
  const anyUnauthed = state.authStates.some((a) => !a.authed)
  dom.btnLoginContinue.disabled = anyUnauthed
}

async function enterProviderLogin() {
  showStep(STEP_PROVIDER_LOGIN)
  await refreshAuthList()
}

async function refreshAuthList() {
  try {
    const res = await window.setupApi.getAuthStates()
    state.authStates = Array.isArray(res?.auth) ? res.auth : []
  } catch {
    state.authStates = []
  }
  renderAuthList()
  providerNeedsLoginContinue()
}

function renderAuthList() {
  const list = dom.authList
  list.innerHTML = ''
  for (const entry of state.authStates) {
    const opt = PROVIDER_OPTIONS.find((p) => p.id === entry.id)
    if (!opt) continue

    const card = document.createElement('div')
    card.className = `dep-card dep-card--compact ${entry.authed ? 'dep-card--ok' : 'dep-card--warn'}`

    const header = document.createElement('div')
    header.className = 'dep-card__header'

    const name = document.createElement('span')
    name.className = 'dep-card__name'
    name.textContent = opt.label

    const badge = document.createElement('span')
    badge.className = 'dep-card__badge'
    badge.textContent = entry.authed ? t('login.status.signedIn') : t('login.status.notSignedIn')

    header.appendChild(name)
    header.appendChild(badge)
    card.appendChild(header)

    if (!entry.authed) {
      // Provider-specific hint: Codex's loopback OAuth doesn't work
      // through the container, steer the user to the device-code flow.
      const hintKey = `login.hint.${camelId(entry.id)}`
      const hintText = t(hintKey)
      if (hintText && hintText !== hintKey) {
        const hint = document.createElement('p')
        hint.className = 'dep-card__hint'
        hint.textContent = hintText
        card.appendChild(hint)
      }

      const actions = document.createElement('div')
      actions.className = 'dep-card__actions'

      const btnOpen = document.createElement('button')
      btnOpen.className = 'btn btn--primary'
      btnOpen.textContent = t('login.action.open')
      btnOpen.addEventListener('click', () => openLoginTerminal(entry.id, opt.label))
      actions.appendChild(btnOpen)

      const btnRecheck = document.createElement('button')
      btnRecheck.className = 'btn btn--ghost'
      btnRecheck.textContent = t('login.action.recheck')
      btnRecheck.addEventListener('click', refreshAuthList)
      actions.appendChild(btnRecheck)

      card.appendChild(actions)
    } else {
      // Signed-in state: let the user log out / switch account. Wipes
      // the CLI's credential files on the host bind-mount; the next
      // login flow re-populates them from scratch.
      const actions = document.createElement('div')
      actions.className = 'dep-card__actions'

      // Even when we detect the user as authenticated, keep the
      // terminal door open — Kimi needs /login inside the TUI even
      // after the auth file exists (partial session), and users
      // may want to re-run /login to switch account or troubleshoot.
      const btnOpen = document.createElement('button')
      btnOpen.className = 'btn btn--ghost'
      btnOpen.textContent = t('login.action.openWhenAuthed')
      btnOpen.addEventListener('click', () => openLoginTerminal(entry.id, opt.label))
      actions.appendChild(btnOpen)

      const btnLogout = document.createElement('button')
      btnLogout.className = 'btn btn--ghost'
      btnLogout.textContent = t('login.action.logout')
      btnLogout.addEventListener('click', async () => {
        btnLogout.disabled = true
        try {
          await window.setupApi.logoutProvider(entry.id)
        } finally {
          btnLogout.disabled = false
          await refreshAuthList()
        }
      })
      actions.appendChild(btnLogout)

      card.appendChild(actions)
    }
    list.appendChild(card)
  }
}

// -------- Terminal modal (xterm + node-pty via IPC) --------

let activeTerminal = null
let activeFit = null
let activeSessionId = null
let activeUnsubData = null
let activeUnsubExit = null
let activeResizeObserver = null
let activeLastUrl = null
let activeUrlDebounceTimer = null
// Raw unfiltered pty stream (ANSI stripped) — ground truth for URL
// detection. xterm's rendered buffer sometimes chops long URLs when the
// TUI uses cursor-positioning escape sequences; the raw stream has
// whatever the CLI actually wrote, wrap-free.
let activeRawStream = ''
const URL_STABILIZE_MS = 700
const RAW_STREAM_MAX = 80 * 1024

const TERMINAL_URL_RE = /https?:\/\/[^\s"'<>`]+/g
// Strip ANSI CSI (color/cursor) sequences before URL extraction.
const ANSI_CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

function updateUrlButtons() {
  const visible = !!activeLastUrl
  dom.btnTerminalOpenUrl.hidden = !visible
  dom.btnTerminalCopyUrl.hidden = !visible
}

// Walk xterm's active buffer joining wrapped continuations seamlessly,
// so a URL that spans multiple rendered rows is a single string.
function collectBufferText(term) {
  const buf = term.buffer.active
  const parts = []
  let current = ''
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped) {
      current += text
    } else {
      if (current) parts.push(current)
      current = text
    }
  }
  if (current) parts.push(current)
  return parts.join('\n')
}

function extractLongestUrl(text) {
  const matches = text.match(TERMINAL_URL_RE)
  if (!matches || matches.length === 0) return null
  let best = matches[0]
  for (const m of matches) if (m.length > best.length) best = m
  return best.replace(/[.,:;)\]}>]+$/, '')
}

// Pane-capture style URL extraction, mirroring what a user would do
// reading the terminal screen: dump every visible row as flat text,
// find the row that contains "https://", scan forward until the row
// that starts the CLI's prompt ("Paste code here if prompted"), then
// glue all those rows together dropping every whitespace character.
// Works regardless of xterm soft-wrap flags, cursor repositioning,
// or ANSI frames — whatever is on the screen is what we capture.
const URL_END_MARKER_RE = /paste\s+(the\s+)?code\s+(here|below)|paste\s+code\b|^\s*>\s*$/i

function extractUrlViaPaneCapture(term) {
  if (!term || !term.buffer || !term.buffer.active) return null
  const buf = term.buffer.active
  const rows = []
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (!line) continue
    rows.push(line.translateToString(true))
  }
  let startIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (/https?:\/\//i.test(rows[i])) { startIdx = i; break }
  }
  if (startIdx < 0) return null

  let endIdx = rows.length
  for (let i = startIdx; i < rows.length; i++) {
    // Skip the very first row — it carries the scheme itself and
    // would false-match if the CLI wrote hints on the same line.
    if (i === startIdx) continue
    if (URL_END_MARKER_RE.test(rows[i])) { endIdx = i; break }
  }

  // Join without separators and strip every whitespace run. URLs never
  // contain whitespace, so collapsing is safe; soft-wrap artefacts
  // (padding spaces, leading indents) disappear.
  const joined = rows.slice(startIdx, endIdx).join('').replace(/\s+/g, '')
  const m = joined.match(/https?:\/\/[^\s"'<>`]+/i)
  if (!m) return null
  return m[0].replace(/[.,:;)\]}>]+$/, '')
}

async function openLoginTerminal(providerId, displayName) {
  const Terminal = window.Terminal
  const FitAddon = window.FitAddon && window.FitAddon.FitAddon
  if (!Terminal || !FitAddon) {
    console.error('xterm not loaded')
    return
  }
  activeLastUrl = null
  activeRawStream = ''
  updateUrlButtons()

  dom.terminalModalTitle.textContent = t('login.terminalTitle', { name: displayName })
  dom.terminalModal.hidden = false

  // Reset any previous instance.
  dom.terminalModalBody.innerHTML = ''

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    theme: {
      background: '#0e0e10',
      foreground: '#f5f5f7',
    },
    convertEol: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(dom.terminalModalBody)
  fit.fit()

  // Custom link provider: xterm's stock web-links addon only matches
  // URLs within a single rendered row, so long wrapped URLs become
  // unusable fragments. This provider uses the raw-stream URL we've
  // already tracked (activeLastUrl) and registers every line that
  // contains any part of it — click anywhere in the visible URL and
  // shell.openExternal is called with the full, intact URL.
  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const links = []
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) return callback(links)
      const text = line.translateToString(true)

      const openFull = (url) => () => {
        window.launcherApi.openExternal(url).catch(() => {})
      }

      // URL begins on this line — take the intra-line match, but if we
      // have a tracked URL that starts with it, prefer the tracked one.
      const startRe = /https?:\/\/\S+/g
      let m
      while ((m = startRe.exec(text)) !== null) {
        const hit = m[0].replace(/[.,:;)\]}>]+$/, '')
        const full = activeLastUrl && activeLastUrl.startsWith(hit) ? activeLastUrl : hit
        links.push({
          range: {
            start: { x: m.index + 1, y: bufferLineNumber },
            end: { x: m.index + m[0].length, y: bufferLineNumber },
          },
          text: full,
          activate: openFull(full),
        })
      }

      // Wrapped continuation: no scheme on this line, but it holds a
      // substring of the tracked URL. Make the whole non-whitespace
      // run on the line clickable, pointing at the full URL.
      if (links.length === 0 && activeLastUrl) {
        const stride = 20
        for (let i = 0; i + stride <= activeLastUrl.length; i += 10) {
          const seg = activeLastUrl.slice(i, i + stride)
          const idx = text.indexOf(seg)
          if (idx < 0) continue
          let sx = idx
          let ex = idx + seg.length
          while (sx > 0 && /\S/.test(text[sx - 1])) sx--
          while (ex < text.length && /\S/.test(text[ex])) ex++
          links.push({
            range: {
              start: { x: sx + 1, y: bufferLineNumber },
              end: { x: ex, y: bufferLineNumber },
            },
            text: activeLastUrl,
            activate: openFull(activeLastUrl),
          })
          break
        }
      }
      callback(links)
    },
  })

  // Intercept bare 'c' before it reaches the pty: the CLI inside the
  // container has no access to the Windows clipboard, so its "link
  // copied" message is a lie. We do the real copy on the host side
  // and still forward the key so the CLI's UI feedback stays.
  term.attachCustomKeyEventHandler((event) => {
    if (
      event.type === 'keydown' &&
      event.key === 'c' &&
      !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
      activeLastUrl
    ) {
      window.clipboardApi.write(activeLastUrl).catch(() => {})
    }
    return true
  })

  // Right-click: copy the current xterm selection to the host clipboard
  // (reliable manual fallback if auto-open / click-to-open misbehaves);
  // if nothing is selected, paste from the clipboard into the pty.
  dom.terminalModalBody.addEventListener('contextmenu', async (event) => {
    event.preventDefault()
    const selection = term.getSelection()
    if (selection && selection.length > 0) {
      try { await window.clipboardApi.write(selection) } catch { /* ignore */ }
      term.clearSelection()
      return
    }
    try {
      const text = await window.clipboardApi.read()
      if (text && activeSessionId) window.terminalApi.write(activeSessionId, text)
    } catch { /* ignore */ }
  })

  let result
  try {
    result = await window.terminalApi.start({ providerId })
  } catch (error) {
    term.writeln(`\r\n[error] ${error && error.message ? error.message : error}`)
    return
  }
  if (!result?.ok) {
    term.writeln(`\r\n[error] ${result?.error || 'failed to start'}`)
    return
  }

  activeTerminal = term
  activeFit = fit
  activeSessionId = result.sessionId

  activeUnsubData = window.terminalApi.onData(activeSessionId, (data) => {
    // Accumulate the raw pty stream too, independent of xterm rendering.
    // URL detection on the raw stream is bulletproof against wrap/chop
    // issues caused by cursor-positioning escape sequences.
    activeRawStream += data
    if (activeRawStream.length > RAW_STREAM_MAX) {
      activeRawStream = activeRawStream.slice(-RAW_STREAM_MAX / 2)
    }
    term.write(data, () => {
      // Prefer the raw stream (ANSI stripped) — falls back to xterm's
      // reassembled buffer only if the raw scan misses.
      const rawText = activeRawStream.replace(ANSI_CSI_RE, '')
      const url =
        extractLongestUrl(rawText) ||
        extractLongestUrl(collectBufferText(term))
      if (url && url.length >= 12 && url !== activeLastUrl) {
        activeLastUrl = url
        updateUrlButtons()
      }
      // Debounced refresh of the cached URL (keeps the Open URL button
      // enabled with the latest detection). We deliberately do NOT
      // auto-open the browser here: Ink-based TUIs render the URL
      // progressively, and an early catch can open a truncated URL.
      // The Open URL button re-extracts from the pane on click, which
      // is the only reliable path — let the user drive it.
      if (activeUrlDebounceTimer) clearTimeout(activeUrlDebounceTimer)
      activeUrlDebounceTimer = setTimeout(() => {
        const latest =
          (activeTerminal && extractUrlViaPaneCapture(activeTerminal)) ||
          extractLongestUrl(activeRawStream.replace(ANSI_CSI_RE, '')) ||
          extractLongestUrl(collectBufferText(term))
        if (latest && latest.length >= 12 && latest !== activeLastUrl) {
          activeLastUrl = latest
          updateUrlButtons()
        }
      }, URL_STABILIZE_MS)
    })
  })
  activeUnsubExit = window.terminalApi.onExit(activeSessionId, (exit) => {
    const code = exit && typeof exit.exitCode === 'number' ? exit.exitCode : '?'
    term.writeln(`\r\n\x1b[90m[session closed — exit ${code}]\x1b[0m`)
    // Don't auto-close on non-zero exit so the user can read any error;
    // they must press the ✕ button. Re-check auth in the background.
    activeSessionId = null
    refreshAuthList()
  })

  term.onData((data) => window.terminalApi.write(activeSessionId, data))
  term.onResize(({ cols, rows }) => {
    if (activeSessionId) window.terminalApi.resize(activeSessionId, cols, rows)
  })

  activeResizeObserver = new ResizeObserver(() => {
    try { fit.fit() } catch { /* noop */ }
  })
  activeResizeObserver.observe(dom.terminalModalBody)
}

function closeTerminalModal({ skipKill = false } = {}) {
  if (activeResizeObserver) {
    activeResizeObserver.disconnect()
    activeResizeObserver = null
  }
  if (activeUnsubData) { activeUnsubData(); activeUnsubData = null }
  if (activeUnsubExit) { activeUnsubExit(); activeUnsubExit = null }
  if (activeSessionId && !skipKill) {
    window.terminalApi.kill(activeSessionId).catch(() => {})
  }
  activeSessionId = null
  if (activeTerminal) {
    try { activeTerminal.dispose() } catch { /* noop */ }
    activeTerminal = null
  }
  activeFit = null
  activeLastUrl = null
  activeRawStream = ''
  if (activeUrlDebounceTimer) {
    clearTimeout(activeUrlDebounceTimer)
    activeUrlDebounceTimer = null
  }
  updateUrlButtons()
  dom.terminalModalBody.innerHTML = ''
  dom.terminalModal.hidden = true
}

dom.btnTerminalClose.addEventListener('click', () => {
  closeTerminalModal()
  refreshAuthList()
})

dom.btnTerminalDone.addEventListener('click', () => {
  closeTerminalModal()
  refreshAuthList()
})

dom.btnTerminalPaste.addEventListener('click', async () => {
  if (!activeSessionId) return
  try {
    const text = await window.clipboardApi.read()
    if (text) window.terminalApi.write(activeSessionId, text)
  } catch { /* ignore */ }
})

function freshUrlFromBuffer() {
  // 1) Pane-capture of the visible terminal screen — the authoritative
  //    source because it is exactly what the user sees. Glues rows
  //    together dropping whitespace; uses the "Paste code here"-style
  //    row as the end marker, so nothing past the URL leaks in.
  if (activeTerminal) {
    const fromPane = extractUrlViaPaneCapture(activeTerminal)
    if (fromPane) return fromPane
  }
  // 2) Raw pty stream (ANSI stripped) — helps when the URL has scrolled
  //    off-screen.
  const rawUrl = activeRawStream
    ? extractLongestUrl(activeRawStream.replace(ANSI_CSI_RE, ''))
    : null
  if (rawUrl) return rawUrl
  // 3) Fall back to the cached value if nothing is live.
  if (!activeTerminal) return activeLastUrl
  return extractLongestUrl(collectBufferText(activeTerminal)) || activeLastUrl
}

dom.btnTerminalOpenUrl.addEventListener('click', () => {
  const url = freshUrlFromBuffer()
  if (url) window.launcherApi.openExternal(url).catch(() => {})
})

dom.btnTerminalCopyUrl.addEventListener('click', () => {
  const url = freshUrlFromBuffer()
  if (url) window.clipboardApi.write(url).catch(() => {})
})

// -------- Step: ready (summary) --------

async function enterReady() {
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

dom.btnStartTeam.addEventListener('click', startTeam)
dom.btnOpenBrowser.addEventListener('click', () => window.launcherApi.openBrowser())
dom.btnStopTeam.addEventListener('click', stopTeam)

window.launcherApi.onPayloadLog(appendLog)

setInterval(() => {
  if (state.step === STEP_RUNNING) refreshRunningStatus()
}, 3000)

// -------- Home (post-setup dashboard) --------

const HOME_SECTIONS = ['team', 'provider', 'docker', 'language', 'advanced']

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
}

// Wizard appears only on first launch. The discriminator is "has the
// user ever picked a provider": `providers.saved.length > 0` means they
// already went through onboarding at least once, so on later launches
// land them on the home view even if Docker is down or kimi isn't
// authed — those are recoverable runtime states the home surfaces with
// banners, not setup-incomplete states that warrant the full wizard.
function isSetupComplete(status) {
  if (!status) return false
  const saved = Array.isArray(status.providers?.saved) ? status.providers.saved : []
  return saved.length > 0
}

function showWizard(step = STEP_WELCOME) {
  homeDom.root.hidden = true
  homeDom.wizardRoot.hidden = false
  state.view = 'wizard'
  stopTeamPanelPoll()
  showStep(step)
}

async function showHome(section = 'team') {
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
  ])
}

function renderHomeTeamStatus(status) {
  const mode = status?.mode
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

async function refreshHomeTeamDockerGate(teamStatus) {
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
    const status = await window.launcherApi.getStatus()
    renderHomeTeamStatus(status)
    await refreshHomeTeamDockerGate(status)
  } catch (error) {
    appendLog(`refreshHomeTeam: ${error.message || error}`)
  }
}

async function startTeamFromHome() {
  if (state.starting) return
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
homeDom.btnOpen.addEventListener('click', () => window.launcherApi.openBrowser())
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

// -------- Boot --------

const stored = (() => {
  try { return localStorage.getItem(LANG_STORAGE_KEY) } catch (_) { return null }
})()

async function boot() {
  if (!(stored && SUPPORTED_LANGS.includes(stored))) {
    setLang(DEFAULT_LANG, { persist: false })
    showWizard(STEP_LANGUAGE)
    return
  }
  setLang(stored, { persist: false })
  try {
    const status = await window.setupApi.getStatus()
    if (isSetupComplete(status)) {
      await showHome('team')
      return
    }
  } catch (error) {
    appendLog(`boot probe: ${error.message || error}`)
  }
  showWizard(STEP_WELCOME)
}

// Paint platform-specific docker-card shape synchronously — before the
// first `setup:get-docker-status` IPC reply — so the user never sees a
// flash of the wrong-platform skeleton on boot.
if (window.platformInfo && window.platformInfo.platform) {
  applyPlatformSkeleton(window.platformInfo.platform)
}

boot()
