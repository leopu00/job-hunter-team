// Lazy install of the AI provider CLIs into the container.
//
// The base image intentionally does NOT ship any CLI to keep it small
// and respect the user's provider choice. When the setup wizard reaches
// the provider step, the selected CLIs are installed via
// `docker compose run --rm jht npm install -g <pkg>` (or a provider-specific
// command). Installs land in /jht_home/.npm-global (see Dockerfile
// NPM_CONFIG_PREFIX) which is bind-mounted to ~/.jht on the host, so they
// persist across container recreation.

const { spawn } = require('node:child_process')
const os = require('node:os')

// Provider registry: id → { displayName, binary, install command spec }.
// Each install step is { entrypoint, args, env? } — fed to
// `docker compose run --rm --no-deps --entrypoint <e> -e K=V ... <svc> <args>`.
// We always override the Dockerfile ENTRYPOINT because it points at the JHT
// CLI dispatcher, which would otherwise treat "npm" as an unknown subcommand.
// Package identifiers are best-effort; adjust as the CLI ecosystem moves.
const NPM_PREFIX_ENV = { NPM_CONFIG_PREFIX: '/jht_home/.npm-global' }

const PROVIDERS = {
  claude: {
    displayName: 'Claude Code',
    binary: 'claude',
    install: [{
      entrypoint: 'npm',
      args: ['install', '-g', '@anthropic-ai/claude-code@latest'],
      env: NPM_PREFIX_ENV,
    }],
    loginHint: 'claude login',
  },
  codex: {
    displayName: 'Codex',
    binary: 'codex',
    install: [{
      entrypoint: 'npm',
      args: ['install', '-g', '@openai/codex@latest'],
      env: NPM_PREFIX_ENV,
    }],
    loginHint: 'codex login',
  },
  kimi: {
    displayName: 'Kimi',
    binary: 'kimi',
    // Moonshot AI does not publish an official CLI on npm. The most
    // maintained third-party wrapper is @jacksontian/kimi-cli (by Hugo
    // Wang), which exposes a `kimi` binary compatible with Moonshot's
    // chat endpoint. Revisit if Moonshot ships an official package.
    install: [{
      entrypoint: 'npm',
      args: ['install', '-g', '@jacksontian/kimi-cli@latest'],
      env: NPM_PREFIX_ENV,
    }],
    loginHint: 'kimi login',
  },
}

const SUPPORTED_IDS = Object.keys(PROVIDERS)

function resolveHome() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}

function dockerEnv(extra = {}) {
  // `docker compose` substitutes ${HOME} in the compose file; on Windows
  // the variable is not present unless we inject it ourselves.
  const base = { ...process.env, HOME: resolveHome() }
  // macOS GUI apps start with a sanitized PATH that excludes Homebrew
  // prefixes, so `spawn('docker', ...)` throws ENOENT.
  if (process.platform === 'darwin') {
    const extraPath = ['/opt/homebrew/bin', '/usr/local/bin']
    base.PATH = [...extraPath, base.PATH || ''].filter(Boolean).join(':')
  }
  return { ...base, ...extra }
}

function runStreamed(cmd, args, { cwd, onLog = () => {}, env }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, env: env || dockerEnv(), windowsHide: true })
    } catch (error) {
      resolve({ ok: false, code: -1, error: error instanceof Error ? error.message : String(error) })
      return
    }

    const forward = (stream) => {
      stream.setEncoding('utf8')
      let buffer = ''
      stream.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) if (line.length > 0) onLog(line)
      })
      stream.on('end', () => {
        if (buffer.length > 0) onLog(buffer)
      })
    }
    forward(child.stdout)
    forward(child.stderr)

    child.on('error', (error) => {
      resolve({ ok: false, code: -1, error: error instanceof Error ? error.message : String(error) })
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: typeof code === 'number' ? code : -1 })
    })
  })
}

async function installProvider({
  providerId,
  payloadDir,
  service = 'jht',
  onLog = () => {},
  run = runStreamed,
} = {}) {
  const provider = PROVIDERS[providerId]
  if (!provider) return { ok: false, providerId, error: `unknown provider: ${providerId}` }
  if (!payloadDir) return { ok: false, providerId, error: 'payloadDir required' }

  for (const step of provider.install) {
    const composeArgs = ['compose', 'run', '--rm', '--no-deps', '--entrypoint', step.entrypoint]
    for (const [k, v] of Object.entries(step.env || {})) {
      composeArgs.push('-e', `${k}=${v}`)
    }
    composeArgs.push(service, ...step.args)
    onLog(`$ docker ${composeArgs.join(' ')}`)
    const result = await run('docker', composeArgs, { cwd: payloadDir, onLog })
    if (!result.ok) {
      return {
        ok: false,
        providerId,
        error: result.error || `install command exited with code ${result.code}`,
      }
    }
  }
  return { ok: true, providerId }
}

async function installProviders({
  providerIds,
  payloadDir,
  service = 'jht',
  onLog = () => {},
  run = runStreamed,
} = {}) {
  if (!Array.isArray(providerIds) || providerIds.length === 0) {
    return { ok: false, error: 'no providers selected' }
  }

  const results = []
  for (const providerId of providerIds) {
    onLog(`── Installing ${PROVIDERS[providerId]?.displayName || providerId} ──`)
    const res = await installProvider({ providerId, payloadDir, service, onLog, run })
    results.push(res)
    if (!res.ok) {
      return { ok: false, results, failedAt: providerId, error: res.error }
    }
  }
  return { ok: true, results }
}

// Probe the bind-mounted npm-global bin dir on the host to see which
// provider CLIs are already installed. No Docker call — we just check
// for the symlink that `npm install -g` creates.
function inspectInstalledProviders({ bindHomeDir } = {}) {
  const fs = require('node:fs')
  const path = require('node:path')
  const home = bindHomeDir || path.join(resolveHome(), '.jht')
  const binDir = path.join(home, '.npm-global', 'bin')
  const installed = []
  for (const [id, meta] of Object.entries(PROVIDERS)) {
    const binary = meta.binary
    if (!binary) continue
    if (
      fs.existsSync(path.join(binDir, binary)) ||
      fs.existsSync(path.join(binDir, `${binary}.cmd`))
    ) {
      installed.push(id)
    }
  }
  return { bindHomeDir: home, installed }
}

module.exports = {
  PROVIDERS,
  SUPPORTED_IDS,
  installProvider,
  installProviders,
  inspectInstalledProviders,
  resolveHome,
  dockerEnv,
  _internal: { runStreamed },
}
