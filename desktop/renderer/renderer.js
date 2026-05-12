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
  onOpenDownloadPage,
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

import {
  enterProviderLogin,
  refreshAuthList,
} from './modules/terminal-login.js'

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

import {
  showWizard,
  showHome,
  isSetupComplete,
} from './modules/home.js'


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
