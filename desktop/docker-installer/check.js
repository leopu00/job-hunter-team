// Multi-state check for Docker availability:
//
//   ok            → `docker ps` returns exit 0 → the user can start JHT.
//   starting      → Windows/Mac: Docker Desktop process is running but the
//                   daemon pipe isn't ready yet. User should just wait and retry.
//   not-running   → Windows/Mac: `docker` CLI is on PATH but Docker Desktop
//                   is NOT running. User needs to open Docker Desktop.
//   needs-reboot  → Linux: `docker` CLI is on PATH but the daemon is down.
//                   User should start the daemon or reboot.
//   missing       → `docker` binary not on PATH → not installed at all.
//
// The UI maps each state to a distinct message and action.

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

async function runWithTimeout(cmd, args, timeoutMs = 5000) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: timeoutMs })
    return { ok: true, stdout, stderr, code: 0 }
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
      code: typeof error.code === 'number' ? error.code : 1,
    }
  }
}

async function isDockerBinaryPresent() {
  const locatorCmd = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = await runWithTimeout(locatorCmd, ['docker'], 3000)
  return result.ok && result.stdout.trim().length > 0
}

async function doesDockerRespond() {
  const result = await runWithTimeout('docker', ['ps', '--format', '{{.ID}}'], 6000)
  return result.ok
}

// Windows/Mac only: is the Docker/Colima runtime up?
//   - Windows: is the Docker Desktop GUI process running?
//   - Mac: does `colima status` exit 0? (Colima has no GUI; the daemon
//     state is the only signal. A running Colima with an unresponsive
//     docker CLI means the VM is still warming up → "starting".)
// On Linux there is no "Desktop" app — the daemon runs as a service.
async function isDockerDesktopRunning(platform = process.platform) {
  if (platform === 'win32') {
    const result = await runWithTimeout(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq Docker Desktop.exe', '/NH'],
      3000,
    )
    if (!result.ok) return false
    return /Docker Desktop\.exe/i.test(result.stdout)
  }
  if (platform === 'darwin') {
    const result = await runWithTimeout('colima', ['status'], 3000)
    return result.ok
  }
  return null
}

// Return a translation key for the hint instead of localized text —
// the renderer resolves it via its i18n dictionary so the language
// matches the user's pick.
function hintKeyForState(state, platform = process.platform) {
  if (state === 'ok') return 'docker.hint.ok'
  if (state === 'missing') {
    if (platform === 'win32') return 'docker.hint.missing.win32'
    if (platform === 'darwin') return 'docker.hint.missing.darwin'
    return 'docker.hint.missing.linux'
  }
  if (state === 'not-running') {
    if (platform === 'win32') return 'docker.hint.notRunning.win32'
    if (platform === 'darwin') return 'docker.hint.notRunning.darwin'
    return 'docker.hint.notRunning.win32'
  }
  if (state === 'starting') {
    return 'docker.hint.starting'
  }
  if (state === 'needs-reboot') {
    if (platform === 'win32') return 'docker.hint.needsReboot.win32'
    if (platform === 'darwin') return 'docker.hint.needsReboot.darwin'
    return 'docker.hint.needsReboot.linux'
  }
  return ''
}

async function checkDocker() {
  const platform = process.platform
  const installed = await isDockerBinaryPresent()
  if (!installed) {
    return { state: 'missing', installed: false, responsive: false, hintKey: hintKeyForState('missing', platform) }
  }
  const responsive = await doesDockerRespond()
  if (responsive) {
    return { state: 'ok', installed: true, responsive: true, hintKey: hintKeyForState('ok', platform) }
  }

  // CLI present but daemon unreachable. On Windows/Mac, distinguish
  // "Docker Desktop not running" from "Docker Desktop is starting".
  if (platform === 'win32' || platform === 'darwin') {
    const desktopRunning = await isDockerDesktopRunning(platform)
    const state = desktopRunning ? 'starting' : 'not-running'
    return { state, installed: true, responsive: false, hintKey: hintKeyForState(state, platform) }
  }

  return {
    state: 'needs-reboot',
    installed: true,
    responsive: false,
    hintKey: hintKeyForState('needs-reboot', platform),
  }
}

module.exports = {
  checkDocker,
  hintKeyForState,
  isDockerDesktopRunning,
  // exported for tests that want to stub them
  _internal: { isDockerBinaryPresent, doesDockerRespond, runWithTimeout, isDockerDesktopRunning },
}
