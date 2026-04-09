/**
 * OAuth credentials storage with encryption.
 * Persiste token in ~/.jht/credentials.json con permessi restrictivi.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { OAuthCredentials } from "./openai.js";

const CREDENTIALS_DIR = join(homedir(), ".jht");
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, "credentials.json");

// Versione del formato storage
const STORAGE_VERSION = 1;

// Chiave derivata da env var o generata casualmente per sessione
// NOTA: In produzione, usare un keyring OS-specifico
function getEncryptionKey(): Buffer {
  const envKey = process.env.JHT_ENCRYPTION_KEY;
  if (envKey) {
    return scryptSync(envKey, "jht-salt", 32);
  }
  // Fallback: chiave derivata da macchina (non sicuro per multi-user)
  const machineId = `${homedir()}-${process.env.USER || "unknown"}`;
  return scryptSync(machineId, "jht-fallback-salt", 32);
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
