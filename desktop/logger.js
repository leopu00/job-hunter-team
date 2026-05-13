// desktop/logger.js — file logger condiviso del processo main.
//
// Scrive su disco in formato JSON Lines (una riga = un evento) sotto
// `app.getPath('userData')/logs/`. Ogni avvio dell'app apre un file nuovo
// con timestamp (`jht-desktop-YYYYMMDD-HHMMSS.log`), così i log di sessioni
// diverse non si mescolano e si possono allegare facilmente a un bug
// report. Rotazione: tiene gli ultimi 10 file, gli altri vengono rimossi
// al boot.
//
// Uso:
//
//   const log = require('./logger')                        // singleton
//   log.init(app)                                          // 1 volta nel main, dentro whenReady (o prima)
//   log.info('boot.ready', { platform: process.platform })
//   log.warn('docker.missing')
//   log.error('vps.run-install.failed', { ip, err: e })
//   log.child('auth').info('signin.start', { provider })   // namespaced
//
// `init` può essere chiamato anche PRIMA di whenReady — se l'app non è
// ancora pronta usa un path di fallback (`os.tmpdir`/jht-desktop-logs).
// Tutti i log emessi pre-init vanno in buffer e vengono flushati al
// primo `init`.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_FILES = 10
const PRE_INIT_BUFFER_LIMIT = 500

let _stream = null
let _logFile = null
let _logDir = null
let _initialized = false
let _level = LEVELS[(process.env.JHT_LOG_LEVEL || 'debug').toLowerCase()] || LEVELS.debug
const _preInitBuffer = []

function _ts() {
  return new Date().toISOString()
}

function _safeStringify(obj) {
  // Replacer che gestisce errori, BigInt e cicli senza esplodere.
  const seen = new WeakSet()
  return JSON.stringify(obj, (key, value) => {
    if (value instanceof Error) {
      return {
        __error: true,
        name: value.name,
        message: value.message,
        stack: value.stack,
        ...(value.code ? { code: value.code } : {}),
      }
    }
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  })
}

function _redact(meta) {
  // Best-effort redaction: maschera campi che assomigliano a credenziali
  // prima di scriverli su disco. Non sufficiente come security boundary
  // (la regola vera è non passarli al logger), ma è un secondo livello.
  if (!meta || typeof meta !== 'object') return meta
  const sensitiveKeys = /^(token|api[_-]?key|password|secret|bearer|authorization|session|cookie|pairing[_-]?token|bot[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key)$/i
  const out = Array.isArray(meta) ? [] : {}
  for (const [k, v] of Object.entries(meta)) {
    if (sensitiveKeys.test(k)) {
      out[k] = typeof v === 'string' && v.length > 0 ? `[REDACTED:${v.length}]` : '[REDACTED]'
    } else if (v && typeof v === 'object') {
      out[k] = _redact(v)
    } else {
      out[k] = v
    }
  }
  return out
}

function _write(record) {
  if (LEVELS[record.level] < _level) return
  const safe = { ...record, meta: _redact(record.meta) }
  const line = _safeStringify(safe) + '\n'
  if (_stream) {
    try {
      _stream.write(line)
    } catch (e) {
      // Se la scrittura su file fallisce non vogliamo crashare il main:
      // fallback a console.
      // eslint-disable-next-line no-console
      console.error('[logger] write failed:', e?.message || e)
    }
  } else {
    if (_preInitBuffer.length < PRE_INIT_BUFFER_LIMIT) _preInitBuffer.push(line)
  }
  // Mirror sintetico su stderr quando si gira con --enable-logging / dev.
  // In packaged builds il mirror resta utile per `electron --enable-logging`.
  const prefix = `[${record.level.toUpperCase()}] [${record.scope || 'main'}]`
  const tail = safe.meta ? ' ' + _safeStringify(safe.meta) : ''
  // eslint-disable-next-line no-console
  if (record.level === 'error') console.error(prefix, record.event, tail)
  else if (record.level === 'warn') console.warn(prefix, record.event, tail)
  else console.log(prefix, record.event, tail)
}

function _emit(level, scope, event, meta) {
  _write({
    ts: _ts(),
    level,
    scope: scope || 'main',
    event: String(event || ''),
    pid: process.pid,
    meta: meta && typeof meta === 'object' ? meta : meta !== undefined ? { value: meta } : undefined,
  })
}

function _rotate(dir) {
  // Trattiene MAX_FILES file più recenti (oltre al corrente). Best effort:
  // un errore qui non deve bloccare il boot.
  try {
    const files = fs
      .readdirSync(dir)
      .filter((n) => /^jht-desktop-.*\.log$/.test(n))
      .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (let i = MAX_FILES; i < files.length; i++) {
      try {
        fs.unlinkSync(path.join(dir, files[i].n))
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function init(app) {
  if (_initialized) return { file: _logFile, dir: _logDir }
  let baseDir
  try {
    baseDir = app && typeof app.getPath === 'function' ? app.getPath('userData') : null
  } catch {
    baseDir = null
  }
  if (!baseDir) baseDir = path.join(os.tmpdir(), 'jht-desktop')
  const dir = path.join(baseDir, 'logs')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[logger] mkdir failed:', e?.message || e)
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
    .replace('T', '-')
  const file = path.join(dir, `jht-desktop-${stamp}.log`)
  try {
    _stream = fs.createWriteStream(file, { flags: 'a' })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[logger] open log file failed:', e?.message || e)
    _stream = null
  }
  _logFile = file
  _logDir = dir
  _initialized = true
  _rotate(dir)

  // Flush buffer pre-init.
  if (_stream && _preInitBuffer.length) {
    try {
      for (const line of _preInitBuffer) _stream.write(line)
    } catch {
      /* ignore */
    }
    _preInitBuffer.length = 0
  }

  // Hook process-level: ogni eccezione non gestita diventa una riga di log.
  process.on('uncaughtException', (err) => {
    _emit('error', 'process', 'uncaughtException', { err })
  })
  process.on('unhandledRejection', (reason) => {
    _emit('error', 'process', 'unhandledRejection', { reason })
  })

  _emit('info', 'logger', 'init', { file, dir, level: levelName(_level), nodePid: process.pid })
  return { file, dir }
}

function levelName(numeric) {
  for (const [k, v] of Object.entries(LEVELS)) if (v === numeric) return k
  return 'debug'
}

function setLevel(name) {
  const n = LEVELS[String(name || '').toLowerCase()]
  if (n) _level = n
}

function getLogFile() {
  return _logFile
}

function getLogDir() {
  return _logDir
}

// Wrap di un IPC handler per loggare invoke / risultato / errori.
//
//   ipcMain.handle('vps:run-install',
//     logger.wrapIpc('vps.run-install', (event, args) => vps.runInstall(event, args)))
//
function wrapIpc(channel, handler) {
  return async function ipcHandler(event, ...args) {
    const start = Date.now()
    _emit('debug', 'ipc', `${channel}.invoke`, { args: _maskArgs(args) })
    try {
      const result = await handler(event, ...args)
      const ms = Date.now() - start
      _emit('debug', 'ipc', `${channel}.ok`, {
        ms,
        ok: result && typeof result === 'object' ? result.ok !== false : true,
      })
      return result
    } catch (err) {
      const ms = Date.now() - start
      _emit('error', 'ipc', `${channel}.error`, { ms, err })
      throw err
    }
  }
}

// Maschera argomenti grossi (es. payload completi) per non far esplodere
// il log. Logga solo size / type degli oggetti complessi.
function _maskArgs(args) {
  return args.map((a) => {
    if (a == null) return a
    if (typeof a === 'string') return a.length > 200 ? `[string:${a.length}]` : a
    if (typeof a === 'object') {
      if (Array.isArray(a)) return `[array:${a.length}]`
      const keys = Object.keys(a)
      if (keys.length > 8) return `[object:${keys.length}keys]`
      return _redact(a)
    }
    return a
  })
}

function child(scope) {
  return {
    debug: (event, meta) => _emit('debug', scope, event, meta),
    info: (event, meta) => _emit('info', scope, event, meta),
    warn: (event, meta) => _emit('warn', scope, event, meta),
    error: (event, meta) => _emit('error', scope, event, meta),
    child: (sub) => child(`${scope}.${sub}`),
  }
}

module.exports = {
  init,
  setLevel,
  getLogFile,
  getLogDir,
  wrapIpc,
  child,
  debug: (event, meta) => _emit('debug', 'main', event, meta),
  info: (event, meta) => _emit('info', 'main', event, meta),
  warn: (event, meta) => _emit('warn', 'main', event, meta),
  error: (event, meta) => _emit('error', 'main', event, meta),
}
