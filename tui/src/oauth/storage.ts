/**
 * OAuth credentials storage with encryption.
 * Persiste token in ~/.jht/credentials.json con permessi restrictivi.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { JHT_HOME } from "../tui-paths.js";
import { resolveJhtPassphrase } from "../../../shared/credentials/passphrase.js";
import type { OAuthCredentials } from "./openai.js";

const CREDENTIALS_DIR = JHT_HOME;
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, "credentials.json");

// Versione del formato storage
const STORAGE_VERSION = 1;

/**
 * Deriva la chiave AES-256 dalla passphrase utente.
 *
 * H4: niente piu' fallback machine-derived (`${homedir()}-${USER}`).
 * Se l'utente non ha settato `JHT_CREDENTIALS_KEY` (o legacy
 * `JHT_ENCRYPTION_KEY`) ne' un'entry nel keyring, l'helper lancia
 * `MissingPassphraseError` con istruzioni — molto meglio di un file
 * cifrato con chiave indovinabile.
 *
 * Salt fisso `jht-salt` mantenuto per leggere file gia' presenti
 * sull'host. Migration verso un salt-per-file e KDF PBKDF2 e' parte
 * del lavoro H4 follow-up (vedi shared/credentials/crypto.ts).
 */
function getEncryptionKey(): Buffer {
  const passphrase = resolveJhtPassphrase({
    envVar: "JHT_CREDENTIALS_KEY",
    legacyEnvVars: ["JHT_ENCRYPTION_KEY"],
  });
  return scryptSync(passphrase, "jht-salt", 32);
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

function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(encryptedData: string, key: Buffer): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
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
    const encrypted = readFileSync(CREDENTIALS_PATH, "utf-8");
    const key = getEncryptionKey();
    const decrypted = decrypt(encrypted, key);
    const parsed = JSON.parse(decrypted) as StoredCredentials;
    
    // Migrazione se necessario
    if (parsed.version !== STORAGE_VERSION) {
      return migrateCredentials(parsed);
    }
    
    return parsed;
  } catch (err) {
    // Se fallisce la lettura/decrittazione, ritorna null
    return null;
  }
}

function saveCredentialsRaw(credentials: StoredCredentials): void {
  ensureCredentialsDir();
  const key = getEncryptionKey();
  const encrypted = encrypt(JSON.stringify(credentials), key);
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
