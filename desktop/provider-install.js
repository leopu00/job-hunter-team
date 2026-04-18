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
    // Args appended to the binary when we open the "Login" terminal
    // from the wizard. Skipping the trust-dir dialog on first launch
    // saves the approval into the CLI's config, so the background
    // agent-boot later never has to deal with it.
    loginArgs: ['--dangerously-skip-permissions'],
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
    loginArgs: [],
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
    // --yolo at login time: the TUI writes its trust-approval for
    // the working dir into ~/.kimi so later launches skip it, and
    // the OAuth /login flow still runs normally.
    loginArgs: ['--yolo'],
    // Moonshot's official CLI is kimi-cli (github.com/MoonshotAI/kimi-cli) —
    // a Python uv tool, not an npm package. This is the real "Kimi Code"
    // TUI that supports /login OAuth (the subscription flow users pay
    // for on Moderato/Allegretto), not the @jacksontian API-key wrapper
    // we shipped originally. Kimi-cli requires Python 3.13; uv fetches
    // it automatically so the container (Debian bookworm 3.11) is fine.
    install: [
      // Remove the old @jacksontian/kimi-cli npm package if present
      // from a previous install. The sh -c swallows failures so a
      // fresh install that never had it doesn't error out.
      {
        entrypoint: 'sh',
        args: ['-c', 'npm uninstall -g @jacksontian/kimi-cli 2>/dev/null || true'],
        env: NPM_PREFIX_ENV,
      },
      // uv itself is a single static binary available on PyPI.
      // --break-system-packages is needed on Debian bookworm where
      // system pip refuses user-wide installs by default (PEP 668).
      {
        entrypoint: 'pip3',
        args: ['install', '--user', '--break-system-packages', 'uv'],
      },
      // uv tool install defaults to ~/.local/bin, but the container's
      // Dockerfile hardcodes /home/jht/.local/bin in PATH — different
      // from $HOME/.local/bin since HOME is overridden to /jht_home
      // at runtime. UV_TOOL_BIN_DIR pins the symlinks into
      // /jht_home/.npm-global/bin, which *is* on PATH and is already
      // the bind-mounted location where npm global binaries live.
      {
        entrypoint: 'sh',
        args: ['-c', 'export PATH="$HOME/.local/bin:$PATH" && UV_TOOL_BIN_DIR=/jht_home/.npm-global/bin uv tool install --python 3.13 kimi-cli'],
      },
    ],
    loginHint: 'inside TUI: /login',
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
  // lstatSync (not existsSync) so dead-from-the-host symlinks still
  // count as "present". Kimi's uv install uses an absolute symlink
  // pointing inside the container (/jht_home/.local/share/uv/…),
  // which the host sees as a broken link — but from inside the
  // container it resolves fine, and that's the only place the binary
  // ever actually runs.
  const exists = (p) => {
    try {
      fs.lstatSync(p)
      return true
    } catch {
      return false
    }
  }
  const installed = []
  for (const [id, meta] of Object.entries(PROVIDERS)) {
    const binary = meta.binary
    if (!binary) continue
    if (exists(path.join(binDir, binary)) || exists(path.join(binDir, `${binary}.cmd`))) {
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
