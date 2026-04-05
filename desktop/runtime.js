const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DEFAULT_PORT = 3000
const START_TIMEOUT_MS = 20000
const STOP_TIMEOUT_MS = 1500

function getDefaultLogFile() {
  return path.join(os.tmpdir(), 'jht-desktop-launcher.log')
}

function resolvePort(rawPort) {
  const requestedPort = Number.parseInt(String(rawPort ?? DEFAULT_PORT), 10)
  if (!Number.isFinite(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
    return DEFAULT_PORT
  }
  return requestedPort
}

function fileExists(targetPath) {
  return fs.existsSync(targetPath)
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function detectStartMode(webDir) {
  const hasNodeModules = fileExists(path.join(webDir, 'node_modules'))
  const hasProductionBuild = fileExists(path.join(webDir, '.next', 'BUILD_ID'))

  if (hasProductionBuild) return 'production'
  if (hasNodeModules) return 'development'
  return null
}

function inspectWebSetup(repoRoot = path.resolve(__dirname, '..')) {
  const webDir = path.join(repoRoot, 'web')
  const hasPackageJson = fileExists(path.join(webDir, 'package.json'))
  const hasNodeModules = fileExists(path.join(webDir, 'node_modules'))
  const hasProductionBuild = fileExists(path.join(webDir, '.next', 'BUILD_ID'))
  const suggestedMode = hasProductionBuild ? 'production' : hasNodeModules ? 'development' : null
  const issues = []

  if (!hasPackageJson) {
    issues.push(`Directory web/ non trovata in ${webDir}`)
  }
  if (hasPackageJson && !hasNodeModules) {
    issues.push('Dipendenze web mancanti. Esegui npm install in web/ prima di usare il launcher.')
  }

  return {
    repoRoot,
    webDir,
    hasPackageJson,
    hasNodeModules,
    hasProductionBuild,
    suggestedMode,
    issues,
  }
}

function defaultSpawnSpecFactory({ mode, port, webDir }) {
  const npmCommand = getNpmCommand()
  const args = mode === 'production'
    ? ['run', 'start', '--', '-p', String(port)]
    : ['run', 'dev', '--', '-p', String(port)]

  return {
    command: npmCommand,
    args,
    options: {
      cwd: webDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  }
}

function createRuntimeManager(config = {}) {
  const repoRoot = config.repoRoot ?? path.resolve(__dirname, '..')
  const logFile = config.logFile ?? getDefaultLogFile()
  const startTimeoutMs = config.startTimeoutMs ?? START_TIMEOUT_MS
  const stopTimeoutMs = config.stopTimeoutMs ?? STOP_TIMEOUT_MS
  const spawnFn = config.spawnFn ?? spawn
  const spawnSpecFactory = config.spawnSpecFactory ?? defaultSpawnSpecFactory
  const isPortOpenFn = config.isPortOpenFn
  const probeHttpFn = config.probeHttpFn
  const portFallbackSpan = config.portFallbackSpan ?? 10
  const state = {
    child: null,
    mode: 'stopped',
    port: DEFAULT_PORT,
    runtimeKind: null,
    startedAt: null,
    lastError: null,
    lastExitCode: null,
  }

  function getWebDir() {
    return path.join(repoRoot, 'web')
  }

  function getUrl(port = state.port) {
    return `http://localhost:${port}`
  }

  function appendLog(chunk) {
    fs.appendFileSync(logFile, chunk)
  }

  function writeLogHeader(message) {
    appendLog(`\n[${new Date().toISOString()}] ${message}\n`)
  }

  function isPortOpen(port) {
    if (isPortOpenFn) {
      return Promise.resolve(isPortOpenFn(port))
    }
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

  function probeHttp(port) {
    if (probeHttpFn) {
      return Promise.resolve(probeHttpFn(port))
    }

    return new Promise((resolve) => {
      const request = http.request({
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        timeout: 1200,
      }, (response) => {
        response.resume()
        resolve(response.statusCode >= 200 && response.statusCode < 500)
      })

      request.on('timeout', () => {
        request.destroy()
        resolve(false)
      })
      request.on('error', () => resolve(false))
      request.end()
    })
  }

  async function waitForPort(port, timeoutMs = startTimeoutMs) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await isPortOpen(port)) return true
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return false
  }

  async function inspectPort(port) {
    const tcpOpen = await isPortOpen(port)
    if (!tcpOpen) {
      return { port, tcpOpen: false, httpOk: false, state: 'free' }
    }

    const httpOk = await probeHttp(port)
    if (httpOk) {
      return { port, tcpOpen: true, httpOk: true, state: 'reachable' }
    }

    return { port, tcpOpen: true, httpOk: false, state: 'blocked' }
  }

  async function findFallbackPort(startPort) {
    for (let offset = 1; offset <= portFallbackSpan; offset += 1) {
      const candidate = startPort + offset
      const inspection = await inspectPort(candidate)
      if (inspection.state === 'free') {
        return candidate
      }
    }
    return null
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
      logFile,
      setup: inspectWebSetup(repoRoot),
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
    if (!state.child) {
      const inspection = await inspectPort(state.port)
      if (inspection.state === 'reachable') {
        return buildStatus({
          mode: 'external',
          running: true,
          managed: false,
          note: 'external-runtime',
          message: `Dashboard già raggiungibile su ${getUrl()}.`,
        })
      }
      if (inspection.state === 'blocked') {
        return buildStatus({
          mode: 'blocked',
          running: false,
          managed: false,
          note: 'port-blocked',
          message: `La porta ${state.port} è occupata ma non risponde via HTTP.`,
        })
      }
    }
    return buildStatus()
  }

  async function startRuntime(options = {}) {
    const preferredPort = resolvePort(options.port)
    state.port = preferredPort

    if (state.child) {
      return buildStatus({ note: 'already-managed' })
    }

    const allowPortFallback = options.allowPortFallback !== false
    const preferredInspection = await inspectPort(preferredPort)
    if (preferredInspection.state === 'reachable') {
      state.mode = 'external'
      return buildStatus({
        note: 'port-already-open',
        message: `Dashboard già attiva su ${getUrl(preferredPort)}.`,
        running: true,
        managed: false,
      })
    }

    if (preferredInspection.state === 'blocked') {
      if (!allowPortFallback) {
        state.mode = 'error'
        state.lastError = `La porta ${preferredPort} è occupata da un processo non raggiungibile.`
        return buildStatus()
      }

      const fallbackPort = await findFallbackPort(preferredPort)
      if (!fallbackPort) {
        state.mode = 'error'
        state.lastError = `La porta ${preferredPort} è occupata e non ho trovato una porta libera vicina.`
        return buildStatus()
      }

      state.port = fallbackPort
    }

    const setup = inspectWebSetup(repoRoot)
    if (!setup.hasPackageJson) {
      state.mode = 'error'
      state.lastError = setup.issues[0] ?? `Directory web/ non trovata in ${setup.webDir}`
      return buildStatus()
    }

    if (!setup.hasNodeModules) {
      state.mode = 'error'
      state.lastError = setup.issues[0] ?? 'Dipendenze web mancanti.'
      return buildStatus()
    }

    const requestedMode = options.preferredMode === 'production' || options.preferredMode === 'development'
      ? options.preferredMode
      : 'auto'
    const detectedMode = detectStartMode(setup.webDir)
    const mode = requestedMode === 'auto' ? detectedMode : requestedMode

    if (!mode) {
      state.mode = 'error'
      state.lastError = 'Impossibile determinare una modalità di avvio valida.'
      return buildStatus()
    }

    if (mode === 'production' && !setup.hasProductionBuild) {
      state.mode = 'error'
      state.lastError = 'Build production mancante. Genera web/.next prima di avviare in modalità production.'
      return buildStatus()
    }

    state.mode = 'starting'
    state.runtimeKind = mode
    state.startedAt = new Date().toISOString()
    state.lastError = null
    state.lastExitCode = null

    writeLogHeader(`Launching JHT web runtime in ${mode} mode on port ${state.port}`)

    const spec = spawnSpecFactory({ mode, port: state.port, webDir: setup.webDir, repoRoot })
    const child = spawnFn(spec.command, spec.args, spec.options)

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
      state.lastError = `Timeout: localhost:${state.port} non ha risposto entro ${startTimeoutMs / 1000}s`
      return buildStatus()
    }

    state.mode = 'running'
    return buildStatus(state.port !== preferredPort
      ? {
          note: 'port-fallback',
          message: `La porta ${preferredPort} era occupata. JHT è partito su ${getUrl(state.port)}.`,
        }
      : {})
  }

  async function stopRuntime() {
    if (!state.child) {
      state.mode = 'stopped'
      return buildStatus()
    }

    const child = state.child
    state.mode = 'stopping'

    const exited = new Promise((resolve) => {
      child.once('exit', () => resolve(true))
    })

    try {
      child.kill()
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error)
    }

    const graceful = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve(false), stopTimeoutMs)),
    ])

    if (!graceful && child.exitCode == null) {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore hard kill failures
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    resetState('stopped')
    return buildStatus()
  }

  return {
    getLogFile: () => logFile,
    inspectSetup: () => inspectWebSetup(repoRoot),
    getStatus,
    startRuntime,
    stopRuntime,
  }
}

const runtime = createRuntimeManager()

module.exports = {
  DEFAULT_PORT,
  START_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
  resolvePort,
  detectStartMode,
  inspectWebSetup,
  createRuntimeManager,
  getLogFile: runtime.getLogFile,
  inspectSetup: runtime.inspectSetup,
  getStatus: runtime.getStatus,
  startRuntime: runtime.startRuntime,
  stopRuntime: runtime.stopRuntime,
}
