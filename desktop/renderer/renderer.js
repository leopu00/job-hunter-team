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

const startButton = document.getElementById('startButton')
const stopButton = document.getElementById('stopButton')
const browserButton = document.getElementById('browserButton')
const refreshButton = document.getElementById('refreshButton')

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
    case 'error':
      return '🔴 error'
    default:
      return '⚪ stopped'
  }
}

function updateHint(status) {
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

  if (status.mode === 'starting') {
    hintText.textContent = '⏳ Avvio in corso. Attendo che localhost risponda.'
    return
  }

  hintText.textContent = '⏳ Nessun runtime avviato.'
}

function updateButtons(status) {
  const busy = status.mode === 'starting' || status.mode === 'stopping'
  startButton.disabled = busy || status.mode === 'running'
  stopButton.disabled = busy || (!status.running && status.mode !== 'external')
  browserButton.disabled = busy
}

function renderSetup(setup) {
  depsBadge.textContent = setup.hasNodeModules ? 'deps: ok' : 'deps: missing'
  buildBadge.textContent = setup.hasProductionBuild ? 'build: ready' : 'build: dev fallback'
  modeBadge.textContent = `mode: ${setup.suggestedMode ?? 'unavailable'}`
}

function renderStatus(status) {
  modeValue.textContent = describeMode(status)
  portValue.textContent = String(status.port)
  runtimeValue.textContent = status.runtimeKind ?? 'n/a'
  urlValue.textContent = status.url
  renderSetup(status.setup)
  updateHint(status)
  updateButtons(status)
}

async function refreshStatus() {
  const status = await window.launcherApi.getStatus()
  renderStatus(status)
}

async function boot() {
  const logFile = await window.launcherApi.getLogFile()
  const setup = await window.launcherApi.inspectSetup()
  logFileValue.textContent = `Log file: ${logFile}`
  renderSetup(setup)
  await refreshStatus()
}

startButton.addEventListener('click', async () => {
  const status = await window.launcherApi.start({ port: portInput.value })
  renderStatus(status)
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

setInterval(refreshStatus, 3000)
boot().catch((error) => {
  hintText.textContent = `⚠️ ${error instanceof Error ? error.message : String(error)}`
})
