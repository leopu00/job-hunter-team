/**
 * Storage credenziali su filesystem.
 *
 * Legge/scrive file criptati in ~/.jht/credentials/ con permessi
 * restrittivi (0600). Gestisce salt PBKDF2 e key derivation.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JHT_CREDENTIALS_DIR } from "../paths.js";
import { decrypt, deriveKey, encrypt, generateSalt, isValidPayload } from "./crypto.js";
import { resolveJhtPassphrase } from "./passphrase.js";
import type { Credential, EncryptedPayload } from "./types.js";

const CREDENTIALS_DIR = JHT_CREDENTIALS_DIR;
const SALT_FILE = join(CREDENTIALS_DIR, ".salt");
const FILE_MODE = 0o600;

function ensureDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Risolve la master key da passphrase + salt persistente.
 * Se il salt non esiste, ne genera uno nuovo.
 */
function resolveMasterKey(passphrase: string): Buffer {
  ensureDir();
  let salt: Buffer;

  if (existsSync(SALT_FILE)) {
    salt = readFileSync(SALT_FILE);
  } else {
    salt = generateSalt();
    writeFileSync(SALT_FILE, salt, { mode: FILE_MODE });
  }

  return deriveKey(passphrase, salt);
}

/**
 * Risolve la passphrase per la cifratura.
 * Delega all'helper unificato `resolveJhtPassphrase`: env var
 * `JHT_CREDENTIALS_KEY` → OS keyring (se `@napi-rs/keyring` e' installato)
 * → throw `MissingPassphraseError`. Niente piu' fallback machine-derived.
 */
function resolvePassphrase(): string {
  return resolveJhtPassphrase({ envVar: "JHT_CREDENTIALS_KEY" });
}

function credentialPath(provider: string): string {
  return join(CREDENTIALS_DIR, `${provider}.enc.json`);
}

/**
 * Salva una credenziale criptata su disco.
 */
export function writeCredential(provider: string, credential: Credential): void {
  ensureDir();
  const passphrase = resolvePassphrase();
  const key = resolveMasterKey(passphrase);
  const payload = encrypt(credential, key);
  const path = credentialPath(provider);
  writeFileSync(path, JSON.stringify(payload, null, 2), { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

/**
 * Legge e decifra una credenziale da disco.
 * Ritorna null se il file non esiste o è corrotto.
 */
export function readCredential(provider: string): Credential | null {
  const path = credentialPath(provider);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    const payload = JSON.parse(raw) as unknown;
    if (!isValidPayload(payload)) return null;

    const passphrase = resolvePassphrase();
    const key = resolveMasterKey(passphrase);
    return decrypt<Credential>(payload, key);
  } catch {
    return null;
  }
}

/**
 * Rimuove il file credenziale di un provider.
 * Ritorna true se il file esisteva.
 */
export function deleteCredential(provider: string): boolean {
  const path = credentialPath(provider);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * Elenca i provider che hanno un file credenziale su disco.
 */
export function listStoredProviders(): string[] {
  ensureDir();
  try {
    return readdirSync(CREDENTIALS_DIR)
      .filter((f: string) => f.endsWith(".enc.json"))
      .map((f: string) => f.replace(".enc.json", ""));
  } catch {
    return [];
  }
}

/**
 * Verifica se un provider ha un file credenziale su disco.
 */
export function hasStoredCredential(provider: string): boolean {
  return existsSync(credentialPath(provider));
}
