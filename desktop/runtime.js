const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const containerRuntime = require('./container')
const { inspectDependencies } = require('./dependencies')

const DEFAULT_PORT = 3000
const START_TIMEOUT_MS = 20000
const STOP_TIMEOUT_MS = 1500
// Dopo che TCP è open, aspettiamo che /api/health risponda 200 prima
// di considerare Next "pronto". In container/dev Turbopack serve
// risposte solo dopo il primo bundle → TCP open != dev server vivo.
const HEALTH_TIMEOUT_MS = 30000
// Warm-up: triggeriamo la compilazione on-demand di Turbopack sulle
// pagine che l'utente apre per prime. Così quando il browser arriva,
// non aspetta 5-15s di compile alla prima navigazione.
const WARM_UP_TIMEOUT_MS = 45000
const WARM_UP_PATHS = ['/onboarding', '/dashboard', '/team', '/capitano']

function getDefaultLogFile() {
  return path.join(os.tmpdir(), 'jht-desktop-launcher.log')
}

function hasWebEntry(candidateRoot) {
  if (!candidateRoot) return false
  const webDir = path.join(candidateRoot, 'web')
  return (
    fs.existsSync(path.join(webDir, 'package.json'))
    || fs.existsSync(path.join(webDir, 'server.js'))
  )
}

function resolveRepoRoot(baseDir = __dirname, payloadDir = null) {
  if (payloadDir && hasWebEntry(payloadDir)) {
    return payloadDir
  }

  return path.resolve(baseDir, '..')
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

function hasStandaloneServer(webDir) {
  return fileExists(path.join(webDir, 'server.js'))
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function isPackagedRuntime() {
  return process.defaultApp !== true && !!process.resourcesPath
}

function detectStartMode(webDir) {
  const hasNodeModules = fileExists(path.join(webDir, 'node_modules'))
  const hasProductionBuild = fileExists(path.join(webDir, '.next', 'BUILD_ID')) || hasStandaloneServer(webDir)

  if (hasProductionBuild) return 'production'
  if (hasNodeModules) return 'development'
  return null
}

function inspectWebSetup(repoRoot = resolveRepoRoot(__dirname)) {
  const webDir = path.join(repoRoot, 'web')
  const hasPackageJson = fileExists(path.join(webDir, 'package.json'))
  const standaloneServer = hasStandaloneServer(webDir)
  const hasNodeModules = fileExists(path.join(webDir, 'node_modules'))
  const hasProductionBuild = fileExists(path.join(webDir, '.next', 'BUILD_ID')) || standaloneServer
  const suggestedMode = hasProductionBuild ? 'production' : hasNodeModules ? 'development' : null
  const issues = []

  if (!hasPackageJson && !standaloneServer) {
    issues.push(`Directory web/ non trovata in ${webDir}`)
  }
  if (hasPackageJson && !hasNodeModules && !hasProductionBuild) {
    issues.push('Dipendenze web mancanti. Esegui npm install in web/ prima di usare il launcher.')
  }

  return {
    repoRoot,
    webDir,
    hasPackageJson,
    hasStandaloneServer: standaloneServer,
    hasNodeModules,
    hasProductionBuild,
    suggestedMode,
    issues,
  }
}

function defaultSpawnSpecFactory({ mode, port, webDir }) {
  if (isPackagedRuntime()) {
    const standaloneServer = path.join(webDir, 'server.js')

    if (fileExists(standaloneServer)) {
      return {
        command: process.execPath,
        args: [standaloneServer],
        options: {
          cwd: webDir,
          env: {
            ...process.env,
            HOSTNAME: '127.0.0.1',
            PORT: String(port),
            ELECTRON_RUN_AS_NODE: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      }
    }

    const nextBin = path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next')

    return {
      command: process.execPath,
      args: [nextBin, mode === 'production' ? 'start' : 'dev', '-p', String(port)],
      options: {
        cwd: webDir,
        env: {
          ...process.env,
          PORT: String(port),
          ELECTRON_RUN_AS_NODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    }
  }

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
  const staticRepoRoot = config.repoRoot ?? null
  const payloadDir = config.payloadDir ?? null
  function getRepoRoot() {
    if (staticRepoRoot) return staticRepoRoot
    return resolveRepoRoot(__dirname, payloadDir)
  }
  const logFile = config.logFile ?? getDefaultLogFile()
  const startTimeoutMs = config.startTimeoutMs ?? START_TIMEOUT_MS
  const stopTimeoutMs = config.stopTimeoutMs ?? STOP_TIMEOUT_MS
  const spawnFn = config.spawnFn ?? spawn
  const containerMode = config.containerMode === true
  const ensureContainerFn = config.ensureContainerFn ?? containerRuntime.ensureContainerRuntime
  const containerSpawnSpecFactory =
    config.containerSpawnSpecFactory ?? containerRuntime.buildDockerSpawnSpec
  const spawnSpecFactory =
    config.spawnSpecFactory ?? (containerMode ? containerSpawnSpecFactory : defaultSpawnSpecFactory)
  const isPortOpenFn = config.isPortOpenFn
  const probeHttpFn = config.probeHttpFn
  const httpGetFn = config.httpGetFn  // per test: (port, path) => { ok, status }
  const portFallbackSpan = config.portFallbackSpan ?? 10
  const containerStartTimeoutMs = config.containerStartTimeoutMs ?? 90000
  const healthTimeoutMs = config.healthTimeoutMs ?? HEALTH_TIMEOUT_MS
  const warmUpPaths = config.warmUpPaths ?? WARM_UP_PATHS
  const state = {
    child: null,
    mode: 'stopped',
    port: DEFAULT_PORT,
    runtimeKind: null,
    startedAt: null,
    lastError: null,
    lastExitCode: null,
    warmingProgress: null,  // { stage: 'health'|'warmup', done, total, currentPath? }
  }

  function getWebDir() {
    return path.join(getRepoRoot(), 'web')
  }

  function getUrl(port = state.port) {
    // Open /onboarding — the authenticated split-screen view where
    // the assistant greets the user and the profile form fills in
    // live. It's the real entry point for a fresh desktop user. We
    // used to open /dashboard but with Supabase env baked into the
    // web image the cloud auth layer intercepts unauthenticated
    // local requests and bounces them to /?login=true, which is not
    // where the desktop user should land.
    return `http://localhost:${port}/onboarding`
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

  // Fetch GET con timeout. Risolve { status, ok } o { error }.
  // Test-friendly: se config.httpGetFn è iniettato lo usiamo senza
  // passare da http.request (utile per i runtime.test.js che non hanno
  // un server reale in ascolto).
  function httpGet(port, targetPath, timeoutMs = 2000) {
    if (httpGetFn) return Promise.resolve(httpGetFn(port, targetPath))
    return new Promise((resolve) => {
      const request = http.request({
        host: '127.0.0.1',
        port,
        path: targetPath,
        method: 'GET',
        timeout: timeoutMs,
      }, (response) => {
        response.resume()
        resolve({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 400 })
      })
      request.on('timeout', () => { request.destroy(); resolve({ error: 'timeout' }) })
      request.on('error', (err) => resolve({ error: err.message }))
      request.end()
    })
  }

  // Polling su /api/health fino a 200 (o timeoutMs). A differenza di
  // waitForPort (TCP only), qui sappiamo davvero se l'app Next ha
  // finito il boot ed è in grado di servire API.
  async function waitForHealthy(port, timeoutMs = healthTimeoutMs) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const { ok } = await httpGet(port, '/api/health', 2500)
      if (ok) return true
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
    return false
  }

  // Pre-triggera la compile on-demand di Turbopack delle pagine chiave.
  // Fatto in parallelo (Promise.allSettled) per ridurre il time-to-open.
  // onProgress(done, total, pathCompleted) per UI feedback.
  async function warmUp(port, paths, onProgress) {
    let done = 0
    const total = paths.length
    const promises = paths.map(async (p) => {
      await httpGet(port, p, 15000)  // timeout generoso per first compile
      done += 1
      onProgress?.(done, total, p)
    })
    await Promise.race([
      Promise.allSettled(promises),
      new Promise((resolve) => setTimeout(resolve, WARM_UP_TIMEOUT_MS)),
    ])
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
      // `running` resta true anche durante 'warming' così la UI non torna
      // a "ferma" mentre Turbopack compila le prime pagine.
      running: ['running', 'starting', 'warming'].includes(state.mode),
      managed: !!state.child,
      port: state.port,
      url: getUrl(),
      runtimeKind: state.runtimeKind,
      startedAt: state.startedAt,
      lastError: state.lastError,
      lastExitCode: state.lastExitCode,
      warmingProgress: state.warmingProgress,
      logFile,
      containerMode,
      setup: containerMode ? null : inspectWebSetup(getRepoRoot()),
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

    let setup = null
    let mode = 'container'

    if (containerMode) {
      try {
        ensureContainerFn({ logger: (msg) => writeLogHeader(msg) })
      } catch (err) {
        state.mode = 'error'
        state.lastError = err instanceof Error ? err.message : String(err)
        return buildStatus()
      }
    } else {
      setup = inspectWebSetup(getRepoRoot())
      if (!setup.hasPackageJson && !setup.hasStandaloneServer) {
        state.mode = 'error'
        state.lastError = setup.issues[0] ?? `Directory web/ non trovata in ${setup.webDir}`
        return buildStatus()
      }

      if (!setup.hasNodeModules && !setup.hasProductionBuild) {
        state.mode = 'error'
        state.lastError = setup.issues[0] ?? 'Dipendenze web mancanti.'
        return buildStatus()
      }

      const requestedMode = options.preferredMode === 'production' || options.preferredMode === 'development'
        ? options.preferredMode
        : 'auto'
      const detectedMode = detectStartMode(setup.webDir)
      mode = requestedMode === 'auto' ? detectedMode : requestedMode

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
    }

    state.mode = 'starting'
    state.runtimeKind = mode
    state.startedAt = new Date().toISOString()
    state.lastError = null
    state.lastExitCode = null

    writeLogHeader(`Launching JHT web runtime in ${mode} mode on port ${state.port}`)

    const spec = spawnSpecFactory({
      mode,
      port: state.port,
      webDir: setup ? setup.webDir : null,
      repoRoot: getRepoRoot(),
    })
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

    const ready = await waitForPort(state.port, containerMode ? containerStartTimeoutMs : startTimeoutMs)
    if (!ready) {
      await stopRuntime()
      state.mode = 'error'
      state.lastError = `Timeout: localhost:${state.port} non ha risposto entro ${startTimeoutMs / 1000}s`
      return buildStatus()
    }

    // TCP open != dev server pronto. Aspetta che /api/health risponda
    // 200 (Next davvero vivo) e poi pre-triggera la compile on-demand
    // di Turbopack sulle pagine chiave. Senza questo warm-up l'utente
    // vedeva 404 transitori e le prime navigazioni bloccavano per 5-15s
    // mentre Turbopack compilava.
    state.mode = 'warming'
    state.warmingProgress = { stage: 'health', done: 0, total: warmUpPaths.length + 1 }

    const healthy = await waitForHealthy(state.port, healthTimeoutMs)
    if (!healthy) {
      await stopRuntime()
      state.mode = 'error'
      state.lastError = `Next non risponde su /api/health entro ${healthTimeoutMs / 1000}s (possibile cache Turbopack corrotta)`
      state.warmingProgress = null
      return buildStatus()
    }
    state.warmingProgress = { stage: 'warmup', done: 1, total: warmUpPaths.length + 1 }

    await warmUp(state.port, warmUpPaths, (done, total, currentPath) => {
      state.warmingProgress = {
        stage: 'warmup',
        done: 1 + done,
        total: 1 + total,
        currentPath,
      }
    })

    state.mode = 'running'
    state.warmingProgress = null
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

  function inspectFullSetup() {
    const base = inspectWebSetup(getRepoRoot())
    const deps = inspectDependencies()
    return {
      ...base,
      dependencies: deps.dependencies,
      allRequiredOk: deps.allRequiredOk,
    }
  }

  return {
    getLogFile: () => logFile,
    getRepoRoot,
    inspectSetup: inspectFullSetup,
    getStatus,
    startRuntime,
    stopRuntime,
  }
}

module.exports = {
  DEFAULT_PORT,
  START_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
  resolvePort,
  resolveRepoRoot,
  detectStartMode,
  inspectWebSetup,
  createRuntimeManager,
}
