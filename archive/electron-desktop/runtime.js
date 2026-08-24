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
// Windows + Docker Desktop WSL2 bind-mount NTFS→ext4 è molto lento al
// cold-compile, serve una finestra larga prima di dichiarare fallito.
const HEALTH_TIMEOUT_MS = process.platform === 'win32' ? 180000 : 30000
// Warm-up: triggeriamo la compilazione on-demand di Turbopack sulle
// pagine che l'utente apre per prime. Così quando il browser arriva,
// non aspetta 5-15s di compile alla prima navigazione.
const WARM_UP_TIMEOUT_MS = 45000
const WARM_UP_PATHS = ['/dashboard', '/team', '/capitano']

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
  // Read fresh at each start so a runtime switch (Colima ⇄ Docker Desktop)
  // from settings takes effect on the next Start without an app restart.
  const getContainerRuntimeChoice =
    config.getContainerRuntimeChoice ?? (() => containerRuntime.DEFAULT_RUNTIME)
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
    // Container detached (docker run -d): non c'è un child-process del team da
    // tracciare (vive nel daemon). `detached` = "possediamo un container
    // detached avviato/adottato, controllabile via docker stop". `logChild` =
    // il `docker logs -f` opzionale che riversa i log nel file (osservabilità).
    detached: false,
    logChild: null,
  }

  function getWebDir() {
    return path.join(getRepoRoot(), 'web')
  }

  function getUrl(port = state.port) {
    // [JHT-ONBOARDING-IN-GAME 18/07] Entry point /dashboard: la pagina
    // web /onboarding non esiste più (l'onboarding vive nel wizard del
    // videogioco, game/scenes/wizard.tscn). Il vecchio bounce auth che
    // motivava l'ingresso da /onboarding non scatta: le richieste locali
    // del container bypassano il web-login (localContext nel protected
    // layout / middleware).
    return `http://localhost:${port}/dashboard`
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

  // Polling sulla root `/` fino a una risposta 2xx/3xx (o timeoutMs). A
  // differenza di waitForPort (TCP only), qui sappiamo davvero se l'app Next
  // ha finito il boot ed è in grado di servire.
  //
  // [runtime-fix] Prima si pollava `/api/health`, ma quella route NON esiste
  // nell'immagine (Next risponde 404) → waitForHealthy non diventava MAI
  // healthy → timeout → stopRuntime rimuove il container → mode 'error', il
  // team restava bloccato su 'Starting' e l'embed (gateato su 'running') non
  // compariva mai. La dashboard però serviva: `/` è 200. Pollando `/` il
  // warm-up converge e il runtime raggiunge 'running'.
  async function waitForHealthy(port, timeoutMs = healthTimeoutMs) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const { ok } = await httpGet(port, '/', 2500)
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
      // managed = "lo Stop dell'app può fermarlo". Vero col child foreground
      // (dev) E con un container detached che possediamo (docker stop).
      managed: !!state.child || state.detached,
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

  // Con `docker run -d` il processo di lancio esce subito: per continuare a
  // vedere i log del container apriamo `docker logs -f` e li riversiamo nel
  // file (come faceva bindLogs sul child foreground). Best-effort.
  function startContainerLogStream() {
    stopContainerLogStream()
    try {
      const lc = spawnFn(
        'docker',
        ['logs', '-f', '--tail', '20', containerRuntime.DEFAULT_CONTAINER_NAME],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      lc.stdout?.on('data', (chunk) => appendLog(chunk))
      lc.stderr?.on('data', (chunk) => appendLog(chunk))
      lc.on('error', () => {})
      state.logChild = lc
    } catch {
      // docker logs non disponibile — i log restano comunque nel daemon.
    }
  }

  function stopContainerLogStream() {
    if (state.logChild) {
      try { state.logChild.kill() } catch { /* già morto */ }
      state.logChild = null
    }
  }

  function resetState(mode = 'stopped') {
    state.child = null
    state.mode = mode
    state.runtimeKind = null
    state.detached = false
  }

  async function getStatus() {
    if (!state.child) {
      // Container detached: il team può girare senza un child-process tracciato
      // (es. sopravvissuto a un restart dell'app). Riconoscilo via `docker ps`
      // così la home mostra "running/managed" invece di "stopped". Lo Stop poi
      // funziona via removeContainerIfExists (docker rm -f).
      if (containerMode && containerRuntime.isContainerRunning()) {
        const inspection = await inspectPort(state.port)
        state.detached = true
        if (state.runtimeKind == null) state.runtimeKind = 'container'
        // Se non c'è ancora un log-stream attivo (riavvio app), riaprilo.
        if (!state.logChild) startContainerLogStream()
        return buildStatus({
          mode: inspection.state === 'reachable' ? 'running' : 'starting',
          running: true,
          managed: true,
          note: 'detached-container',
        })
      }
      state.detached = false
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

    // Container detached già su (sopravvissuto a un restart dell'app): adottalo
    // come MANAGED invece di rilanciarne uno nuovo. È la vincita principale del
    // modello detached — riapri il launcher e il team è già lì, niente
    // ri-spawn né token bruciati. (Va PRIMA del check porta: il container
    // potrebbe essere up ma la porta non ancora reachable durante il warm-up.)
    if (containerMode && containerRuntime.isContainerRunning()) {
      state.detached = true
      state.runtimeKind = 'container'
      state.startedAt = state.startedAt || new Date().toISOString()
      startContainerLogStream()
      const reachable = await waitForPort(preferredPort, containerStartTimeoutMs)
      if (reachable) await waitForHealthy(preferredPort, healthTimeoutMs)
      state.mode = 'running'
      return buildStatus({ note: 'adopted-running-container', running: true, managed: true })
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
        ensureContainerFn({
          logger: (msg) => writeLogHeader(msg),
          runtime: getContainerRuntimeChoice(),
        })
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
    bindLogs(child)

    if (containerMode) {
      // `docker run -d`: il processo di lancio stampa l'ID e ESCE subito (0 =
      // container avviato nel daemon). NON è il processo del team — quindi non
      // lo teniamo come state.child (sopravvive ai restart dell'app). Aspetta
      // solo il suo exit per sapere se il lancio è riuscito.
      const launchCode = await new Promise((resolve) => {
        child.once('exit', (code) => resolve(typeof code === 'number' ? code : -1))
        child.once('error', () => resolve(-1))
      })
      if (launchCode !== 0) {
        state.mode = 'error'
        state.lastError = `docker run -d terminato con exit code ${launchCode}`
        try { containerRuntime.removeContainerIfExists() } catch { /* best-effort */ }
        return buildStatus()
      }
      state.child = null
      state.detached = true
      startContainerLogStream()
    } else {
      // Dev/non-container: processo Next foreground, figlio dell'app. Semantica
      // invariata — l'exit del child = runtime fermo.
      state.child = child
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
    }

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
      state.lastError = `Next non risponde su / entro ${healthTimeoutMs / 1000}s (possibile cache Turbopack corrotta)`
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
    // Spegni sempre lo stream `docker logs -f` locale (cosmetico).
    stopContainerLogStream()
    // Fallback robusto: anche quando state.child e' null (container detached, o
    // Electron riavviato / bind col processo docker perso) ci assicuriamo
    // sempre che il container `jht` sia rimosso (docker rm -f). E' anche il
    // path dello Stop esplicito di un container detached. Prima questo early
    // return lasciava il container orfano e "Stop team" non faceva nulla.
    if (!state.child) {
      if (containerMode) {
        try {
          containerRuntime.removeContainerIfExists()
        } catch {
          // ignore — container potrebbe non esistere, ok
        }
      }
      state.detached = false
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

    // Belt-and-suspenders: rimuove il container anche se il child handle
    // e' morto senza portarsi dietro il container (es. Docker Desktop
    // daemon lo ha tenuto in vita). --rm di solito basta, ma abbiamo
    // visto casi di container orfani (Electron restart nel mezzo).
    if (containerMode) {
      try {
        containerRuntime.removeContainerIfExists()
      } catch {
        // ignore
      }
    }

    resetState('stopped')
    return buildStatus()
  }

  // Chiamata da app.before-quit. Container detached: LASCIALO VIVERE oltre la
  // chiusura del launcher (è il punto del modello -d: riaprendo l'app il team
  // è già su). Spegni solo lo stream log locale. Dev/non-container: stoppa come
  // prima (è un processo figlio dell'app, morirebbe comunque). Lo Stop
  // ESPLICITO dell'utente passa invece da stopRuntime (launcher:stop) e ferma
  // davvero il container.
  function shutdownForQuit() {
    if (containerMode) {
      stopContainerLogStream()
      return buildStatus()
    }
    return stopRuntime()
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
    shutdownForQuit,
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
