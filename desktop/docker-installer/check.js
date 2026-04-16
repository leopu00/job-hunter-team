// Three-state check for Docker availability:
//
//   ok           → `docker ps` returns exit 0 → the user can start JHT.
//   needs-reboot → `docker` binary exists but `docker ps` fails → the user
//                  installed Docker but hasn't rebooted (Windows) or
//                  started the daemon (Mac/Linux).
//   missing      → `docker` binary not on PATH → not installed at all.
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

// Build a friendly hint telling the user exactly what to do next,
// kept as a single short sentence because it is shown inline in the checklist.
function hintForState(state, platform = process.platform) {
  if (state === 'ok') return 'Pronto.'
  if (state === 'missing') {
    if (platform === 'win32') return 'Scarica e installa Docker Desktop dal sito ufficiale.'
    if (platform === 'darwin') return 'Installa Docker Desktop dal sito ufficiale.'
    return 'Installa Docker Engine seguendo la guida ufficiale.'
  }
  if (state === 'needs-reboot') {
    if (platform === 'win32') return 'Docker è installato. Riavvia il computer per attivarlo.'
    if (platform === 'darwin') return 'Docker è installato. Apri Docker una volta per avviare il runtime.'
    return 'Docker è installato. Avvia il daemon (systemctl start docker) o riavvia.'
  }
  return ''
}

async function checkDocker() {
  const installed = await isDockerBinaryPresent()
  if (!installed) {
    return { state: 'missing', installed: false, responsive: false, hint: hintForState('missing') }
  }
  const responsive = await doesDockerRespond()
  if (responsive) {
    return { state: 'ok', installed: true, responsive: true, hint: hintForState('ok') }
  }
  return {
    state: 'needs-reboot',
    installed: true,
    responsive: false,
    hint: hintForState('needs-reboot'),
  }
}

module.exports = {
  checkDocker,
  hintForState,
  // exported for tests that want to stub them
  _internal: { isDockerBinaryPresent, doesDockerRespond, runWithTimeout },
}
