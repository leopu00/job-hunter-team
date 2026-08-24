// desktop/vps/ssh-exec.js
//
// Helper centrale per eseguire comandi shell sulla VPS remota via SSH.
// Pensato per essere il SOLO posto in cui spawn-amo `ssh` dal processo
// main: i moduli a valle (provider-install in VPS mode, terminal-login
// remote, scrittura jht.config.json sul container remoto) chiamano qui.
//
// API esposta:
//
//   SshExec.run(ip, remoteCmd, opts)        → { ok, code, stdout, stderr }
//   SshExec.runStream(ip, cmd, onLine, opts)→ Promise<{ ok, code }>
//   SshExec.openPty(ip, cmd)                → ChildProcess (xterm-grade)
//   SshExec.writeFile(ip, path, content, opts) → { ok, err }
//
//   SshExec.forIp(ip)                       → { run, runStream, openPty,
//                                              writeFile } pre-bound
//
// Tutti i flag SSH sono allineati a quelli rodati in
// `desktop/vps/index.js::runInstall` (StrictHostKeyChecking=no,
// known_hosts a /dev/null, BatchMode=yes per non-pty / -tt per pty,
// ConnectTimeout=15s). La privkey viene letta da
// `vps/index.js::getPrivateKeyPath()`.
//
// Il chiamante passa SEMPRE l'ip esplicito — niente lookup da
// preferences qui dentro: chi sa quale VPS vuole contattare e' sempre
// il chiamante (state.vps.ip nel renderer / preferences nel main).

const { spawn, spawnSync } = require('node:child_process')
const log = require('../logger').child('ssh-exec')

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/

// Default timeout per i one-shot `run`. ssh stesso ha ConnectTimeout=15s
// per la fase TCP+handshake; questo timeout copre INVECE l'esecuzione del
// comando remoto. 30s e' una scelta neutra: copre `docker exec jht ...`
// tipici (status, ps, cat /etc) ma fallisce in fretta su comandi che si
// bloccano (es. wait su un container che non esiste). I caller che
// servono comandi lunghi (install, npm install) usano `runStream` o
// passano `opts.timeout` esplicito.
const DEFAULT_RUN_TIMEOUT_MS = 30_000

// Resolve del path della privkey SSH, in ordine di priorita':
//
//   1. `opts.keyPath` esplicito passato dal chiamante (massima
//      priorita': vince anche se electron e' disponibile).
//   2. `process.env.JHT_SSH_KEY_PATH` (test integration, dev workflow,
//      override per chiavi gia' caricate fuori dal launcher).
//   3. `vps/index.js::getPrivateKeyPath()` che usa
//      `electron.app.getPath('userData')`.
//
// Punto (3) vive dentro un try/catch: in node --test (no electron)
// app=undefined → throw "Cannot read properties of undefined". Lo
// catturiamo e lanciamo un errore esplicito che spiega le 3 vie.
function readPrivKeyPath(keyPath) {
  if (typeof keyPath === 'string' && keyPath.length > 0) return keyPath
  const fromEnv = process.env.JHT_SSH_KEY_PATH
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  // Lazy require + cache: vps/index.js importa electron al top,
  // teniamolo fuori dai code path che non lo richiedono (es. test
  // offline che passano opts.keyPath o env).
  try {
    if (!readPrivKeyPath._fn) {
      readPrivKeyPath._fn = require('./index').getPrivateKeyPath
    }
    const p = readPrivKeyPath._fn()
    if (typeof p === 'string' && p.length > 0) return p
    throw new Error('getPrivateKeyPath() returned empty')
  } catch (err) {
    throw new Error(
      `ssh-exec: cannot resolve SSH private key path. ` +
      `Pass opts.keyPath, set JHT_SSH_KEY_PATH env, or run inside Electron. ` +
      `(underlying: ${err.message})`
    )
  }
}

// Costruisce gli args ssh comuni a tutti i metodi.
//   pty=false  → BatchMode=yes (no allocazione TTY, no prompt)
//   pty=true   → -tt (forza TTY anche con stdin pipe), niente BatchMode
//
// Param keyPath: override esplicito del path privkey. Se omesso fa
// fallback su JHT_SSH_KEY_PATH env e poi su electron app.getPath.
// Vedi `readPrivKeyPath` per la cascata completa.
function sshArgs(ip, { pty = false, extra = [], priv, keyPath } = {}) {
  if (!ip || !IPV4_RE.test(String(ip).trim())) {
    throw new Error(`ssh-exec: invalid ipv4 "${ip}"`)
  }
  // `priv` e' alias retro-compat di `keyPath` per i call site interni
  // di ssh-exec.js stesso. La API pubblica documenta solo `keyPath`.
  const privKey = readPrivKeyPath(keyPath || priv)
  const base = [
    '-i', privKey,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=15',
    // LogLevel=ERROR sopprime "Warning: Permanently added 'X' to known_hosts"
    // su ogni invocazione — verbose noise quando si fanno N call di seguito.
    '-o', 'LogLevel=ERROR',
  ]
  if (pty) {
    base.push('-tt')
  } else {
    base.push('-o', 'BatchMode=yes')
  }
  return [...base, ...extra, `root@${ip.trim()}`]
}

function _truncForLog(s, n = 200) {
  if (typeof s !== 'string') return s
  return s.length > n ? s.slice(0, n) + '…' : s
}

// One-shot: esegue remoteCmd, ritorna stdout/stderr/code. Bloccante,
// pensato per script brevi (`docker ps`, `cat /etc/jht/version`, ecc.).
function run(ip, remoteCmd, opts = {}) {
  const startedAt = Date.now()
  const timeoutMs = Number.isFinite(opts.timeout) ? opts.timeout : DEFAULT_RUN_TIMEOUT_MS
  let args
  try {
    args = [...sshArgs(ip, { pty: false, keyPath: opts.keyPath || opts.priv }), remoteCmd]
  } catch (err) {
    log.warn('run.bad-args', { ip, err: err.message })
    return { ok: false, code: -1, stdout: '', stderr: err.message }
  }
  log.debug('run.spawn', { ip, cmd: _truncForLog(remoteCmd), timeoutMs })
  const res = spawnSync('ssh', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    // Su Windows: ignora la finestra cmd flash; su POSIX no-op.
    windowsHide: true,
    // Mai input interattivo — chi vuole stdin-driven usa runStream/openPty.
    input: opts.input,
  })
  const ms = Date.now() - startedAt
  if (res.error) {
    log.error('run.spawn-error', { ip, err: res.error.message, ms })
    return { ok: false, code: -1, stdout: '', stderr: res.error.message }
  }
  const code = typeof res.status === 'number' ? res.status : -1
  const stdout = res.stdout || ''
  const stderr = res.stderr || ''
  log.debug('run.done', {
    ip, cmd: _truncForLog(remoteCmd), code, ms,
    stdoutLen: stdout.length, stderrLen: stderr.length,
  })
  return { ok: code === 0, code, stdout, stderr }
}

// Streaming: spawn async, ogni linea (stdout+stderr merge) viene passata
// a onLine(line). Risolve quando il processo chiude. Per install lunghi
// (npm install -g, uv tool install) cosi' la UI puo' mostrare progresso.
function runStream(ip, remoteCmd, onLine, opts = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let args
    try {
      args = [...sshArgs(ip, { pty: false, keyPath: opts.keyPath || opts.priv }), remoteCmd]
    } catch (err) {
      log.warn('stream.bad-args', { ip, err: err.message })
      resolve({ ok: false, code: -1, error: err.message })
      return
    }
    log.debug('stream.spawn', { ip, cmd: _truncForLog(remoteCmd) })

    let child
    try {
      child = spawn('ssh', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      log.error('stream.spawn-throw', { ip, err: err.message })
      resolve({ ok: false, code: -1, error: err.message })
      return
    }

    // Line-buffer su stdout+stderr (merge). Perché merge: il chiamante
    // vede l'output cronologicamente come lo vedrebbe in un terminale
    // SSH interattivo, niente "tutti gli stderr in coda".
    let buffer = ''
    let lines = 0
    const push = (line) => {
      lines += 1
      try {
        if (typeof onLine === 'function') onLine(line)
      } catch { /* il caller non deve poter killare lo stream */ }
    }
    const onChunk = (chunk) => {
      buffer += chunk.toString()
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        push(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)

    child.on('error', (err) => {
      log.error('stream.error', { ip, err: err.message })
      resolve({ ok: false, code: -1, error: err.message })
    })
    child.on('close', (code) => {
      if (buffer.length > 0) push(buffer)
      const ms = Date.now() - startedAt
      log.debug('stream.done', { ip, code, ms, lines })
      resolve({ ok: code === 0, code: typeof code === 'number' ? code : -1 })
    })
  })
}

// PTY: ritorna il ChildProcess con TTY allocata (-tt). Pensato per
// essere wrappato lato renderer da un xterm.js: il caller fa
// child.stdout.on('data', ...) per leggere bytes e child.stdin.write(...)
// per inviare keystroke. La gestione resize (SIGWINCH) NON e' coperta da
// SSH client-side; per resize reale serve node-pty (T2/T3 decideranno).
function openPty(ip, remoteCmd, opts = {}) {
  const args = [...sshArgs(ip, { pty: true, keyPath: opts.keyPath || opts.priv }), remoteCmd]
  log.debug('openPty.spawn', { ip, cmd: _truncForLog(remoteCmd) })
  // stdio pipe (NON inherit): vogliamo intercettare i bytes per
  // inoltrarli all'xterm sul renderer. windowsHide irrilevante su -tt.
  return spawn('ssh', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

// [JHT-VPS-TUNNEL] Port-forward locale → remoto: `ssh -N -L
// localPort:remoteHost:remotePort root@ip`. Nessun comando remoto (-N), tiene
// solo aperto il forward. Il cockpit desktop punta poi a localhost:localPort e
// usa lo stack locale ESEGUITO sulla VPS come se fosse in locale.
//
// Keep-alive: ServerAliveInterval/CountMax fanno cadere il processo se la
// connessione muore (la rilancia il tunnel manager), ExitOnForwardFailure fa
// fallire subito se la porta remota non è raggiungibile (invece di restare
// appeso con un forward morto). pty=false → BatchMode (auth solo a chiave).
//
// Ritorna il ChildProcess (stdio pipe): il manager legge stderr per la
// diagnostica e osserva 'exit' per il reconnect.
function openForward(ip, { localPort, remoteHost = 'localhost', remotePort = 3000, keyPath } = {}) {
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
    throw new Error(`ssh-exec: invalid localPort "${localPort}"`)
  }
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
    throw new Error(`ssh-exec: invalid remotePort "${remotePort}"`)
  }
  const args = sshArgs(ip, {
    pty: false,
    keyPath,
    extra: [
      '-N',
      '-L', `${localPort}:${remoteHost}:${remotePort}`,
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'ExitOnForwardFailure=yes',
    ],
  })
  log.debug('openForward.spawn', { ip, localPort, remoteHost, remotePort })
  // -N non produce stdout; teniamo solo stderr per la diagnostica del manager.
  return spawn('ssh', args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
}

// Scrive un file remoto. Due strategie:
//
//   atomic=false  → `cat > '<path>' && chmod <mode> '<path>'`
//                   semplice, single round-trip ssh, va bene per file
//                   piccoli (config JSON < 64KB).
//
//   atomic=true   → tmp + mv: scrive su /tmp/jht-<random> e poi mv.
//                   Difende da un crash a meta' write che lascia il file
//                   originale corrotto. Costa una mv extra.
//
// Quoting: il path va in single-quote bash. Rifiutiamo path che
// contengono apici singoli (raro nei file di config) per evitare quote
// breaking. Mode di default 0600 (config con secrets).
function writeFile(ip, remotePath, content, opts = {}) {
  if (typeof remotePath !== 'string' || remotePath.length === 0) {
    return { ok: false, err: 'remotePath required' }
  }
  if (remotePath.includes("'")) {
    return { ok: false, err: "remotePath cannot contain single quotes" }
  }
  const mode = opts.mode || '0600'
  if (!/^[0-7]{3,4}$/.test(mode)) {
    return { ok: false, err: `invalid mode: ${mode}` }
  }
  const atomic = opts.atomic === true

  // Comando remoto:
  //   - non-atomic: cat > 'P' && chmod M 'P'
  //   - atomic    : umask + cat > 'TMP' && chmod M 'TMP' && mv 'TMP' 'P'
  // Il chmod prima di mv evita race "file visible at dest with default
  // umask before chmod runs". Su Hetzner Ubuntu base /tmp e' sullo
  // stesso fs di /root/.jht — mv e' atomica (rename(2)).
  let remoteCmd
  if (atomic) {
    // tmp path: dirname target + .jht-tmp.<rand>. Stessi spazi-safe rules
    // del path di destinazione (no single quote, validato sopra). Il rand
    // resta ASCII-safe da Math.random.
    const slash = remotePath.lastIndexOf('/')
    const dir = slash >= 0 ? remotePath.slice(0, slash) || '/' : '.'
    const rand = Math.random().toString(36).slice(2, 10)
    const tmpPath = `${dir}/.jht-tmp.${rand}`
    if (tmpPath.includes("'")) {
      return { ok: false, err: 'derived tmp path contains quotes (unexpected)' }
    }
    remoteCmd =
      `set -e; cat > '${tmpPath}' && chmod ${mode} '${tmpPath}' && mv '${tmpPath}' '${remotePath}'`
  } else {
    remoteCmd = `set -e; cat > '${remotePath}' && chmod ${mode} '${remotePath}'`
  }

  const args = [...sshArgs(ip, { pty: false, keyPath: opts.keyPath }), remoteCmd]
  const startedAt = Date.now()
  log.debug('writeFile.spawn', {
    ip, path: remotePath, atomic, mode, contentLen: (content || '').length,
  })
  const res = spawnSync('ssh', args, {
    encoding: 'utf8',
    timeout: DEFAULT_RUN_TIMEOUT_MS,
    input: typeof content === 'string' ? content : Buffer.from(content || ''),
    windowsHide: true,
  })
  const ms = Date.now() - startedAt
  if (res.error) {
    log.error('writeFile.spawn-error', { ip, err: res.error.message, ms })
    return { ok: false, err: res.error.message }
  }
  const code = typeof res.status === 'number' ? res.status : -1
  if (code !== 0) {
    const err = (res.stderr || '').trim() || `ssh exited ${code}`
    log.error('writeFile.exit-nonzero', { ip, path: remotePath, code, ms, err: _truncForLog(err) })
    return { ok: false, err }
  }
  log.debug('writeFile.done', { ip, path: remotePath, ms })
  return { ok: true }
}

// Factory ergonomica: apre un "client" pre-bound a un ip (e
// opzionalmente a un keyPath di default). Pensato per chi fa N call
// sullo stesso server (es. provider-install via SSH che dopo la
// verifica binario procede con i 3 step di install). Le opts passate
// alla singola chiamata vincono sempre sui defaults.
function forIp(ip, defaults = {}) {
  const merge = (opts) => {
    if (defaults.keyPath && !(opts && opts.keyPath)) {
      return { ...(opts || {}), keyPath: defaults.keyPath }
    }
    return opts
  }
  return {
    run: (remoteCmd, opts) => run(ip, remoteCmd, merge(opts)),
    runStream: (remoteCmd, onLine, opts) => runStream(ip, remoteCmd, onLine, merge(opts)),
    openPty: (remoteCmd, opts) => openPty(ip, remoteCmd, merge(opts)),
    writeFile: (remotePath, content, opts) => writeFile(ip, remotePath, content, merge(opts)),
  }
}

module.exports = {
  run,
  runStream,
  openPty,
  openForward,
  writeFile,
  forIp,
  // Esposti per i test: validazione args + helper readPrivKeyPath.
  _internal: { sshArgs, readPrivKeyPath, IPV4_RE },
}
