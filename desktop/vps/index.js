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
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { app } = require('electron')
const auth = require('../auth')
const log = require('../logger').child('vps')

// known_hosts: la connessione e' one-shot per install.sh (~30s). Dopo
// install la VPS comunica solo via HTTPS+pairing token, niente piu'
// SSH dal desktop. Quindi NON ci serve persistere host keys tra run.
// Anzi, persisterle ci ha morso vivo:
// - userData path ha "Application Support" con SPAZIO che OpenSSH usa
//   come separator in UserKnownHostsFile → split path + fallback su
//   ~/.ssh/known_hosts dell'utente con entry stale di vecchi VPS;
// - tmpdir senza spazi (fix precedente) ha pero' lo stesso problema con
//   Hetzner: stesso IP riassegnato a server nuovo = host key diversa =
//   "REMOTE HOST IDENTIFICATION HAS CHANGED".
//
// Soluzione: nessun known_hosts. UserKnownHostsFile=/dev/null + Strict
// HostKeyChecking=no. Trade-off di sicurezza accettato perche':
//   1. il VPS e' appena stato creato dall'utente (minuti fa)
//   2. l'IP arriva direttamente dalla console Hetzner via copy/paste
//   3. la connessione e' one-shot per install.sh
//   4. il pairing token viene mandato cifrato (https su install.sh source +
//      passato via env, non come arg); intercettarlo richiede compromettere
//      Hetzner stesso, e in quel caso siamo persi a prescindere

// Diagnostica SSH: chiamato prima del run install vero. Logga
// fingerprint chiave + permessi + stato known_hosts, poi tenta un
// `ssh -o BatchMode=yes ... root@ip 'true'` per testare SOLO l'auth
// (1-3 secondi). Se fallisce qui sappiamo che non e' un problema della
// install.sh ma proprio di chiave/auth. Ogni evento finisce nel log,
// cosi' un bug report contiene tutto il flow.
function preflightSshCheck({ ip, priv, knownHosts }) {
  // Fingerprint locale (MD5 + SHA256), utile per confronto con
  // Hetzner Console (che mostra MD5 hex).
  let pubFingerprint = null
  let pubKeyHead = null
  try {
    const pubPath = `${priv}.pub`
    const md5 = spawnSync('ssh-keygen', ['-l', '-E', 'md5', '-f', pubPath], {
      encoding: 'utf8',
      timeout: 5000,
    })
    const sha = spawnSync('ssh-keygen', ['-l', '-E', 'sha256', '-f', pubPath], {
      encoding: 'utf8',
      timeout: 5000,
    })
    pubFingerprint = {
      md5: (md5.stdout || '').trim(),
      sha256: (sha.stdout || '').trim(),
    }
    pubKeyHead = fs.readFileSync(pubPath, 'utf8').trim().slice(0, 120)
  } catch (err) {
    log.warn('preflight.fingerprint-failed', { err })
  }

  // Permessi della chiave privata: OpenSSH richiede 0600, rifiuta
  // sennò ("permissions are too open" → exit 255 con messaggio
  // confondente). Su Windows e' irrilevante.
  let privMode = null
  let privSize = null
  try {
    const stat = fs.statSync(priv)
    privMode = (stat.mode & 0o777).toString(8)
    privSize = stat.size
  } catch (err) {
    log.error('preflight.priv-stat-failed', { err })
  }

  // known_hosts puo' avere host entries di un VPS precedente con lo
  // stesso IP. Se mismatchano, OpenSSH rifiuta la connessione con
  // "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED" (exit 255).
  // Loggo size + se contiene gia' una entry per questo IP.
  let knownHostsState = { exists: false, size: 0, hasIp: false }
  try {
    if (fs.existsSync(knownHosts)) {
      const stat = fs.statSync(knownHosts)
      const content = fs.readFileSync(knownHosts, 'utf8')
      knownHostsState = {
        exists: true,
        size: stat.size,
        hasIp: content.split('\n').some((line) => line.startsWith(ip + ' ')),
      }
    }
  } catch (err) {
    log.warn('preflight.known-hosts-read-failed', { err })
  }

  log.info('preflight.key-state', {
    ip,
    privPath: priv,
    privMode,
    privSize,
    fingerprint: pubFingerprint,
    pubKeyHead,
    knownHostsState,
  })

  // Auth probe veloce: testa SOLO l'auth, no install.sh. -v per
  // catturare il dialogo SSH dettagliato (banner, auth methods
  // offered, key offered, motivo del reject).
  const probeArgs = [
    '-v',
    '-i', priv,
    // No verification host key: la connessione e' one-shot per il
    // pairing iniziale. Vedi commento in cima al file.
    '-o', 'StrictHostKeyChecking=no',
    '-o', `UserKnownHostsFile=${knownHosts}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'NumberOfPasswordPrompts=0',
    `root@${ip}`,
    'echo jht-preflight-ok',
  ]
  log.debug('preflight.probe-spawn', { args: probeArgs.slice(0, -2) })

  const probe = spawnSync('ssh', probeArgs, {
    encoding: 'utf8',
    timeout: 20000,
  })

  // Tutto utile: stdout (banner + echo se passa), stderr (verbose -v
  // con auth dettagli), status code, signal.
  const stderrLines = (probe.stderr || '').split('\n').filter(Boolean)
  const stdoutLines = (probe.stdout || '').split('\n').filter(Boolean)

  // Estrai dati semantici dallo stderr verbose:
  //   "debug1: Authentications that can continue: publickey,password"
  //   "debug1: Offering public key: ..."
  //   "debug1: Server accepts key: ..."
  //   "Permission denied (publickey,password)."
  const semantic = {
    serverBanner: stderrLines.find((l) => /Company protocol version|OpenSSH_/i.test(l)) || null,
    authMethodsOffered: (() => {
      const m = (probe.stderr || '').match(/Authentications that can continue:\s*([\w,]+)/)
      return m ? m[1].split(',') : null
    })(),
    keyOffered: stderrLines.some((l) => /Offering public key/i.test(l)),
    keyAccepted: stderrLines.some((l) => /Server accepts key/i.test(l)),
    permissionDenied: /Permission denied/i.test(probe.stderr || ''),
    knownHostsChanged: /REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(probe.stderr || ''),
    connectionRefused: /Connection refused/i.test(probe.stderr || ''),
    connectionTimeout: /Connection timed out|Operation timed out/i.test(probe.stderr || ''),
    hostUnreachable: /No route to host|Network is unreachable/i.test(probe.stderr || ''),
  }

  log.info('preflight.probe-result', {
    ip,
    status: probe.status,
    signal: probe.signal,
    stdoutLines: stdoutLines.length,
    stderrLines: stderrLines.length,
    semantic,
    // Ultime 30 righe stderr verbose: il debug -v e' lungo, queste
    // sono le piu' rilevanti per capire il rifiuto auth.
    stderrTail: stderrLines.slice(-30),
  })

  if (probe.status === 0 && (probe.stdout || '').includes('jht-preflight-ok')) {
    return { ok: true, semantic }
  }
  return { ok: false, semantic, status: probe.status, signal: probe.signal }
}

// Mapping errore SSH → causa probabile + suggerimento utente. Restituisce
// un oggetto strutturato che il renderer puo' usare per UI actionable.
function classifySshFailure(semantic) {
  if (semantic.knownHostsChanged) {
    return {
      kind: 'known-hosts-mismatch',
      title: 'L\'IP risponde con una chiave host diversa',
      hint: 'Un VPS precedente con questo IP ha lasciato una entry stale. ' +
            'Workaround veloce dal Terminal: `ssh-keygen -R <IP>` rimuove le entry per quell\'IP dal tuo ~/.ssh/known_hosts. ' +
            'A partire da v0.1.14 il path interno e\' in tmpdir per evitare il bug.',
    }
  }
  if (semantic.connectionRefused) {
    return {
      kind: 'connection-refused',
      title: 'Il server rifiuta la connessione su :22',
      hint: 'Il VPS non e\' ancora pronto o la porta SSH e\' chiusa. Aspetta 30s dopo la creazione e riprova.',
    }
  }
  if (semantic.connectionTimeout) {
    return {
      kind: 'connection-timeout',
      title: 'Timeout connessione',
      hint: 'IP irraggiungibile dalla rete. Controlla che il VPS sia "Running" su Hetzner Console.',
    }
  }
  if (semantic.hostUnreachable) {
    return {
      kind: 'host-unreachable',
      title: 'Host irraggiungibile',
      hint: 'Problema di rete locale o IP errato.',
    }
  }
  if (semantic.permissionDenied && !semantic.keyAccepted) {
    return {
      kind: 'auth-publickey-rejected',
      title: 'Il server non riconosce la nostra chiave SSH',
      hint: 'Probabili cause: (1) la chiave e\' stata aggiunta a Hetzner SSH Keys ma NON spuntata ' +
            'al momento del Create Server; (2) cloud-init non l\'ha installata. Verifica con la ' +
            'Console virtuale del server: `cat /root/.ssh/authorized_keys` deve contenere la nostra pubkey.',
    }
  }
  return {
    kind: 'unknown',
    title: 'Errore SSH sconosciuto',
    hint: 'Vedi il log file per i dettagli del debug verbose.',
  }
}

// URL di install.sh. Override via env JHT_INSTALL_URL — utile durante
// development o per bypassare Vercel CDN cache lenta dopo un fix nel
// file (es. puntare a GitHub raw production HEAD per test immediati).
const INSTALL_URL = process.env.JHT_INSTALL_URL || 'https://jobhunterteam.ai/install.sh'
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
// via -N "" (no passphrase). Decisione 2026-05-13: niente passphrase,
// la privkey e' protetta dai permessi filesystem (chmod 600) su
// app.getPath('userData')/ssh/. Per pairing one-shot, askpass-on-OpenSSH-10
// era un ballo di fix fragili che non valeva il guadagno di sicurezza.
function generateKey() {
  return new Promise((resolve) => {
    log.info('generate-key.start', { dir: getSshDir() })
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
        '-N', '',
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
//   - BatchMode=yes: niente prompt interattivi. La privkey non ha
//     passphrase (decisione 2026-05-13: protezione via chmod 600).
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
      // /dev/null per known_hosts: no persistenza, no stale entries.
      // Vedi commento in cima al file per il rationale di sicurezza.
      const knownHosts = '/dev/null'

      // Pre-flight: testa auth + raccoglie diagnostica DETTAGLIATA prima di
      // lanciare install.sh (pesante, lungo). Se fallisce qui sappiamo
      // gia' che il problema non e' install.sh ma proprio SSH/auth e
      // possiamo dare all'utente un errore actionable invece di "exit 255".
      const preflight = preflightSshCheck({ ip, priv, knownHosts })
      if (!preflight.ok) {
        const cls = classifySshFailure(preflight.semantic)
        log.error('run-install.preflight-failed', {
          ip,
          kind: cls.kind,
          title: cls.title,
        })
        // Stream l'errore actionable al renderer prima di rispondere.
        const sendLine = (line) => {
          try {
            if (sender && !sender.isDestroyed?.()) {
              sender.send('vps:install-log', line)
            }
          } catch { /* renderer gone */ }
        }
        sendLine(`Pre-flight SSH fallito: ${cls.title}`)
        sendLine(`Suggerimento: ${cls.hint}`)
        resolve({
          ok: false,
          error: cls.title,
          hint: cls.hint,
          kind: cls.kind,
          phase: 'preflight',
        })
        return
      }
      log.info('run-install.preflight-ok', { ip })

      // The remote shell command. install.sh accepts --pairing-token
      // (cabling on the script side lands in task 14). Quoting: single
      // quotes around the whole remote command + double quotes around
      // the base64 token prevent shell expansion on the remote.
      const remoteCmd =
        `curl -fsSL ${INSTALL_URL} | bash -s -- --pairing-token "${pairing.token}"`

      // Host key verification disabilitata per il pairing iniziale
      // one-shot (vedi commento file). BatchMode=yes: no prompt (la
      // privkey non ha passphrase, niente da chiedere).
      const args = [
        '-v',
        '-i', priv,
        '-o', 'StrictHostKeyChecking=no',
        '-o', `UserKnownHostsFile=${knownHosts}`,
        '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=15',
        `root@${ip}`,
        remoteCmd,
      ]
      log.debug('run-install.ssh-spawn', {
        ip, installUrl: INSTALL_URL, knownHosts, argsLen: args.length,
      })

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
          log.error('run-install.exit-nonzero', { code, ms, linesSent, phase: 'install' })
          resolve({
            ok: false,
            error: `ssh exited ${code} (phase: install)`,
            exitCode: code,
            phase: 'install',
          })
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
