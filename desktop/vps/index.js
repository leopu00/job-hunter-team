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
        resolve({ ok: false, error: `ssh-keygen not available: ${err.message}` })
      })
      child.on('close', (code) => {
        if (code !== 0) {
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
          resolve({ ok: false, error: 'pubkey not found after generation' })
          return
        }
        resolve({ ok: true, pubkey })
      })
    } catch (err) {
      resolve({ ok: false, error: err.message || String(err) })
    }
  })
}

module.exports = {
  generateKey,
  getPublicKey,
  hasKey,
  getPrivateKeyPath,
  getPublicKeyPath,
}
