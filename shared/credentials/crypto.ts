/**
 * Encrypt/decrypt credenziali con AES-256-GCM.
 *
 * La master key viene derivata dalla passphrase dell'utente
 * via PBKDF2 (100k iterazioni, SHA-512). IV random per ogni operazione.
 * Auth tag GCM garantisce integrità.
 */

import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import type { EncryptedPayload } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;        // 256 bit
const IV_LENGTH = 16;         // 128 bit
const AUTH_TAG_LENGTH = 16;   // 128 bit
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha512";
const SALT_PATH = ".jht-key-salt";

/**
 * Deriva una chiave AES-256 dalla passphrase con PBKDF2.
 * Il salt viene generato al primo uso e salvato in ~/.jht/credentials/.
 */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(
    passphrase,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  );
}

/**
 * Genera un salt random per PBKDF2 (32 byte).
 */
export function generateSalt(): Buffer {
  return randomBytes(32);
}

/**
 * Cifra dati JSON con AES-256-GCM.
 *
 * @param data - oggetto da cifrare
 * @param key - chiave AES-256 derivata
 * @returns payload criptato con IV e auth tag
 */
export function encrypt(data: unknown, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const plaintext = JSON.stringify(data);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

/**
 * Decifra un payload AES-256-GCM.
 *
 * @param payload - dati criptati
 * @param key - chiave AES-256 derivata
 * @returns oggetto JSON decifrato
 * @throws se auth tag non valido o dati corrotti
 */
export function decrypt<T = unknown>(payload: EncryptedPayload, key: Buffer): T {
  if (payload.version !== 1 || payload.algorithm !== ALGORITHM) {
    throw new Error(`Formato payload non supportato: v${payload.version} ${payload.algorithm}`);
  }

  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const ciphertext = Buffer.from(payload.data, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf-8")) as T;
}

/**
 * Verifica che un payload criptato sia strutturalmente valido.
 */
export function isValidPayload(obj: unknown): obj is EncryptedPayload {
  if (!obj || typeof obj !== "object") return false;
  const p = obj as Record<string, unknown>;
  return (
    p.version === 1 &&
    p.algorithm === ALGORITHM &&
    typeof p.iv === "string" &&
    typeof p.authTag === "string" &&
    typeof p.data === "string"
  );
}
