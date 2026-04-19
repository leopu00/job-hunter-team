const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

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

function ensureContainerRuntime({ logger = () => {} } = {}) {
  if (process.platform === 'darwin') {
    if (!colimaInstalled()) {
      throw new Error(
        "Colima non e' installato. Esegui 'brew install colima docker' oppure rilancia con JHT_NO_DOCKER=1.",
      )
    }
    if (!colimaRunning()) {
      logger('Avvio Colima (puo richiedere fino a un minuto)...')
      startColima()
      logger('Colima avviato')
    }
  }
  if (!isDockerAvailable()) {
    throw new Error(
      "Docker non risponde. Verifica con 'docker info' (Linux) o 'colima status' (Mac).",
    )
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
    if (fs.existsSync(launcherDir)) args.push('-v', `${launcherDir}:/app/.launcher`)
    if (fs.existsSync(agentsDir)) args.push('-v', `${agentsDir}:/app/agents`)
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

function removeContainerIfExists(name = DEFAULT_CONTAINER_NAME) {
  try {
    execFileSync('docker', ['rm', '-f', name], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    })
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
  shouldUseContainer,
  isDockerAvailable,
  colimaInstalled,
  colimaRunning,
  ensureContainerRuntime,
  ensureHostPaths,
  buildDockerArgs,
  buildDockerSpawnSpec,
  removeContainerIfExists,
}
