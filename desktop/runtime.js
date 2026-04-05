const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DEFAULT_PORT = 3000
const START_TIMEOUT_MS = 20000
const LOG_FILE = path.join(os.tmpdir(), 'jht-desktop-launcher.log')

const state = {
  child: null,
  mode: 'stopped',
  port: DEFAULT_PORT,
  runtimeKind: null,
  startedAt: null,
  lastError: null,
  lastExitCode: null,
}

function getRepoRoot() {
  return path.resolve(__dirname, '..')
}

function getWebDir() {
  return path.join(getRepoRoot(), 'web')
}

function getUrl(port = state.port) {
  return `http://localhost:${port}`
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function fileExists(targetPath) {
  return fs.existsSync(targetPath)
}

function appendLog(chunk) {
  fs.appendFileSync(LOG_FILE, chunk)
}

function writeLogHeader(message) {
  appendLog(`\n[${new Date().toISOString()}] ${message}\n`)
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function waitForPort(port, timeoutMs = START_TIMEOUT_MS) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await isPortOpen(port)) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function buildStatus(extra = {}) {
  return {
    mode: state.mode,
    running: state.mode === 'running' || state.mode === 'starting',
    managed: !!state.child,
    port: state.port,
    url: getUrl(),
    runtimeKind: state.runtimeKind,
    startedAt: state.startedAt,
    lastError: state.lastError,
    lastExitCode: state.lastExitCode,
    logFile: LOG_FILE,
    ...extra,
  }
}

function bindLogs(child) {
  child.stdout?.on('data', (chunk) => appendLog(chunk))
  child.stderr?.on('data', (chunk) => appendLog(chunk))
}

function resetState(mode = 'stopped') {
  state.child = null
  state.mode = mode
  state.runtimeKind = null
}

async function getStatus() {
  if (!state.child && (await isPortOpen(state.port))) {
    return buildStatus({ mode: 'external', running: true, managed: false })
  }
  return buildStatus()
}

async function startRuntime(options = {}) {
  const requestedPort = Number.parseInt(String(options.port ?? DEFAULT_PORT), 10)
  state.port = Number.isFinite(requestedPort) ? requestedPort : DEFAULT_PORT

  if (state.child) {
    return buildStatus({ note: 'already-managed' })
  }

  if (await isPortOpen(state.port)) {
    state.mode = 'external'
    return buildStatus({ note: 'port-already-open', running: true, managed: false })
  }

  const webDir = getWebDir()
  if (!fileExists(path.join(webDir, 'package.json'))) {
    state.mode = 'error'
    state.lastError = `Directory web/ non trovata in ${webDir}`
    return buildStatus()
  }

  if (!fileExists(path.join(webDir, 'node_modules'))) {
    state.mode = 'error'
    state.lastError = 'Dipendenze web mancanti. Esegui npm install in web/ prima di usare il launcher.'
    return buildStatus()
  }

  const hasBuild = fileExists(path.join(webDir, '.next'))
  const command = getNpmCommand()
  const args = hasBuild
    ? ['run', 'start', '--', '-p', String(state.port)]
    : ['run', 'dev', '--', '-p', String(state.port)]

  state.mode = 'starting'
  state.runtimeKind = hasBuild ? 'production' : 'development'
  state.startedAt = new Date().toISOString()
  state.lastError = null
  state.lastExitCode = null

  writeLogHeader(`Launching JHT web runtime in ${state.runtimeKind} mode on port ${state.port}`)

  const child = spawn(command, args, {
    cwd: webDir,
    env: { ...process.env, PORT: String(state.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  state.child = child
  bindLogs(child)

  child.once('exit', (code, signal) => {
    state.lastExitCode = code
    if (state.mode !== 'stopped') {
      state.mode = 'stopped'
    }
    if (signal) {
      state.lastError = `Runtime terminato dal segnale ${signal}`
    } else if (code && code !== 0) {
      state.lastError = `Runtime terminato con exit code ${code}`
    }
    resetState(state.mode)
  })

  const ready = await waitForPort(state.port)
  if (!ready) {
    await stopRuntime()
    state.mode = 'error'
    state.lastError = `Timeout: localhost:${state.port} non ha risposto entro ${START_TIMEOUT_MS / 1000}s`
    return buildStatus()
  }

  state.mode = 'running'
  return buildStatus()
}

async function stopRuntime() {
  if (!state.child) {
    state.mode = 'stopped'
    return buildStatus()
  }

  const child = state.child
  state.mode = 'stopping'

  try {
    child.kill()
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error)
  }

  await new Promise((resolve) => setTimeout(resolve, 500))
  resetState('stopped')
  return buildStatus()
}

module.exports = {
  DEFAULT_PORT,
  getLogFile: () => LOG_FILE,
  getStatus,
  startRuntime,
  stopRuntime,
}
