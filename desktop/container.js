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

function buildDockerArgs({ port, image = DEFAULT_IMAGE }) {
  const { jhtHome, jhtUser } = ensureHostPaths()
  const args = [
    'run',
    '--rm',
    '-v',
    `${jhtHome}:/jht_home`,
    '-v',
    `${jhtUser}:/jht_user`,
    '-e',
    'JHT_HOME=/jht_home',
    '-e',
    'JHT_USER_DIR=/jht_user',
    '-e',
    'IS_CONTAINER=1',
  ]
  for (const key of [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'MOONSHOT_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'GEMINI_API_KEY',
  ]) {
    if (process.env[key]) {
      args.push('-e', key)
    }
  }
  args.push('-p', `${port}:3000`)
  args.push(image)
  return args
}

function buildDockerSpawnSpec({ port }) {
  return {
    command: 'docker',
    args: buildDockerArgs({ port }),
    options: {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  }
}

module.exports = {
  DEFAULT_IMAGE,
  shouldUseContainer,
  isDockerAvailable,
  colimaInstalled,
  colimaRunning,
  ensureContainerRuntime,
  ensureHostPaths,
  buildDockerArgs,
  buildDockerSpawnSpec,
}
