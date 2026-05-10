const fs = require('node:fs')
const https = require('node:https')
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

// Windows fresh installs don't ship git — so "git clone" throws ENOENT
// before the wizard can do anything useful. Tarball download via
// HTTPS + `tar -xzf` (tar.exe is built-in on Windows 10+) sidesteps the
// dependency entirely. We still prefer git when available because it
// makes `updatePayload` a cheap fetch, but we transparently fall back
// if git isn't on PATH.
async function isGitAvailable({ run = execFileAsync } = {}) {
  try {
    await run('git', ['--version'], { timeout: 3000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

// Convert a GitHub clone URL to the codeload tarball URL for a branch.
// Handles both `https://github.com/u/r.git` and `git@github.com:u/r.git`.
function deriveTarballUrl(repoUrl, branch) {
  const m = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(repoUrl)
  if (!m) throw new Error(`Cannot derive tarball URL from repo: ${repoUrl}`)
  const [, owner, repo] = m
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${branch}`
}

function defaultHttpsDownload(url, destPath, { timeoutMs = CLONE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl, redirectsLeft) => {
      const req = https.get(currentUrl, (res) => {
        const { statusCode, headers } = res
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume()
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects for ${url}`))
            return
          }
          follow(new URL(headers.location, currentUrl).toString(), redirectsLeft - 1)
          return
        }
        if (statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${statusCode} for ${currentUrl}`))
          return
        }
        const out = fs.createWriteStream(destPath)
        res.pipe(out)
        out.on('finish', () => out.close(() => resolve()))
        out.on('error', (err) => {
          try { fs.unlinkSync(destPath) } catch { /* ignore */ }
          reject(err)
        })
      })
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('download timeout'))
      })
      req.on('error', reject)
    }
    follow(url, 5)
  })
}

async function defaultExtractTarball(tarballPath, destDir, { timeoutMs = CLONE_TIMEOUT_MS } = {}) {
  // --strip-components=1 drops the GitHub-added "repo-branch/" prefix so
  // the payload tree mounts directly under destDir (parity with git clone).
  await execFileAsync(
    'tar',
    ['-xzf', tarballPath, '-C', destDir, '--strip-components=1'],
    { timeout: timeoutMs, windowsHide: true },
  )
}

async function clonePayloadTarball({
  payloadDir,
  repoUrl = DEFAULT_REPO_URL,
  branch = DEFAULT_BRANCH,
  httpsDownload = defaultHttpsDownload,
  extractTarball = defaultExtractTarball,
  logger = () => {},
} = {}) {
  if (!payloadDir) throw new Error('payloadDir richiesto')
  const parent = path.dirname(payloadDir)
  fs.mkdirSync(parent, { recursive: true })
  if (fs.existsSync(payloadDir)) {
    fs.rmSync(payloadDir, { recursive: true, force: true })
  }
  fs.mkdirSync(payloadDir, { recursive: true })

  const tarUrl = deriveTarballUrl(repoUrl, branch)
  const tarballPath = path.join(parent, `.payload-tarball-${Date.now()}.tgz`)
  logger(`Scarico payload da ${tarUrl}…`)
  try {
    await httpsDownload(tarUrl, tarballPath)
    logger('Estraggo archivio…')
    await extractTarball(tarballPath, payloadDir)
    logger('Payload scaricato.')
  } finally {
    try { fs.unlinkSync(tarballPath) } catch { /* best effort */ }
  }
  return { action: 'cloned', source: 'tarball' }
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
  const {
    payloadDir,
    updateIfPresent = false,
    logger = () => {},
    checkGitAvailable = isGitAvailable,
  } = options
  if (!payloadDir) throw new Error('payloadDir richiesto')

  if (!isPayloadPresent(payloadDir)) {
    // Prefer git when available (cheaper subsequent updates via sparse
    // fetch); fall back to tarball so Windows users without git can
    // still bootstrap the payload.
    const gitOk = await checkGitAvailable()
    if (gitOk) {
      const cloned = await clonePayload(options)
      return { payloadDir, ...cloned }
    }
    logger('git non trovato: uso tarball HTTPS…')
    const cloned = await clonePayloadTarball(options)
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
  clonePayloadTarball,
  updatePayload,
  ensurePayload,
  isGitAvailable,
  deriveTarballUrl,
  _internal: { defaultHttpsDownload, defaultExtractTarball },
}
