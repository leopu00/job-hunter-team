const { execFileSync } = require('node:child_process')

const INSTALL_DOCS = {
  docker: 'https://docs.docker.com/get-docker/',
  node: 'https://nodejs.org/en/download',
  git: 'https://git-scm.com/downloads',
  python: 'https://www.python.org/downloads/',
}

const NODE_MIN = { major: 20, minor: 0, patch: 0, raw: '20.0.0' }
const PYTHON_MIN = { major: 3, minor: 10, patch: 0, raw: '3.10.0' }

function defaultRunCli(command, args, { timeout = 3000 } = {}) {
  try {
    const out = execFileSync(command, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
      encoding: 'utf8',
      windowsHide: true,
    })
    return typeof out === 'string' ? out.trim() : ''
  } catch {
    return null
  }
}

function parseVersion(str) {
  if (str == null) return null
  const match = String(str).match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    raw: match[0],
  }
}

function versionAtLeast(actual, min) {
  if (!actual) return false
  if (!min) return true
  if (actual.major !== min.major) return actual.major > min.major
  if (actual.minor !== min.minor) return actual.minor > min.minor
  return actual.patch >= min.patch
}

function hintForPlatform(platform, { win, mac, linux }) {
  if (platform === 'win32') return `Su Windows: ${win}`
  if (platform === 'darwin') return `Su macOS: ${mac}`
  return `Su Linux: ${linux}`
}

function inspectDocker({ runCli = defaultRunCli, platform = process.platform } = {}) {
  const versionStr = runCli('docker', ['--version'])
  const installed = versionStr != null
  const version = parseVersion(versionStr)
  const ok = installed
  return {
    name: 'Docker',
    required: true,
    installed,
    version: version?.raw ?? null,
    minVersion: null,
    ok,
    hint: ok
      ? null
      : hintForPlatform(platform, {
          win: 'winget install Docker.DockerDesktop',
          mac: 'brew install colima docker',
          linux: 'usa il gestore di pacchetti (es. apt install docker.io)',
        }),
    installUrl: INSTALL_DOCS.docker,
  }
}

function inspectNode({ runCli = defaultRunCli, platform = process.platform } = {}) {
  const versionStr = runCli('node', ['--version'])
  const installed = versionStr != null
  const version = parseVersion(versionStr)
  const ok = installed && versionAtLeast(version, NODE_MIN)
  let hint = null
  if (!installed) {
    hint = hintForPlatform(platform, {
      win: 'winget install OpenJS.NodeJS.LTS',
      mac: 'brew install node',
      linux: 'installa nodejs (es. apt install nodejs) o usa nvm',
    })
  } else if (!ok) {
    hint = `Versione rilevata ${version?.raw ?? versionStr}. Serve Node.js ${NODE_MIN.raw} o superiore.`
  }
  return {
    name: 'Node.js',
    required: true,
    installed,
    version: version?.raw ?? null,
    minVersion: NODE_MIN.raw,
    ok,
    hint,
    installUrl: INSTALL_DOCS.node,
  }
}

function inspectGit({ runCli = defaultRunCli, platform = process.platform } = {}) {
  const versionStr = runCli('git', ['--version'])
  const installed = versionStr != null
  const version = parseVersion(versionStr)
  const ok = installed
  return {
    name: 'Git',
    required: true,
    installed,
    version: version?.raw ?? null,
    minVersion: null,
    ok,
    hint: ok
      ? null
      : hintForPlatform(platform, {
          win: 'winget install Git.Git',
          mac: 'brew install git (oppure installa gli Xcode Command Line Tools)',
          linux: 'installa git (es. apt install git)',
        }),
    installUrl: INSTALL_DOCS.git,
  }
}

function inspectPython({ runCli = defaultRunCli, platform = process.platform } = {}) {
  let versionStr = runCli('python3', ['--version'])
  if (versionStr == null) {
    versionStr = runCli('python', ['--version'])
  }
  const installed = versionStr != null
  const version = parseVersion(versionStr)
  const ok = !installed ? true : versionAtLeast(version, PYTHON_MIN)
  let hint = null
  if (!installed) {
    hint = 'Opzionale. Alcuni script del payload possono richiedere Python 3.10+.'
  } else if (!ok) {
    hint = `Versione rilevata ${version?.raw ?? versionStr}. Per gli script opzionali serve Python ${PYTHON_MIN.raw} o superiore.`
  }
  return {
    name: 'Python',
    required: false,
    installed,
    version: version?.raw ?? null,
    minVersion: PYTHON_MIN.raw,
    ok,
    hint,
    installUrl: INSTALL_DOCS.python,
  }
}

function inspectDependencies(options = {}) {
  const dependencies = [
    inspectDocker(options),
    inspectNode(options),
    inspectGit(options),
    inspectPython(options),
  ]
  const allRequiredOk = dependencies.every((dep) => !dep.required || dep.ok)
  return { dependencies, allRequiredOk }
}

module.exports = {
  INSTALL_DOCS,
  NODE_MIN,
  PYTHON_MIN,
  parseVersion,
  versionAtLeast,
  inspectDocker,
  inspectNode,
  inspectGit,
  inspectPython,
  inspectDependencies,
}
