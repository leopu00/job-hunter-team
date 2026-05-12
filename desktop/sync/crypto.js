// AES-256-GCM + PBKDF2-SHA512 helpers for client-side encrypted sync.
//
// Format envelope corresponds to kdf_version=1 on the
// encrypted_user_blobs table:
//   PBKDF2-SHA512(passphrase, salt, 100_000 iters) -> 32-byte key
//   AES-256-GCM(key, iv) -> ciphertext + 16-byte authTag
//
// kdf_version is intentional: when we ship Argon2id (see
// JHT-DESKTOP-RECOVERY), it'll be kdf_version=2 with a parallel
// derive-and-verify path. The server stores the version so multiple
// schemes can coexist during migration.

const crypto = require('node:crypto')

const KDF_VERSION_PBKDF2 = 1
const KDF_ITERATIONS_V1 = 100_000
const KDF_DIGEST = 'sha512'
const KEY_BYTES = 32   // AES-256
const IV_BYTES = 12    // GCM recommended nonce length
const SALT_BYTES = 32
const TAG_BYTES = 16
const PASSPHRASE_VERIFY_TOKEN = 'jht-sync-verify-v1'

function deriveKey(passphrase, salt, iterations) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('Passphrase must be a non-empty string')
  }
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_BYTES) {
    throw new Error(`Salt must be ${SALT_BYTES} bytes`)
  }
  return crypto.pbkdf2Sync(
    Buffer.from(passphrase, 'utf-8'),
    salt,
    iterations,
    KEY_BYTES,
    KDF_DIGEST
  )
}

// Encrypts a JSON-serializable value. Returns the encoded envelope
// the server expects: all binary parts as base64 strings since the
// Supabase JS client serializes BYTEA columns that way.
function encryptJson(value, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error('Invalid encryption key')
  }
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf-8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    iv: iv.toString('base64'),
    auth_tag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

function decryptJson({ iv, auth_tag, ciphertext }, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error('Invalid decryption key')
  }
  const ivBuf = Buffer.from(iv, 'base64')
  const tagBuf = Buffer.from(auth_tag, 'base64')
  const cipherBuf = Buffer.from(ciphertext, 'base64')
  if (ivBuf.length !== IV_BYTES) throw new Error('IV length mismatch')
  if (tagBuf.length !== TAG_BYTES) throw new Error('Auth tag length mismatch')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf)
  decipher.setAuthTag(tagBuf)
  const plaintext = Buffer.concat([decipher.update(cipherBuf), decipher.final()])
  return JSON.parse(plaintext.toString('utf-8'))
}

// Encrypt a known token with the key so that on the next session we
// can verify a re-entered passphrase produces the same key WITHOUT
// storing the passphrase or the key itself. The verify blob is what
// we persist in the keychain.
function buildVerifyBlob(key) {
  return encryptJson({ token: PASSPHRASE_VERIFY_TOKEN, ts: Date.now() }, key)
}

function checkVerifyBlob(verifyBlob, key) {
  try {
    const decoded = decryptJson(verifyBlob, key)
    return decoded?.token === PASSPHRASE_VERIFY_TOKEN
  } catch {
    return false
  }
}

module.exports = {
  KDF_VERSION_PBKDF2,
  KDF_ITERATIONS_V1,
  SALT_BYTES,
  deriveKey,
  encryptJson,
  decryptJson,
  buildVerifyBlob,
  checkVerifyBlob,
  randomSalt: () => crypto.randomBytes(SALT_BYTES),
}
