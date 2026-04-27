/**
 * OAuth credentials storage with encryption.
 * Persiste token in ~/.jht/credentials.json con permessi restrictivi.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, scryptSync } from "node:crypto";
import { JHT_HOME } from "../tui-paths.js";
import { resolveJhtPassphrase } from "../../../shared/credentials/passphrase.js";
import type { OAuthCredentials } from "./openai.js";

const CREDENTIALS_DIR = JHT_HOME;
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, "credentials.json");

// Versione del formato storage
const STORAGE_VERSION = 1;

/**
 * Risolve la passphrase utente.
 *
 * H4: niente piu' fallback machine-derived (`${homedir()}-${USER}`).
 * Se l'utente non ha settato `JHT_CREDENTIALS_KEY` (o legacy
 * `JHT_ENCRYPTION_KEY`) ne' un'entry nel keyring, l'helper lancia
 * `MissingPassphraseError` con istruzioni.
 */
function getPassphrase(): string {
  return resolveJhtPassphrase({
    envVar: "JHT_CREDENTIALS_KEY",
    legacyEnvVars: ["JHT_ENCRYPTION_KEY"],
  });
}

/**
 * Deriva la chiave AES-256 con PBKDF2 + salt random per file
 * (H4 iter 2). Allineato al pattern shared/credentials/crypto.ts.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPI
// ─────────────────────────────────────────────────────────────────────────────

export type StoredCredentials = {
  version: number;
  providers: Record<string, ProviderCredentials>;
};

export type ProviderCredentials =
  | { type: "apiKey"; key: string; createdAt: number }
  | { 
      type: "oauth"; 
      accessToken: string;
      refreshToken?: string;
      expiresAt: number;
      tokenType: string;
      scope?: string;
      createdAt: number;
      updatedAt: number;
    };

// ─────────────────────────────────────────────────────────────────────────────
// ENCRYPTION
// ─────────────────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha512";
const SALT_BYTES = 32;
const PAYLOAD_VERSION = 2;

interface EncryptedPayloadV2 {
  v: 2;
  salt: string;
  iv: string;
  authTag: string;
  data: string;
}

function isPayloadV2(obj: unknown): obj is EncryptedPayloadV2 {
  if (!obj || typeof obj !== "object") return false;
  const p = obj as Record<string, unknown>;
  return (
    p.v === 2 &&
    typeof p.salt === "string" &&
    typeof p.iv === "string" &&
    typeof p.authTag === "string" &&
    typeof p.data === "string"
  );
}

/** Cifra `text` con AES-256-GCM + PBKDF2 + salt random per file. */
function encrypt(text: string, passphrase: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload: EncryptedPayloadV2 = {
    v: PAYLOAD_VERSION,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    data: encrypted.toString("hex"),
  };
  return JSON.stringify(payload);
}

/**
 * Decifra. Accetta:
 *   - JSON `EncryptedPayloadV2` (formato attuale, salt random per file)
 *   - stringa `iv:authTag:ciphertext` (formato legacy con salt fisso
 *     `jht-salt` derivato via scrypt; compat read-only).
 */
function decrypt(blob: string, passphrase: string): string {
  let parsed: unknown = null;
  try { parsed = JSON.parse(blob); } catch { /* legacy below */ }

  if (isPayloadV2(parsed)) {
    const salt = Buffer.from(parsed.salt, "hex");
    const iv = Buffer.from(parsed.iv, "hex");
    const authTag = Buffer.from(parsed.authTag, "hex");
    const encrypted = Buffer.from(parsed.data, "hex");
    const key = deriveKey(passphrase, salt);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  // Legacy `iv:authTag:ciphertext` con scrypt + 'jht-salt'
  const parts = blob.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  const legacyKey = scryptSync(passphrase, "jht-salt", 32);
  const decipher = createDecipheriv(ALGORITHM, legacyKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

function ensureCredentialsDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadCredentialsRaw(): StoredCredentials | null {
  try {
    if (!existsSync(CREDENTIALS_PATH)) {
      return null;
    }
    const encrypted = readFileSync(CREDENTIALS_PATH, "utf-8").trim();
    const passphrase = getPassphrase();
    const decrypted = decrypt(encrypted, passphrase);
    const parsed = JSON.parse(decrypted) as StoredCredentials;

    // Migrazione se necessario
    if (parsed.version !== STORAGE_VERSION) {
      return migrateCredentials(parsed);
    }

    // Re-write silenzioso se il file era nel formato legacy (salt fisso):
    // alla prossima save sara' gia' v2 con salt random, ma ri-scrivere
    // ora chiude la finestra in cui un attaccante con vecchia chiave
    // potrebbe ancora leggere.
    if (!encrypted.startsWith("{")) {
      try { saveCredentialsRaw(parsed); } catch { /* best-effort */ }
    }

    return parsed;
  } catch {
    // Se fallisce la lettura/decrittazione, ritorna null
    return null;
  }
}

function saveCredentialsRaw(credentials: StoredCredentials): void {
  ensureCredentialsDir();
  const passphrase = getPassphrase();
  const encrypted = encrypt(JSON.stringify(credentials), passphrase);
  writeFileSync(CREDENTIALS_PATH, encrypted, { mode: 0o600 });
  try {
    chmodSync(CREDENTIALS_PATH, 0o600);
  } catch {
    // Best effort
  }
}

function migrateCredentials(old: unknown): StoredCredentials {
  // Per ora, se la versione è diversa, resetta
  // In futuro si possono aggiungere migrazioni specifiche
  return {
    version: STORAGE_VERSION,
    providers: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API PUBBLICA
// ─────────────────────────────────────────────────────────────────────────────

export function loadCredentials(): StoredCredentials {
  return loadCredentialsRaw() || {
    version: STORAGE_VERSION,
    providers: {},
  };
}

export function saveApiKeyCredentials(
  providerId: string,
  apiKey: string
): void {
  const creds = loadCredentials();
  creds.providers[providerId] = {
    type: "apiKey",
    key: apiKey,
    createdAt: Date.now(),
  };
  saveCredentialsRaw(creds);
}

export function saveOAuthCredentials(
  providerId: string,
  oauthCreds: OAuthCredentials
): void {
  const creds = loadCredentials();
  creds.providers[providerId] = {
    type: "oauth",
    accessToken: oauthCreds.accessToken,
    refreshToken: oauthCreds.refreshToken,
    expiresAt: oauthCreds.expiresAt,
    tokenType: oauthCreds.tokenType,
    scope: oauthCreds.scope,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveCredentialsRaw(creds);
}

export function getProviderCredentials(
  providerId: string
): ProviderCredentials | undefined {
  const creds = loadCredentials();
  return creds.providers[providerId];
}

export function deleteProviderCredentials(providerId: string): void {
  const creds = loadCredentials();
  delete creds.providers[providerId];
  saveCredentialsRaw(creds);
}

export function listConfiguredProviders(): string[] {
  const creds = loadCredentials();
  return Object.keys(creds.providers);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

export function isTokenExpired(credentials: ProviderCredentials): boolean {
  if (credentials.type !== "oauth") {
    return false; // API key non scadono
  }
  // Considera scaduto se mancano meno di 5 minuti
  return Date.now() >= credentials.expiresAt - 5 * 60 * 1000;
}

export async function getValidAccessToken(
  providerId: string,
  refreshFn: (refreshToken: string) => Promise<{ accessToken: string; expiresAt: number } | null>
): Promise<string | null> {
  const creds = getProviderCredentials(providerId);
  if (!creds) {
    return null;
  }

  if (creds.type === "apiKey") {
    return creds.key;
  }

  // OAuth
  if (!isTokenExpired(creds)) {
    return creds.accessToken;
  }

  // Token scaduto, prova refresh
  if (creds.refreshToken) {
    const refreshed = await refreshFn(creds.refreshToken);
    if (refreshed) {
      // Aggiorna storage
      saveOAuthCredentials(providerId, {
        accessToken: refreshed.accessToken,
        refreshToken: creds.refreshToken,
        expiresAt: refreshed.expiresAt,
        tokenType: creds.tokenType,
        scope: creds.scope,
      });
      return refreshed.accessToken;
    }
  }

  return null;
}
