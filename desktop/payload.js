const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const DEFAULT_REPO_URL = 'https://github.com/leopu00/job-hunter-team.git'
const DEFAULT_BRANCH = 'master'
const CLONE_TIMEOUT_MS = 10 * 60 * 1000
const CONFIG_TIMEOUT_MS = 60 * 1000

const SPARSE_PATHS = [
  'web',
  'cli',
  'tui',
  'shared',
  'scripts',
  'supabase',
  'docker-compose.yml',
  'Dockerfile',
  'package.json',
  'package-lock.json',
  'requirements.txt',
  '.env.example',
]

function isPayloadPresent(payloadDir) {
  if (!payloadDir) return false
  const webDir = path.join(payloadDir, 'web')
  return (
    fs.existsSync(path.join(webDir, 'package.json'))
    || fs.existsSync(path.join(webDir, 'server.js'))
  )
}

function isGitRepo(payloadDir) {
  if (!payloadDir) return false
  return fs.existsSync(path.join(payloadDir, '.git'))
}

async function defaultRunGit(args, { cwd, timeout = CLONE_TIMEOUT_MS } = {}) {
  return execFileAsync('git', args, { cwd, timeout, windowsHide: true })
}

async function clonePayload({
  payloadDir,
  repoUrl = DEFAULT_REPO_URL,
  branch = DEFAULT_BRANCH,
  sparsePaths = SPARSE_PATHS,
  runGit = defaultRunGit,
  logger = () => {},
} = {}) {
  if (!payloadDir) throw new Error('payloadDir richiesto')
  const parent = path.dirname(payloadDir)
  fs.mkdirSync(parent, { recursive: true })
  if (fs.existsSync(payloadDir)) {
    fs.rmSync(payloadDir, { recursive: true, force: true })
  }
  logger(`Clono payload da ${repoUrl} (ramo ${branch})…`)
  await runGit(
    [
      'clone',
      '--depth=1',
      '--filter=blob:none',
      '--sparse',
      '--branch', branch,
      repoUrl,
      payloadDir,
    ],
    { timeout: CLONE_TIMEOUT_MS },
  )
  logger('Configuro sparse-checkout…')
  // Non-cone mode is required because SPARSE_PATHS mixes directories
  // ("web", "cli", …) with files ("docker-compose.yml", "Dockerfile",
  // ".env.example"). Cone mode (git ≥ 2.37 default) rejects file paths.
  await runGit(['sparse-checkout', 'init', '--no-cone'], {
    cwd: payloadDir,
    timeout: CONFIG_TIMEOUT_MS,
  })
  await runGit(['sparse-checkout', 'set', ...sparsePaths], {
    cwd: payloadDir,
    timeout: CONFIG_TIMEOUT_MS,
  })
  logger('Payload scaricato.')
  return { action: 'cloned' }
}

async function updatePayload({
  payloadDir,
  branch = DEFAULT_BRANCH,
  runGit = defaultRunGit,
  logger = () => {},
} = {}) {
  if (!isGitRepo(payloadDir)) {
    throw new Error('Payload non e\u0300 un repo git valido: serve un clone completo.')
  }
  logger('Aggiorno payload (git fetch)…')
  await runGit(['fetch', '--depth=1', 'origin', branch], {
    cwd: payloadDir,
    timeout: CLONE_TIMEOUT_MS,
  })
  await runGit(['reset', '--hard', `origin/${branch}`], {
    cwd: payloadDir,
    timeout: CONFIG_TIMEOUT_MS,
  })
  logger('Payload aggiornato.')
  return { action: 'updated' }
}

async function ensurePayload(options = {}) {
  const { payloadDir, updateIfPresent = false, logger = () => {} } = options
  if (!payloadDir) throw new Error('payloadDir richiesto')

  if (!isPayloadPresent(payloadDir)) {
    const cloned = await clonePayload(options)
    return { payloadDir, ...cloned }
  }

  if (updateIfPresent && isGitRepo(payloadDir)) {
    try {
      const updated = await updatePayload(options)
      return { payloadDir, ...updated }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger(`Aggiornamento non riuscito: ${message}. Uso la copia esistente.`)
      return { payloadDir, action: 'kept', warning: message }
    }
  }

  return { payloadDir, action: 'present' }
}

module.exports = {
  DEFAULT_REPO_URL,
  DEFAULT_BRANCH,
  SPARSE_PATHS,
  isPayloadPresent,
  isGitRepo,
  clonePayload,
  updatePayload,
  ensurePayload,
}
