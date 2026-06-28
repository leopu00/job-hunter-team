// desktop/vps/tunnel.js
//
// [JHT-VPS-TUNNEL] Gestore del tunnel SSH desktop→VPS. Tiene vivo UN forward
// `ssh -N -L <localPort>:localhost:3000 root@<ip>` (via ssh-exec.openForward),
// con health-check e auto-reconnect dopo una caduta. Il cockpit desktop punta
// poi a http://localhost:<localPort> e usa lo stack della VPS COME SE fosse in
// locale → riusa al 100% la dashboard locale eseguita sul container remoto,
// senza passare dal cloud. È il pezzo che, insieme al ritiro dei poller di
// controllo, fa scendere il costo Vercel per-utente.
//
// Un solo tunnel per volta (un solo VPS). Lo spawn di ssh vive SOLO in
// ssh-exec.js (single source of truth); qui c'è la sola logica di lifecycle.

const net = require('node:net')
const SshExec = require('./ssh-exec')
const log = require('../logger').child('tunnel')

const PREFERRED_PORT = 3300 // dedicata al tunnel VPS (evita 3000/3001 del dev locale)
const HEALTH_TIMEOUT_MS = 2000
const READY_TIMEOUT_MS = 20000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

// Stato singolo. status: down | connecting | ready | error
let state = { status: 'down', ip: null, localPort: null, remotePort: 3000, error: null }
let child = null
let intentionalClose = false
let wasReady = false // true dopo un primo ready: abilita l'auto-reconnect sui drop
let reconnectAttempts = 0
let reconnectTimer = null

function getStatus() {
  return {
    status: state.status,
    ip: state.ip,
    localPort: state.localPort,
    url:
      state.status === 'ready' && state.localPort
        ? `http://localhost:${state.localPort}`
        : null,
    error: state.error,
  }
}

// Porta TCP libera su 127.0.0.1: prova `preferred`, poi ne fa assegnare una
// qualsiasi dall'OS. Ritorna null se anche quello fallisce.
function pickFreePort(preferred) {
  return new Promise((resolve) => {
    const tryListen = (port, fallbackToAny) => {
      const srv = net.createServer()
      srv.once('error', () => {
        srv.close(() => (fallbackToAny ? tryListen(0, false) : resolve(null)))
      })
      srv.listen(port, '127.0.0.1', () => {
        const p = srv.address().port
        srv.close(() => resolve(p))
      })
    }
    tryListen(preferred, true)
  })
}

// Health: un TCP connect a localhost:localPort riesce quando ssh ha aperto il
// listener locale del forward (= connessione autenticata e forward stabilito).
function checkHealth(localPort) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: localPort })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(HEALTH_TIMEOUT_MS)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
  })
}

async function waitReady(localPort, deadline) {
  while (Date.now() < deadline) {
    if (child === null) return false // ssh è morto durante l'attesa
    if (await checkHealth(localPort)) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

function spawnChild() {
  child = SshExec.openForward(state.ip, {
    localPort: state.localPort,
    remotePort: state.remotePort,
  })
  let stderr = ''
  child.stderr?.on('data', (d) => {
    stderr += d.toString()
    if (stderr.length > 4000) stderr = stderr.slice(-4000)
  })
  child.on('exit', (code, signal) => {
    log.warn('child-exit', {
      code,
      signal,
      intentional: intentionalClose,
      wasReady,
      stderr: stderr.slice(-300),
    })
    child = null
    if (intentionalClose) {
      state = { status: 'down', ip: null, localPort: null, remotePort: 3000, error: null }
      return
    }
    if (!wasReady) {
      // Morto durante il primo connect (es. auth/host irraggiungibile): non
      // ritentare a raffica, lascia che openTunnel chiuda con errore.
      return
    }
    // Drop dopo essere stato ready: ricollega con backoff.
    state = { ...state, status: 'connecting', error: stderr.slice(-300) || `ssh exited (code=${code})` }
    scheduleReconnect()
  })
}

function scheduleReconnect() {
  if (intentionalClose || reconnectTimer) return
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempts, 5))
  reconnectAttempts += 1
  log.info('reconnect-scheduled', { delayMs: delay, attempt: reconnectAttempts })
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    if (intentionalClose) return
    try {
      spawnChild()
    } catch (err) {
      state = { ...state, status: 'error', error: err.message }
      scheduleReconnect()
      return
    }
    const ok = await waitReady(state.localPort, Date.now() + READY_TIMEOUT_MS)
    if (ok) {
      reconnectAttempts = 0
      state = { ...state, status: 'ready', error: null }
      log.info('reconnected', { localPort: state.localPort })
    } else if (child) {
      // ssh vivo ma forward non pronto: killalo, il suo 'exit' ri-pianifica.
      try { child.kill('SIGTERM') } catch { /* ignore */ }
    } else {
      scheduleReconnect()
    }
  }, delay)
}

// Apre (o riusa) il tunnel verso `ip`. Idempotente: se già ready sullo stesso
// ip ritorna lo stato corrente. Risolve solo quando il forward è raggiungibile
// (o errore/timeout).
async function openTunnel({ ip, remotePort = 3000 } = {}) {
  if (!ip) return { ok: false, error: 'ip required' }
  if (state.status === 'ready' && state.ip === ip && child) {
    return { ok: true, ...getStatus() }
  }
  await closeTunnel()

  intentionalClose = false
  wasReady = false
  reconnectAttempts = 0

  const localPort = await pickFreePort(PREFERRED_PORT)
  if (!localPort) return { ok: false, error: 'nessuna porta locale libera' }

  state = { status: 'connecting', ip, localPort, remotePort, error: null }
  try {
    spawnChild()
  } catch (err) {
    state = { status: 'error', ip, localPort: null, remotePort, error: err.message }
    return { ok: false, error: err.message }
  }

  const ready = await waitReady(localPort, Date.now() + READY_TIMEOUT_MS)
  if (!ready) {
    await closeTunnel()
    state = { status: 'error', ip: null, localPort: null, remotePort, error: 'tunnel non pronto entro il timeout' }
    return { ok: false, error: state.error }
  }

  wasReady = true
  state = { ...state, status: 'ready', error: null }
  log.info('ready', { ip, localPort })
  return { ok: true, ...getStatus() }
}

async function closeTunnel() {
  intentionalClose = true
  wasReady = false
  reconnectAttempts = 0
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (child) {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
    child = null
  }
  state = { status: 'down', ip: null, localPort: null, remotePort: 3000, error: null }
  return { ok: true }
}

module.exports = { openTunnel, closeTunnel, getStatus }
