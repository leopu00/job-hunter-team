// VPS orchestrator for the launcher main process.
//
// Generates an Ed25519 SSH keypair stored under
// `app.getPath('userData')/ssh/` and (in task 13) shells out to
// `ssh -i <priv> root@<ip> 'curl install.sh | bash -s -- --pairing-token <token>'`
// to bootstrap a freshly created Hetzner VPS.
//
// Why one keypair per user (not per VPS): decisione lockata
// 2026-05-13 #2 — un solo team JHT per utente alla volta, multi-VPS
// contemporanea non supportata. N=1 → una sola chiave basta.
//
// Why ssh-keygen via child_process (vs node:crypto):
//   - ssh-keygen produces OpenSSH-format files that `ssh` already
//     consumes natively (right permissions, right magic header).
//   - generating Ed25519 with crypto.generateKeyPair and converting
//     to OpenSSH wire format is fiddly and provides no benefit.
//   - ssh-keygen ships with Windows 10+, macOS, every Linux — same
//     binary the user would use manually.

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { app } = require('electron')
const auth = require('../auth')
const log = require('../logger').child('vps')

const INSTALL_URL = 'https://jobhunterteam.ai/install.sh'
// Validated again on the renderer side; double-check before shelling out
// because the IP ends up inside an ssh argv that we don't quote a second
// time.
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/

const KEY_FILENAME = 'jht_ed25519'
const KEY_COMMENT = 'jht-desktop'

function getSshDir() {
  return path.join(app.getPath('userData'), 'ssh')
}

function getPrivateKeyPath() {
  return path.join(getSshDir(), KEY_FILENAME)
}

function getPublicKeyPath() {
  return `${getPrivateKeyPath()}.pub`
}

function ensureSshDir() {
  const dir = getSshDir()
  fs.mkdirSync(dir, { recursive: true })
  // On macOS/Linux the .ssh dir convention is 0700. Windows ignores
  // chmod modes but the call is a no-op there, not an error.
  try { fs.chmodSync(dir, 0o700) } catch { /* ignore on win32 */ }
  return dir
}

function hasKey() {
  return fs.existsSync(getPrivateKeyPath()) && fs.existsSync(getPublicKeyPath())
}

function readPublicKey() {
  try {
    return fs.readFileSync(getPublicKeyPath(), 'utf8').trim()
  } catch {
    return null
  }
}

async function getPublicKey() {
  if (!hasKey()) return { ok: true, pubkey: null }
  const pubkey = readPublicKey()
  if (!pubkey) return { ok: false, error: 'pubkey file unreadable' }
  return { ok: true, pubkey }
}

// Generate a fresh keypair. If one already exists it is overwritten —
// the renderer side surfaces a "Regenerate key" label so the user
// knows what's happening. ssh-keygen is invoked non-interactively
// via -N for the passphrase (empty string for no passphrase) and -y
// is implicit on -t ed25519.
function generateKey({ passphrase = '' } = {}) {
  return new Promise((resolve) => {
    const hasPassphrase = !!(passphrase && passphrase.length > 0)
    log.info('generate-key.start', { dir: getSshDir(), hasPassphrase })
    try {
      ensureSshDir()
      const priv = getPrivateKeyPath()
      // ssh-keygen refuses to overwrite an existing file unless we
      // remove it first; the alternative is feeding 'y\n' to stdin
      // which is fragile across platforms.
      try { fs.rmSync(priv, { force: true }) } catch { /* ignore */ }
      try { fs.rmSync(`${priv}.pub`, { force: true }) } catch { /* ignore */ }

      const args = [
        '-t', 'ed25519',
        '-f', priv,
        '-C', KEY_COMMENT,
        '-N', passphrase || '',
        '-q',
      ]
      const child = spawn('ssh-keygen', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      child.on('error', (err) => {
        log.error('generate-key.spawn-failed', { err })
        resolve({ ok: false, error: `ssh-keygen not available: ${err.message}` })
      })
      child.on('close', (code) => {
        if (code !== 0) {
          log.error('generate-key.exit-nonzero', { code, stderr: stderr.trim() })
          resolve({ ok: false, error: stderr.trim() || `ssh-keygen exited ${code}` })
          return
        }
        try {
          fs.chmodSync(priv, 0o600)
        } catch {
          // Windows: chmod is a no-op; safe to ignore.
        }
        const pubkey = readPublicKey()
        if (!pubkey) {
          log.error('generate-key.pubkey-missing')
          resolve({ ok: false, error: 'pubkey not found after generation' })
          return
        }
        log.info('generate-key.success', { pubkeyLen: pubkey.length })
        resolve({ ok: true, pubkey })
      })
    } catch (err) {
      log.error('generate-key.crashed', { err })
      resolve({ ok: false, error: err.message || String(err) })
    }
  })
}

// SSH into the freshly-created VPS and run install.sh, passing the
// pairing token so install.sh registers the VPS as a device of the
// signed-in user (no interactive `jht cloud login` inside the VPS).
//
// Why these ssh flags:
//   - StrictHostKeyChecking=accept-new: accept on first connect, refuse
//     on key change. Trade-off accettato per la beta: l'utente acquista
//     una VPS fresca, MitM realistico solo se Hetzner stesso è ostile.
//   - UserKnownHostsFile=<userData>/ssh/known_hosts: isolata dalla
//     ~/.ssh/known_hosts dell'utente, no inquinamento del suo host file.
//   - BatchMode=yes: niente prompt interattivi. Se la chiave ha una
//     passphrase BatchMode la rifiuta — gestiamo questo caso esplicita-
//     mente piu' avanti (oggi: il keychain integration arriva post-MVP,
//     la passphrase opzionale richiede unlock manuale tramite ssh-agent).
//   - ConnectTimeout=15: VPS nuova talvolta tarda ad aprire :22.
//
// Streaming: emette ogni linea (stdout + stderr merge) sul canale IPC
// `vps:install-log` tramite il sender BrowserWindow corrente. Il
// renderer fa `vpsApi.onInstallLog(cb)` per ricevere.
function runInstall({ ip, sender } = {}) {
  return new Promise(async (resolve) => {
    const startedAt = Date.now()
    try {
      log.info('run-install.start', { ip })
      if (!IPV4_RE.test(String(ip || '').trim())) {
        log.warn('run-install.invalid-ip', { ip })
        resolve({ ok: false, error: 'invalid IPv4' })
        return
      }
      if (!hasKey()) {
        log.warn('run-install.no-key')
        resolve({ ok: false, error: 'SSH key not generated yet' })
        return
      }
      // Pull the pairing token from the active Supabase session. If the
      // user isn't signed in the install would still work but the VPS
      // couldn't pair → fail fast with a clear error instead of going
      // halfway.
      const pairing = await auth.getPairingToken()
      if (!pairing?.ok || !pairing.token) {
        log.error('run-install.pairing-token-missing', { err: pairing?.error })
        resolve({ ok: false, error: `pairing token unavailable: ${pairing?.error || 'not signed in'}` })
        return
      }

      const priv = getPrivateKeyPath()
      const knownHosts = path.join(getSshDir(), 'known_hosts')
      // The remote shell command. install.sh accepts --pairing-token
      // (cabling on the script side lands in task 14). Quoting: single
      // quotes around the whole remote command + double quotes around
      // the base64 token prevent shell expansion on the remote.
      const remoteCmd =
        `curl -fsSL ${INSTALL_URL} | bash -s -- --pairing-token "${pairing.token}"`

      const args = [
        '-i', priv,
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', `UserKnownHostsFile=${knownHosts}`,
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=15',
        `root@${ip}`,
        remoteCmd,
      ]
      log.debug('run-install.ssh-spawn', { ip, installUrl: INSTALL_URL, knownHosts })

      const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let linesSent = 0
      const emit = (line) => {
        linesSent += 1
        try {
          if (sender && !sender.isDestroyed?.()) {
            sender.send('vps:install-log', line)
          }
        } catch { /* renderer might be gone */ }
        // Log line a livello debug — utili nei bug report. Tronchiamo a
        // 500 char per non gonfiare il file con paste enormi.
        log.debug('run-install.ssh-line', {
          line: line.length > 500 ? line.slice(0, 500) + '…' : line,
        })
      }

      // Line-buffer stdout/stderr (merge) so the renderer gets one
      // event per log line, not per chunk.
      let buffer = ''
      const onChunk = (chunk) => {
        buffer += chunk.toString()
        let nl = buffer.indexOf('\n')
        while (nl >= 0) {
          emit(buffer.slice(0, nl))
          buffer = buffer.slice(nl + 1)
          nl = buffer.indexOf('\n')
        }
      }
      child.stdout.on('data', onChunk)
      child.stderr.on('data', onChunk)

      child.on('error', (err) => {
        log.error('run-install.spawn-failed', { err })
        emit(`ssh spawn error: ${err.message}`)
        resolve({ ok: false, error: err.message })
      })
      child.on('close', (code) => {
        if (buffer) emit(buffer)
        const ms = Date.now() - startedAt
        if (code !== 0) {
          log.error('run-install.exit-nonzero', { code, ms, linesSent })
          resolve({ ok: false, error: `ssh exited ${code}`, exitCode: code })
          return
        }
        log.info('run-install.success', { ip, ms, linesSent })
        resolve({ ok: true, ip })
      })
    } catch (err) {
      log.error('run-install.crashed', { err })
      resolve({ ok: false, error: err.message || String(err) })
    }
  })
}

module.exports = {
  generateKey,
  getPublicKey,
  hasKey,
  runInstall,
  getPrivateKeyPath,
  getPublicKeyPath,
}
