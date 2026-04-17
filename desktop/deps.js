// Setup wizard prerequisite checks beyond Docker.
// Docker is kept in docker-installer/ because it has a richer UX
// (download page, disk-space hint, process detection). The checks
// here are simpler: each returns ok/missing plus an i18n key for
// the hint. The renderer decides how to render.

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

async function runWithTimeout(cmd, args, timeoutMs = 4000) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: timeoutMs, windowsHide: true })
    return { ok: true, stdout: stdout || '', stderr: stderr || '', code: 0 }
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
      code: typeof error.code === 'number' ? error.code : 1,
    }
  }
}

// -------- WSL (Windows only) --------

async function inspectWsl(platform = process.platform, { run = runWithTimeout } = {}) {
  if (platform !== 'win32') return null

  // `wsl.exe --status` returns exit 0 when WSL is installed.
  // It also outputs in UTF-16LE so we don't parse the text — exit code is enough.
  const status = await run('wsl.exe', ['--status'], 4000)
  if (!status.ok) {
    return { id: 'wsl', required: true, ok: false, state: 'missing', hintKey: 'deps.wsl.hint.missing' }
  }

  // With WSL installed, verify at least one distro is registered.
  const list = await run('wsl.exe', ['-l', '-q'], 4000)
  // wsl outputs in UTF-16LE; stdout may look garbled but length>0 when distros exist.
  // Use a byte-level heuristic: non-empty stdout → at least one distro.
  const hasDistro = list.ok && list.stdout.replace(/[\u0000\s]/g, '').length > 0
  if (!hasDistro) {
    return { id: 'wsl', required: true, ok: false, state: 'no-distro', hintKey: 'deps.wsl.hint.noDistro' }
  }

  return { id: 'wsl', required: true, ok: true, state: 'ok', hintKey: 'deps.wsl.hint.ok' }
}

// -------- Aggregate --------
//
// The AI CLI (Claude Code / Codex / Kimi) runs inside the JHT container,
// so host PATH is not a meaningful check — the image bundles the CLI.
// User-level concerns are Docker, WSL on Windows, and later the provider
// credentials that the container consumes at runtime.

async function inspectExtraDeps({ platform = process.platform, run = runWithTimeout } = {}) {
  const deps = []
  const wsl = await inspectWsl(platform, { run })
  if (wsl) deps.push(wsl)
  const allRequiredOk = deps.every((d) => !d.required || d.ok)
  return { deps, allRequiredOk }
}

module.exports = {
  inspectWsl,
  inspectExtraDeps,
  _internal: { runWithTimeout },
}
