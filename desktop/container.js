const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const log = require('./logger').child('container')

const DEFAULT_IMAGE = process.env.JHT_IMAGE || 'ghcr.io/leopu00/jht:latest'

function shouldUseContainer() {
  if (process.env.JHT_NO_DOCKER === '1') return false
  return true
}

function isDockerAvailable() {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

function colimaInstalled() {
  try {
    execFileSync('colima', ['version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

function colimaRunning() {
  try {
    execFileSync('colima', ['status'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

function startColima() {
  execFileSync('colima', ['start'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
  })
}

// Valid container-runtime preferences (macOS only — Windows is always Docker
// Desktop, Linux is always the native Engine). 'auto' = detect-first: reuse
// whatever Docker already responds, else prefer Colima (our default).
const RUNTIME_CHOICES = ['auto', 'colima', 'docker-desktop']
const DEFAULT_RUNTIME = 'auto'

// macOS: is Docker Desktop installed? It ships as /Applications/Docker.app.
// (Colima has no .app — its presence is the `colima` binary, see colimaInstalled.)
function dockerDesktopInstalled() {
  if (process.platform !== 'darwin') return false
  try {
    return fs.existsSync('/Applications/Docker.app')
  } catch {
    return false
  }
}

// macOS: launch the Docker Desktop GUI. `open -a` returns immediately; the
// daemon comes up a few seconds later, so callers must poll (waitForDocker).
// We never manage Docker Desktop beyond this nudge — it is the user's app.
function startDockerDesktop() {
  execFileSync('open', ['-a', 'Docker'], {
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 10000,
  })
}

// Synchronous sleep without spawning a process — keeps this module's
// imperative, execFileSync-based style. Used only while polling for the
// Docker Desktop daemon to warm up on macOS.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function waitForDocker(timeoutMs = 120000, pollMs = 2000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (isDockerAvailable()) return true
    sleepSync(pollMs)
  }
  return isDockerAvailable()
}

// Snapshot of what container runtimes exist / respond on this host. Cheap
// probes (a few execFileSync each); fed to decideRuntimeAction.
function detectRuntimeState(platform = process.platform) {
  return {
    platform,
    dockerResponds: isDockerAvailable(),
    colimaInstalled: platform === 'darwin' ? colimaInstalled() : false,
    dockerDesktopInstalled: platform === 'darwin' ? dockerDesktopInstalled() : false,
  }
}

// Pure decision: given the detected state and the user's choice, what should
// ensureContainerRuntime do? Kept side-effect-free so it is unit-testable.
//
// Detect-first wins everywhere: if a daemon already answers `docker`, use it
// regardless of the stored choice — never spin a second VM on top of a
// working one (the Colima-on-top-of-Docker-Desktop double-VM clash, ADR-0006).
function decideRuntimeAction(state, choice = DEFAULT_RUNTIME) {
  const { platform, dockerResponds, colimaInstalled: colima, dockerDesktopInstalled: desktop } = state

  if (dockerResponds) return { action: 'ok' }

  if (platform !== 'darwin') {
    // Linux: the Engine is a host-managed service. Windows desktop: the daemon
    // gets auto-launched on the CLI command path, not here. Either way: report.
    return { action: 'error-daemon-down' }
  }

  const want = choice === 'colima' || choice === 'docker-desktop' ? choice : 'auto'

  if (want === 'docker-desktop') {
    return desktop ? { action: 'start-docker-desktop' } : { action: 'error-install-docker-desktop' }
  }
  if (want === 'colima') {
    return colima ? { action: 'start-colima' } : { action: 'error-install-colima' }
  }
  // auto → prefer whatever is already installed (Colima first, our default),
  // else Docker Desktop, else there is nothing to start.
  if (colima) return { action: 'start-colima' }
  if (desktop) return { action: 'start-docker-desktop' }
  return { action: 'error-nothing-installed' }
}

// Ensure a container runtime is up before we `docker run`. Honors the user's
// macOS choice (Colima / Docker Desktop / auto); Linux & Windows unchanged.
function ensureContainerRuntime({ logger = () => {}, runtime = DEFAULT_RUNTIME } = {}) {
  const state = detectRuntimeState()
  log.info('ensure-runtime.start', {
    platform: state.platform,
    runtime,
    dockerResponds: state.dockerResponds,
  })
  const { action } = decideRuntimeAction(state, runtime)
  log.info('ensure-runtime.action', { action })

  switch (action) {
    case 'ok':
      // A daemon already serves docker — detect-first, nothing to start.
      return
    case 'start-colima': {
      logger('Avvio Colima (puo richiedere fino a un minuto)...')
      const t0 = Date.now()
      startColima()
      log.info('ensure-runtime.colima-started', { ms: Date.now() - t0 })
      logger('Colima avviato')
      break
    }
    case 'start-docker-desktop': {
      logger('Avvio Docker Desktop...')
      startDockerDesktop()
      if (!waitForDocker(120000)) {
        log.error('ensure-runtime.docker-desktop-timeout')
        throw new Error(
          'Docker Desktop avviato ma il daemon non risponde dopo 2 minuti. Aprilo a mano e riprova.',
        )
      }
      logger('Docker Desktop pronto')
      break
    }
    case 'error-install-docker-desktop':
      log.error('ensure-runtime.docker-desktop-missing')
      throw new Error(
        "Docker Desktop non e' installato. Scaricalo da https://www.docker.com/products/docker-desktop/ oppure passa a Colima.",
      )
    case 'error-install-colima':
      log.error('ensure-runtime.colima-missing')
      throw new Error(
        "Colima non e' installato. Esegui 'brew install colima docker' oppure passa a Docker Desktop.",
      )
    case 'error-nothing-installed':
      log.error('ensure-runtime.nothing-installed')
      throw new Error(
        "Nessun runtime container trovato. Installa Colima ('brew install colima docker') o Docker Desktop.",
      )
    case 'error-daemon-down':
    default:
      log.error('ensure-runtime.docker-unavailable')
      throw new Error(
        "Docker non risponde. Avvialo (Linux: 'systemctl start docker'; Windows: apri Docker Desktop).",
      )
  }

  // Final guard: whatever we started, the daemon must answer now.
  if (!isDockerAvailable()) {
    log.error('ensure-runtime.docker-unavailable-after-start')
    throw new Error("Docker non risponde dopo l'avvio del runtime. Verifica con 'docker info'.")
  }
}

function getHostPaths() {
  const home = os.homedir()
  const jhtHome = process.env.JHT_HOME_HOST || path.join(home, '.jht')
  const jhtUser =
    process.env.JHT_USER_DIR_HOST || path.join(home, 'Documents', 'Job Hunter Team')
  return { jhtHome, jhtUser }
}

function ensureHostPaths() {
  const { jhtHome, jhtUser } = getHostPaths()
  fs.mkdirSync(jhtHome, { recursive: true })
  fs.mkdirSync(jhtUser, { recursive: true })
  return { jhtHome, jhtUser }
}

const DEFAULT_CONTAINER_NAME = 'jht'

function buildDockerArgs({
  port,
  image = DEFAULT_IMAGE,
  cmd = ['dashboard', '--no-browser'],
  name = DEFAULT_CONTAINER_NAME,
}) {
  const { jhtHome, jhtUser } = ensureHostPaths()
  const args = [
    'run',
    // -d (detached): il container vive nel daemon Docker, NON come processo
    // figlio di Electron → sopravvive ai restart dell'app (il team non riparte
    // da zero ogni volta che si riapre il launcher). --rm lo rimuove quando si
    // ferma (Stop team / crash) → niente accumulo di container zombie.
    '-d',
    '--rm',
    '--name',
    name,
    '-v',
    `${jhtHome}:/jht_home`,
    '-v',
    `${jhtUser}:/jht_user`,
  ]

  // Dev overlay: if JHT_DEV_WEB_DIR points at an existing directory on
  // the host, bind-mount it over /app/web so the Next.js dev server
  // inside the container picks up live edits to the web/ source tree
  // (HMR works in ~1s instead of rebuilding the image). The anonymous
  // volume for node_modules keeps the container's linux-arm64 binaries
  // from being shadowed by the host's darwin-arm64 ones. Opt-in only.
  const devWebDir = process.env.JHT_DEV_WEB_DIR
  if (devWebDir && fs.existsSync(devWebDir)) {
    args.push('-v', `${devWebDir}:/app/web`)
    args.push('-v', '/app/web/node_modules')
  }

  // Dev overlay: if JHT_DEV_REPO_DIR points at the repo root on the host,
  // bind-mount .launcher/ and agents/ so edits to tmux boot scripts and
  // agent system prompts are picked up without rebuilding the image.
  // Temporary — remove once the image pipeline is locked for end-users.
  const devRepoDir = process.env.JHT_DEV_REPO_DIR
  if (devRepoDir && fs.existsSync(devRepoDir)) {
    const launcherDir = path.join(devRepoDir, '.launcher')
    const agentsDir = path.join(devRepoDir, 'agents')
    const cliDir = path.join(devRepoDir, 'cli')
    if (fs.existsSync(launcherDir)) args.push('-v', `${launcherDir}:/app/.launcher`)
    if (fs.existsSync(agentsDir)) args.push('-v', `${agentsDir}:/app/agents`)
    if (fs.existsSync(path.join(cliDir, 'bin', 'jht.js'))) {
      args.push('-v', `${cliDir}:/app/cli`)
      args.push('-v', '/app/cli/node_modules')
    }
  }

  args.push(
    '-e',
    'JHT_HOME=/jht_home',
    '-e',
    'JHT_USER_DIR=/jht_user',
    '-e',
    'IS_CONTAINER=1',
  )
  for (const key of [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'MOONSHOT_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ]) {
    if (process.env[key]) {
      args.push('-e', key)
    }
  }
  args.push('-p', `${port}:3000`)
  args.push(image)
  for (const a of cmd) {
    args.push(a)
  }
  return args
}

// True se un container con questo nome è in stato RUNNING. Usato dal runtime
// per adottare un container detached sopravvissuto a un restart dell'app
// (invece di rilanciarne uno nuovo) e per riportare lo stato corretto quando
// non c'è un child-process da tracciare. Best-effort: docker assente/daemon
// giù → false.
function isContainerRunning(name = DEFAULT_CONTAINER_NAME) {
  try {
    const out = execFileSync(
      'docker',
      ['ps', '--filter', `name=${name}`, '--format', '{{.Names}}'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    )
    return String(out)
      .split('\n')
      .map((s) => s.trim())
      .includes(name)
  } catch {
    return false
  }
}

function removeContainerIfExists(name = DEFAULT_CONTAINER_NAME) {
  try {
    execFileSync('docker', ['rm', '-f', name], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    })
    log.debug('container.removed', { name })
  } catch {
    // Container did not exist — nothing to clean up.
  }
}

function buildDockerSpawnSpec({ port, name = DEFAULT_CONTAINER_NAME }) {
  // Docker refuses `run --name jht` if another container is already
  // using that name (e.g., leftover from a crashed session). Clean up
  // any stale container with the same name before spawning.
  removeContainerIfExists(name)
  return {
    command: 'docker',
    args: buildDockerArgs({ port, name }),
    options: {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  }
}

module.exports = {
  DEFAULT_IMAGE,
  DEFAULT_CONTAINER_NAME,
  RUNTIME_CHOICES,
  DEFAULT_RUNTIME,
  shouldUseContainer,
  isDockerAvailable,
  colimaInstalled,
  colimaRunning,
  startColima,
  dockerDesktopInstalled,
  startDockerDesktop,
  waitForDocker,
  detectRuntimeState,
  decideRuntimeAction,
  ensureContainerRuntime,
  ensureHostPaths,
  buildDockerArgs,
  buildDockerSpawnSpec,
  removeContainerIfExists,
  isContainerRunning,
}
