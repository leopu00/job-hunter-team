const modeValue = document.getElementById('modeValue')
const portValue = document.getElementById('portValue')
const runtimeValue = document.getElementById('runtimeValue')
const urlValue = document.getElementById('urlValue')
const hintText = document.getElementById('hintText')
const portInput = document.getElementById('portInput')
const logFileValue = document.getElementById('logFileValue')
const depsBadge = document.getElementById('depsBadge')
const buildBadge = document.getElementById('buildBadge')
const modeBadge = document.getElementById('modeBadge')
const activePortBadge = document.getElementById('activePortBadge')
const depsList = document.getElementById('depsList')
const depsSummary = document.getElementById('depsSummary')
const payloadStatus = document.getElementById('payloadStatus')
const payloadLog = document.getElementById('payloadLog')

const startButton = document.getElementById('startButton')
const stopButton = document.getElementById('stopButton')
const browserButton = document.getElementById('browserButton')
const refreshButton = document.getElementById('refreshButton')
const recheckButton = document.getElementById('recheckButton')
const updatePayloadButton = document.getElementById('updatePayloadButton')

let dependenciesOk = false
let payloadReady = false
let payloadBusy = false

function describeMode(status) {
  switch (status.mode) {
    case 'running':
      return '🟢 running'
    case 'starting':
      return '🟡 starting'
    case 'stopping':
      return '🟠 stopping'
    case 'external':
      return '🔵 external'
    case 'blocked':
      return '🟣 blocked'
    case 'error':
      return '🔴 error'
    default:
      return '⚪ stopped'
  }
}

function updateHint(status) {
  if (status.message) {
    hintText.textContent = status.message
    return
  }

  if (status.lastError) {
    hintText.textContent = `⚠️ ${status.lastError}`
    return
  }

  if (status.mode === 'running') {
    hintText.textContent = '✅ JHT è attivo e il browser può usare la dashboard locale.'
    return
  }

  if (status.mode === 'external') {
    hintText.textContent = 'ℹ️ La porta è già occupata: sembra esserci già una dashboard attiva.'
    return
  }

  if (status.mode === 'blocked') {
    hintText.textContent = '⚠️ La porta è occupata, ma la dashboard non risponde. Il launcher userà una porta alternativa al prossimo start.'
    return
  }

  if (status.mode === 'starting') {
    hintText.textContent = '⏳ Avvio in corso. Attendo che localhost risponda.'
    return
  }

  if (!dependenciesOk) {
    hintText.textContent = '⏳ Completa la checklist delle dipendenze per abilitare l\u2019avvio.'
    return
  }

  hintText.textContent = '⏳ Nessun runtime avviato.'
}

function updateButtons(status) {
  const busy = status.mode === 'starting' || status.mode === 'stopping' || payloadBusy
  startButton.disabled = busy || status.mode === 'running' || !dependenciesOk
  stopButton.disabled = busy || (!status.running && status.mode !== 'external')
  browserButton.disabled = busy
  updatePayloadButton.disabled = payloadBusy || !payloadReady || !dependenciesOk
}

function renderSetup(setup) {
  if (!setup) return
  depsBadge.textContent = setup.hasNodeModules ? 'deps: ok' : 'deps: missing'
  buildBadge.textContent = setup.hasProductionBuild ? 'build: ready' : 'build: dev fallback'
  modeBadge.textContent = `mode: ${setup.suggestedMode ?? 'unavailable'}`
}

function depIcon(dep) {
  if (dep.ok && dep.installed) return '✅'
  if (!dep.required && !dep.installed) return '➖'
  if (dep.installed && !dep.ok) return '⚠️'
  return '❌'
}

function renderDependencyItem(dep) {
  const item = document.createElement('li')
  item.className = 'dep-item'
  if (dep.ok) item.classList.add('dep-item--ok')
  else if (dep.installed) item.classList.add('dep-item--warn')
  else item.classList.add('dep-item--missing')
  if (!dep.required) item.classList.add('dep-item--optional')

  const icon = document.createElement('div')
  icon.className = 'dep-item__icon'
  icon.textContent = depIcon(dep)

  const body = document.createElement('div')
  body.className = 'dep-item__body'

  const title = document.createElement('div')
  title.className = 'dep-item__title'
  const name = document.createElement('span')
  name.className = 'dep-item__name'
  name.textContent = dep.name
  title.appendChild(name)
  const tag = document.createElement('span')
  tag.className = 'dep-item__tag'
  tag.textContent = dep.required ? 'obbligatorio' : 'opzionale'
  title.appendChild(tag)
  body.appendChild(title)

  const meta = document.createElement('div')
  meta.className = 'dep-item__meta'
  if (dep.installed && dep.version) {
    meta.textContent = `Rilevato: v${dep.version}${dep.minVersion ? ` (minima ${dep.minVersion})` : ''}`
  } else if (dep.installed) {
    meta.textContent = 'Rilevato: versione sconosciuta'
  } else {
    meta.textContent = dep.minVersion ? `Non trovato (minima ${dep.minVersion})` : 'Non trovato'
  }
  body.appendChild(meta)

  if (dep.hint) {
    const hint = document.createElement('div')
    hint.className = 'dep-item__hint'
    hint.textContent = dep.hint
    body.appendChild(hint)
  }

  item.appendChild(icon)
  item.appendChild(body)

  if (!dep.ok && dep.installUrl) {
    const installBtn = document.createElement('button')
    installBtn.type = 'button'
    installBtn.className = 'button button--ghost dep-item__install'
    installBtn.textContent = 'Come installare'
    installBtn.addEventListener('click', () => {
      window.launcherApi.openExternal(dep.installUrl).catch(() => {})
    })
    item.appendChild(installBtn)
  }

  return item
}

function renderDependencies(setup) {
  const deps = Array.isArray(setup?.dependencies) ? setup.dependencies : []
  depsList.innerHTML = ''
  if (deps.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'deps-list__placeholder'
    empty.textContent = 'Nessuna informazione sulle dipendenze.'
    depsList.appendChild(empty)
  } else {
    for (const dep of deps) {
      depsList.appendChild(renderDependencyItem(dep))
    }
  }

  dependenciesOk = setup?.allRequiredOk === true
  if (dependenciesOk) {
    depsSummary.textContent = '✅ Tutte le dipendenze obbligatorie sono OK. Puoi avviare JHT.'
  } else {
    const missing = deps
      .filter((dep) => dep.required && !dep.ok)
      .map((dep) => dep.name)
    depsSummary.textContent = missing.length
      ? `⚠️ Manca: ${missing.join(', ')}. Installa e poi premi "Ricontrolla".`
      : '⚠️ Alcune dipendenze obbligatorie non sono OK. Premi "Ricontrolla" dopo averle sistemate.'
  }
}

function renderActivePort(status) {
  if (status.note === 'port-fallback') {
    activePortBadge.textContent = `active: ${status.port} fallback`
    return
  }

  if (status.mode === 'running' || status.mode === 'external') {
    activePortBadge.textContent = `active: ${status.port}`
    return
  }

  if (status.mode === 'blocked') {
    activePortBadge.textContent = `blocked: ${status.port}`
    return
  }

  activePortBadge.textContent = `target: ${status.port}`
}

function renderStatus(status) {
  modeValue.textContent = describeMode(status)
  portValue.textContent = String(status.port)
  runtimeValue.textContent = status.runtimeKind ?? 'n/a'
  urlValue.textContent = status.url
  renderActivePort(status)
  renderSetup(status.setup)
  if (document.activeElement !== portInput || status.mode === 'running' || status.note === 'port-fallback') {
    portInput.value = String(status.port)
  }
  updateHint(status)
  updateButtons(status)
}

async function refreshStatus() {
  const status = await window.launcherApi.getStatus()
  renderStatus(status)
}

async function refreshDependencies() {
  const setup = await window.launcherApi.inspectSetup()
  renderSetup(setup)
  renderDependencies(setup)
  return setup
}

function appendPayloadLog(line) {
  if (!line) return
  payloadLog.hidden = false
  payloadLog.textContent += `${line}\n`
  payloadLog.scrollTop = payloadLog.scrollHeight
}

function renderPayloadInfo(info) {
  payloadReady = info?.present === true
  if (!info?.payloadDir) {
    payloadStatus.textContent = 'Payload: percorso non disponibile.'
    return
  }
  payloadStatus.textContent = payloadReady
    ? `Payload: presente in ${info.payloadDir}`
    : `Payload: da scaricare al primo Start (verrà copiato in ${info.payloadDir})`
}

async function refreshPayload() {
  const info = await window.launcherApi.getPayloadDir()
  renderPayloadInfo(info)
  return info
}

async function runPayloadAction({ update = false, reason = '' } = {}) {
  payloadBusy = true
  payloadLog.hidden = false
  payloadLog.textContent = ''
  if (reason) appendPayloadLog(reason)
  await refreshStatus()
  try {
    const result = await window.launcherApi.ensurePayload({ update })
    if (!result.ok) {
      appendPayloadLog(`⚠️ ${result.error}`)
      hintText.textContent = `⚠️ ${result.error}`
      return { ok: false }
    }
    appendPayloadLog(`✔ Operazione: ${result.action}`)
    if (result.warning) appendPayloadLog(`⚠️ ${result.warning}`)
    await refreshPayload()
    return { ok: true, action: result.action }
  } finally {
    payloadBusy = false
    await refreshStatus()
  }
}

async function boot() {
  const logFile = await window.launcherApi.getLogFile()
  logFileValue.textContent = `Log file: ${logFile}`
  window.launcherApi.onPayloadLog(appendPayloadLog)
  await refreshDependencies()
  await refreshPayload()
  await refreshStatus()
}

startButton.addEventListener('click', async () => {
  if (!dependenciesOk || payloadBusy) return
  const payloadInfo = await refreshPayload()
  if (!payloadInfo?.present) {
    const result = await runPayloadAction({
      update: false,
      reason: 'Payload non trovato: avvio il download…',
    })
    if (!result.ok) return
  }
  const status = await window.launcherApi.start({ port: portInput.value })
  renderStatus(status)
})

updatePayloadButton.addEventListener('click', async () => {
  if (payloadBusy) return
  await runPayloadAction({ update: true, reason: 'Aggiorno il payload…' })
})

stopButton.addEventListener('click', async () => {
  const status = await window.launcherApi.stop()
  renderStatus(status)
})

browserButton.addEventListener('click', async () => {
  const status = await window.launcherApi.openBrowser()
  renderStatus(status)
})

refreshButton.addEventListener('click', refreshStatus)

recheckButton.addEventListener('click', async () => {
  recheckButton.disabled = true
  const previousLabel = recheckButton.textContent
  recheckButton.textContent = 'Controllo…'
  try {
    await refreshDependencies()
    await refreshStatus()
  } finally {
    recheckButton.textContent = previousLabel
    recheckButton.disabled = false
  }
})

setInterval(refreshStatus, 3000)
boot().catch((error) => {
  hintText.textContent = `⚠️ ${error instanceof Error ? error.message : String(error)}`
})
