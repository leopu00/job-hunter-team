// Cloud-sync orchestrator for the launcher main process. Sits on top
// of the existing Supabase client (desktop/auth/supabase-client.js)
// and uses the user's authenticated session to upsert/select against
// the `encrypted_user_blobs` table (migration 009).
//
// WHY A PASSPHRASE ON TOP OF GOOGLE/GITHUB LOGIN?
//
// The OAuth login authenticates the user to Supabase: it proves "I'm
// Leone, I have a row in auth.users, give me access to my own
// records" (enforced by RLS on user_id). It does NOT encrypt anything
// — Supabase ops, anyone who dumps the DB, or a Postgres replica
// reader sees every column in plaintext.
//
// The passphrase changes that: it's used client-side (in this process,
// never sent to the server) to derive a 32-byte AES key. The launcher
// encrypts the payload before upsert; Supabase only ever stores the
// ciphertext + iv + auth_tag + salt. This is the "zero-knowledge"
// model used by 1Password / Bitwarden / Signal / ProtonMail: the
// server admin literally cannot read your data, even with full DB
// access. The trade-off is brutal: lose the passphrase and the data
// is gone forever — there's no recovery path by design (if there
// were, the server admin could use the same path).
//
// For the current MVP payload (provider id + plan id, e.g. "claude /
// max20") the passphrase is arguably overkill: leaking that "user X
// uses Claude Max 20×" is uncomfortable but not catastrophic. The
// encryption is here because the planned payload extension —
// JHT-DESKTOP-SYNC original spec — covers high-value secrets:
// Tailscale auth-key (opens the user's VPN), VPS IP+region, and
// other VPS metadata. Those MUST be encrypted client-side; leaking
// a tailnet auth-key from a DB dump would be a real incident. We
// ship the envelope now so we don't have to migrate later.
//
// State machine, per blob_type:
//   disabled  -> no salt+verify in keychain
//   locked    -> salt+verify present, no in-memory key
//   unlocked  -> salt+verify present, in-memory key derived
//
// The derived key never touches disk. The keychain stores:
//   - kdf_salt (random 32 bytes, base64)
//   - verify_blob (small ciphertext we can decrypt to confirm a
//     re-entered passphrase yields the same key)
// Together they let us recover from any device that has the
// passphrase, without ever persisting the passphrase or the key.

const { getClient } = require('../auth/supabase-client')
const {
  KDF_VERSION_PBKDF2,
  KDF_ITERATIONS_V1,
  SALT_BYTES,
  deriveKey,
  encryptJson,
  decryptJson,
  buildVerifyBlob,
  checkVerifyBlob,
  randomSalt,
} = require('./crypto')

const TABLE = 'encrypted_user_blobs'
const DEFAULT_BLOB_TYPE = 'config_v1'

const KEYRING_SERVICE = 'jht-desktop-sync'

const log = require('../logger').child('sync')

let keyring = null
try {
  keyring = require('@napi-rs/keyring')
} catch (err) {
  keyring = null
  log.warn('keyring.unavailable', { err })
}

// Backend storage scelto a runtime: stesso pattern di
// desktop/auth/keyring-storage.js (vedi commento dettagliato in quel
// file). In sync il payload e' un blob JSON con metadata sync (salt,
// last_sync, ecc.) — niente segreti grezzi qui (le chiavi crypto
// derivate dalla passphrase NON vengono persistite, solo verify blob).
const _path = require('node:path')
const _fs = require('node:fs')

function _getElectronApp() {
  try { return require('electron').app } catch { return null }
}
function _chooseBackend() {
  const override = (process.env.JHT_DESKTOP_DEV_STORAGE || '').toLowerCase()
  if (override === 'memory' || override === 'file' || override === 'keychain') {
    return override
  }
  const app = _getElectronApp()
  if (!app) return 'keychain'
  if (!app.isPackaged) return 'memory'
  if (process.env.JHT_PACKAGED_SIGNED === '1') return 'keychain'
  return 'file'
}
const _memSyncStore = new Map()
function _filePath(account) {
  const app = _getElectronApp()
  const base = app ? app.getPath('userData') : require('node:os').tmpdir()
  return _path.join(base, 'sync', `${account}.txt`)
}
function _fileRead(account) {
  try { return _fs.readFileSync(_filePath(account), 'utf8') }
  catch (err) { if (err?.code === 'ENOENT') return null; throw err }
}
function _fileWrite(account, value) {
  const p = _filePath(account)
  try { _fs.mkdirSync(_path.dirname(p), { recursive: true, mode: 0o700 }) } catch { /* ignore */ }
  const tmp = p + '.tmp'
  _fs.writeFileSync(tmp, String(value), { mode: 0o600 })
  _fs.renameSync(tmp, p)
}
function _fileDelete(account) {
  try { _fs.unlinkSync(_filePath(account)) }
  catch (err) { if (err?.code === 'ENOENT') return; throw err }
}

function keyringEntry(account) {
  if (!keyring) throw new Error('Keyring native binding unavailable')
  return new keyring.Entry(KEYRING_SERVICE, account)
}

function safeGetKeychain(account) {
  const backend = _chooseBackend()
  if (backend === 'memory') {
    return _memSyncStore.has(account) ? _memSyncStore.get(account) : null
  }
  if (backend === 'file') {
    return _fileRead(account)
  }
  try {
    return keyringEntry(account).getPassword()
  } catch (err) {
    if (/no.*(matching|such).*entry|entry.*not.*found/i.test(String(err?.message || err))) {
      return null
    }
    throw err
  }
}

function safeDeleteKeychain(account) {
  const backend = _chooseBackend()
  if (backend === 'memory') {
    _memSyncStore.delete(account)
    return
  }
  if (backend === 'file') {
    _fileDelete(account)
    return
  }
  try {
    keyringEntry(account).deletePassword()
  } catch (err) {
    if (/no.*(matching|such).*entry|entry.*not.*found/i.test(String(err?.message || err))) {
      return
    }
    throw err
  }
}

function metaAccount(blobType) {
  return `meta:${blobType}`
}

function loadMeta(blobType) {
  const raw = safeGetKeychain(metaAccount(blobType))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveMeta(blobType, meta) {
  const account = metaAccount(blobType)
  const value = JSON.stringify(meta)
  const backend = _chooseBackend()
  if (backend === 'memory') {
    _memSyncStore.set(account, value)
    return
  }
  if (backend === 'file') {
    _fileWrite(account, value)
    return
  }
  keyringEntry(account).setPassword(value)
}

// In-memory key cache. Cleared on lock() / signOut() / process exit.
const keyCache = new Map() // blob_type -> Buffer

function clearKey(blobType) {
  const buf = keyCache.get(blobType)
  if (buf) buf.fill(0)
  keyCache.delete(blobType)
}

function clearAllKeys() {
  for (const k of keyCache.keys()) clearKey(k)
}

async function getAuthedClient() {
  const client = getClient()
  const { data, error } = await client.auth.getSession()
  if (error) throw new Error(error.message)
  if (!data?.session) throw new Error('Not signed in')
  return { client, session: data.session }
}

async function fetchCloudRow(blobType) {
  const { client } = await getAuthedClient()
  const { data, error } = await client
    .from(TABLE)
    .select('id, blob_type, kdf_version, kdf_salt, kdf_iterations, cipher_iv, cipher_auth_tag, ciphertext, metadata, updated_at')
    .eq('blob_type', blobType)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

async function getStatus(blobType = DEFAULT_BLOB_TYPE) {
  try {
    const meta = loadMeta(blobType)
    const hasLocalSetup = !!meta?.salt && !!meta?.verifyBlob
    const unlocked = keyCache.has(blobType)
    let cloudUpdatedAt = null
    let cloudExists = false
    try {
      const row = await fetchCloudRow(blobType)
      if (row) {
        cloudExists = true
        cloudUpdatedAt = row.updated_at || null
      }
    } catch {
      // Not signed in or network down — surface as "cloud unknown"
      // rather than blowing up; renderer treats null as "haven't
      // checked yet".
      cloudUpdatedAt = null
    }
    return {
      ok: true,
      enabled: hasLocalSetup,
      unlocked,
      lastLocalSyncAt: meta?.lastSyncAt || null,
      cloudExists,
      cloudUpdatedAt,
      blobType,
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

async function setup({ passphrase, blobType = DEFAULT_BLOB_TYPE } = {}) {
  log.info('setup.start', { blobType, passphraseLen: passphrase?.length || 0 })
  if (!passphrase || typeof passphrase !== 'string' || passphrase.length < 8) {
    log.warn('setup.passphrase-too-short')
    return { ok: false, error: 'Passphrase must be at least 8 characters' }
  }
  try {
    const salt = randomSalt()
    const key = deriveKey(passphrase, salt, KDF_ITERATIONS_V1)
    const verifyBlob = buildVerifyBlob(key)
    saveMeta(blobType, {
      salt: salt.toString('base64'),
      iterations: KDF_ITERATIONS_V1,
      kdfVersion: KDF_VERSION_PBKDF2,
      verifyBlob,
      lastSyncAt: null,
    })
    keyCache.set(blobType, key)
    log.info('setup.success', { blobType })
    return { ok: true }
  } catch (err) {
    log.error('setup.failed', { blobType, err })
    return { ok: false, error: err.message || String(err) }
  }
}

async function unlock({ passphrase, blobType = DEFAULT_BLOB_TYPE } = {}) {
  log.debug('unlock.start', { blobType })
  try {
    if (!passphrase || typeof passphrase !== 'string') {
      log.warn('unlock.passphrase-missing')
      return { ok: false, error: 'Passphrase required' }
    }
    const meta = loadMeta(blobType)
    if (!meta?.salt || !meta?.verifyBlob) {
      log.warn('unlock.not-set-up', { blobType })
      return { ok: false, error: 'Cloud sync is not set up on this device' }
    }
    const salt = Buffer.from(meta.salt, 'base64')
    const key = deriveKey(passphrase, salt, meta.iterations || KDF_ITERATIONS_V1)
    if (!checkVerifyBlob(meta.verifyBlob, key)) {
      key.fill(0)
      log.warn('unlock.wrong-passphrase')
      return { ok: false, error: 'Wrong passphrase' }
    }
    keyCache.set(blobType, key)
    log.info('unlock.success', { blobType })
    return { ok: true }
  } catch (err) {
    log.error('unlock.crashed', { err })
    return { ok: false, error: err.message || String(err) }
  }
}

function lock(blobType = DEFAULT_BLOB_TYPE) {
  clearKey(blobType)
  return { ok: true }
}

async function push({ data, blobType = DEFAULT_BLOB_TYPE } = {}) {
  const dataKeys = data && typeof data === 'object' ? Object.keys(data).length : 0
  log.info('push.start', { blobType, dataKeys })
  try {
    const key = keyCache.get(blobType)
    if (!key) {
      log.warn('push.locked', { blobType })
      return { ok: false, error: 'Cloud sync is locked' }
    }
    const meta = loadMeta(blobType)
    if (!meta?.salt) {
      log.warn('push.not-set-up', { blobType })
      return { ok: false, error: 'Cloud sync is not set up' }
    }
    const { client, session } = await getAuthedClient()
    const envelope = encryptJson(data ?? {}, key)
    // Supabase BYTEA columns accept hex literals via the JS client
    // when we pass `\x...` prefix; base64 works on the wire only via
    // the explicit byteaOutput. Easiest path: convert binary fields
    // to hex strings the postgres bytea parser auto-decodes.
    const row = {
      user_id: session.user.id,
      blob_type: blobType,
      kdf_version: meta.kdfVersion || KDF_VERSION_PBKDF2,
      kdf_salt: '\\x' + Buffer.from(meta.salt, 'base64').toString('hex'),
      kdf_iterations: meta.iterations || KDF_ITERATIONS_V1,
      cipher_iv: '\\x' + Buffer.from(envelope.iv, 'base64').toString('hex'),
      cipher_auth_tag: '\\x' + Buffer.from(envelope.auth_tag, 'base64').toString('hex'),
      ciphertext: '\\x' + Buffer.from(envelope.ciphertext, 'base64').toString('hex'),
      metadata: { app: 'jht-desktop', version: 1 },
    }
    const { error } = await client.from(TABLE).upsert(row, { onConflict: 'user_id,blob_type' })
    if (error) {
      log.error('push.upsert-failed', { blobType, err: error.message })
      return { ok: false, error: error.message }
    }
    const now = new Date().toISOString()
    saveMeta(blobType, { ...meta, lastSyncAt: now })
    log.info('push.success', { blobType, lastSyncAt: now })
    return { ok: true, lastSyncAt: now }
  } catch (err) {
    log.error('push.crashed', { blobType, err })
    return { ok: false, error: err.message || String(err) }
  }
}

// Supabase BYTEA → JS: by default returns a hex string like '\\xabcd...'
// (newer client versions) or base64 depending on column config. We
// normalize both to base64 for crypto.decryptJson.
function bytea2base64(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    if (value.startsWith('\\x') || value.startsWith('\\X')) {
      return Buffer.from(value.slice(2), 'hex').toString('base64')
    }
    // Assume already base64.
    return value
  }
  if (Buffer.isBuffer(value)) return value.toString('base64')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
  return null
}

async function pull({ blobType = DEFAULT_BLOB_TYPE } = {}) {
  try {
    const key = keyCache.get(blobType)
    if (!key) return { ok: false, error: 'Cloud sync is locked' }
    const meta = loadMeta(blobType)
    if (!meta?.salt) return { ok: false, error: 'Cloud sync is not set up' }
    const row = await fetchCloudRow(blobType)
    if (!row) return { ok: false, error: 'No cloud data found' }
    const envelope = {
      iv: bytea2base64(row.cipher_iv),
      auth_tag: bytea2base64(row.cipher_auth_tag),
      ciphertext: bytea2base64(row.ciphertext),
    }
    if (!envelope.iv || !envelope.auth_tag || !envelope.ciphertext) {
      return { ok: false, error: 'Malformed cloud row' }
    }
    const data = decryptJson(envelope, key)
    const now = new Date().toISOString()
    saveMeta(blobType, { ...meta, lastSyncAt: now })
    return { ok: true, data, lastSyncAt: now, cloudUpdatedAt: row.updated_at }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

async function disable({ blobType = DEFAULT_BLOB_TYPE, wipeCloud = false } = {}) {
  try {
    clearKey(blobType)
    safeDeleteKeychain(metaAccount(blobType))
    if (wipeCloud) {
      try {
        const { client } = await getAuthedClient()
        await client.from(TABLE).delete().eq('blob_type', blobType)
      } catch {
        // not signed in / network — best-effort.
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

module.exports = {
  getStatus,
  setup,
  unlock,
  lock,
  push,
  pull,
  disable,
  clearAllKeys,
  DEFAULT_BLOB_TYPE,
}
