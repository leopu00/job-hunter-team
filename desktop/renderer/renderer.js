// Wizard renderer: welcome → setup → ready → running.
// The user never sees a scrollable dump of state; each step has one job.

const STEP_WELCOME = 'welcome'
const STEP_SETUP = 'setup'
const STEP_READY = 'ready'
const STEP_RUNNING = 'running'

const state = {
  step: STEP_WELCOME,
  docker: null,
  payloadBusy: false,
  starting: false,
}

const dom = {
  steps: document.querySelectorAll('.step'),
  btnWelcomeContinue: document.getElementById('btn-welcome-continue'),
  btnSetupBack: document.getElementById('btn-setup-back'),
  btnSetupContinue: document.getElementById('btn-setup-continue'),
  btnStartTeam: document.getElementById('btn-start-team'),
  btnOpenBrowser: document.getElementById('btn-open-browser'),
  btnStopTeam: document.getElementById('btn-stop-team'),
  dockerIcon: document.getElementById('docker-icon'),
  dockerBadge: document.getElementById('docker-badge'),
  dockerHint: document.getElementById('docker-hint'),
  dockerStats: document.getElementById('docker-stats'),
  dockerRequired: document.getElementById('docker-required'),
  dockerFree: document.getElementById('docker-free'),
  dockerActions: document.getElementById('docker-actions'),
  dockerCard: document.getElementById('docker-card'),
  runningTitle: document.getElementById('running-title'),
  runningLead: document.getElementById('running-lead'),
  runningInfo: document.getElementById('running-info'),
  advancedLog: document.getElementById('advanced-log'),
  readyHint: document.getElementById('ready-hint'),
}

function showStep(name) {
  state.step = name
  for (const section of dom.steps) {
    if (section.dataset.step === name) {
      section.hidden = false
    } else {
      section.hidden = true
    }
  }
}

function appendLog(line) {
  if (!line) return
  dom.advancedLog.textContent += `${line}\n`
}

// -------- Step 2: Setup (Docker checklist) --------

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

function renderDockerCard(status) {
  const check = status.check
  const card = dom.dockerCard
  card.classList.remove('dep-card--ok', 'dep-card--warn', 'dep-card--missing')

  if (check.state === 'ok') {
    dom.dockerIcon.textContent = '✓'
    dom.dockerBadge.textContent = 'Pronto'
    card.classList.add('dep-card--ok')
  } else if (check.state === 'needs-reboot') {
    dom.dockerIcon.textContent = '⚠'
    dom.dockerBadge.textContent = 'Riavvio necessario'
    card.classList.add('dep-card--warn')
  } else {
    dom.dockerIcon.textContent = '○'
    dom.dockerBadge.textContent = 'Non installato'
    card.classList.add('dep-card--missing')
  }

  dom.dockerHint.textContent = check.hint || ''

  // Stats visible only when we know the disk space.
  if (status.disk && status.disk.freeHuman) {
    dom.dockerStats.hidden = false
    dom.dockerRequired.textContent = status.disk.requiredHuman || '—'
    dom.dockerFree.textContent = status.disk.freeHuman
    if (status.disk.meetsRequirement === false) {
      dom.dockerFree.classList.add('stat__value--warn')
    } else {
      dom.dockerFree.classList.remove('stat__value--warn')
    }
  } else {
    dom.dockerStats.hidden = true
  }

  clearChildren(dom.dockerActions)

  if (check.state === 'ok') {
    // Nothing to install; enable "Avanti".
    return
  }

  if (check.state === 'missing') {
    const download = document.createElement('button')
    download.className = 'btn btn--primary'
    download.textContent = 'Scarica installer'
    download.addEventListener('click', onOpenDownloadPage)
    dom.dockerActions.appendChild(download)

    const recheck = document.createElement('button')
    recheck.className = 'btn btn--ghost'
    recheck.textContent = 'Ho installato, ricontrolla'
    recheck.addEventListener('click', refreshDockerStatus)
    dom.dockerActions.appendChild(recheck)
    return
  }

  if (check.state === 'needs-reboot') {
    const recheck = document.createElement('button')
    recheck.className = 'btn btn--primary'
    recheck.textContent = 'Ho riavviato, ricontrolla'
    recheck.addEventListener('click', refreshDockerStatus)
    dom.dockerActions.appendChild(recheck)
  }
}

async function refreshDockerStatus() {
  setBusy(true)
  try {
    const status = await window.setupApi.getDockerStatus()
    state.docker = status
    renderDockerCard(status)
    dom.btnSetupContinue.disabled = status.check.state !== 'ok'
  } finally {
    setBusy(false)
  }
}

function setBusy(isBusy) {
  dom.dockerCard.classList.toggle('dep-card--busy', isBusy)
  for (const btn of dom.dockerActions.querySelectorAll('button')) {
    btn.disabled = isBusy
  }
}

async function onOpenDownloadPage() {
  setBusy(true)
  try {
    await window.setupApi.openDockerDownloadPage()
  } finally {
    setBusy(false)
  }
}

// -------- Step 4: Running --------

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
  if (status.url) dom.runningInfo.appendChild(row('URL', status.url))
  if (status.port) dom.runningInfo.appendChild(row('Porta', String(status.port)))
  if (status.mode) dom.runningInfo.appendChild(row('Modalità', status.mode))
  if (status.running) {
    dom.runningLead.textContent = 'Il runtime è partito. Apri la dashboard nel browser per iniziare.'
  } else if (status.mode === 'starting') {
    dom.runningLead.textContent = 'Avvio in corso…'
  } else if (status.mode === 'error') {
    dom.runningLead.textContent = status.lastError
      ? `Errore: ${status.lastError}`
      : 'Errore sconosciuto.'
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
  dom.btnStartTeam.textContent = 'Avvio in corso…'
  showStep(STEP_RUNNING)
  dom.runningLead.textContent = 'Preparazione del runtime…'
  try {
    const payloadInfo = await window.launcherApi.getPayloadDir()
    if (!payloadInfo?.present) {
      dom.runningLead.textContent = 'Scarico il codice del team (una tantum, ~60 MB)…'
      const result = await window.launcherApi.ensurePayload({ update: false })
      if (!result.ok) throw new Error(result.error || 'download fallito')
    }
    dom.runningLead.textContent = 'Avvio il runtime…'
    const status = await window.launcherApi.start({})
    updateRunningUI(status)
    if (status.running && status.url) {
      await window.launcherApi.openBrowser().catch(() => {})
    }
  } catch (error) {
    appendLog(`startTeam errore: ${error.message || error}`)
    dom.runningLead.textContent = `Errore durante l'avvio: ${error.message || error}`
  } finally {
    state.starting = false
    dom.btnStartTeam.disabled = false
    dom.btnStartTeam.textContent = 'Avvia Job Hunter Team'
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

dom.btnWelcomeContinue.addEventListener('click', async () => {
  showStep(STEP_SETUP)
  await refreshDockerStatus()
})

dom.btnSetupBack.addEventListener('click', () => showStep(STEP_WELCOME))

dom.btnSetupContinue.addEventListener('click', () => {
  if (state.docker?.check.state === 'ok') {
    showStep(STEP_READY)
  }
})

dom.btnStartTeam.addEventListener('click', startTeam)
dom.btnOpenBrowser.addEventListener('click', () => window.launcherApi.openBrowser())
dom.btnStopTeam.addEventListener('click', stopTeam)

window.launcherApi.onPayloadLog(appendLog)

// Poll running state only while we are on the running step.
setInterval(() => {
  if (state.step === STEP_RUNNING) refreshRunningStatus()
}, 3000)
