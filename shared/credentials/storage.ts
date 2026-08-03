/**
 * Storage credenziali su filesystem.
 *
 * Legge/scrive file criptati in ~/.jht/credentials/ con permessi
 * restrittivi (0600). Gestisce salt PBKDF2 e key derivation.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { JHT_CREDENTIALS_DIR } from "../paths.js";
import {
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  isValidPayload,
} from "./crypto.js";
import { MissingPassphraseError, resolveJhtPassphrase } from "./passphrase.js";
import type {
  Credential,
  CredentialReadResult,
  EncryptedPayload,
} from "./types.js";

const CREDENTIALS_DIR = JHT_CREDENTIALS_DIR;
const SALT_FILE = join(CREDENTIALS_DIR, ".salt");
const FILE_MODE = 0o600;
const PASSPHRASE_ENV_VAR = "JHT_CREDENTIALS_KEY";

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
  return resolveJhtPassphrase({ envVar: PASSPHRASE_ENV_VAR });
}

/**
 * Errore di passphrase mancante contestualizzato sul provider: dice che il
 * dato c'è e cosa serve per leggerlo, non solo che la lettura è fallita.
 */
function missingPassphraseError(provider: string): MissingPassphraseError {
  return new MissingPassphraseError(
    PASSPHRASE_ENV_VAR,
    `Manca la passphrase, non la credenziale: «${provider}» è salvata e ` +
      `integra in ${CREDENTIALS_DIR}, ma senza ${PASSPHRASE_ENV_VAR} non è ` +
      `decifrabile. Il file non è stato toccato.`,
  );
}

function credentialPath(provider: string): string {
  return join(CREDENTIALS_DIR, `${provider}.enc.json`);
}

/**
 * Salva una credenziale criptata su disco.
 */
export function writeCredential(
  provider: string,
  credential: Credential,
): void {
  ensureDir();
  const passphrase = resolvePassphrase();
  const key = resolveMasterKey(passphrase);
  const payload = encrypt(credential, key);
  const path = credentialPath(provider);
  writeFileSync(path, JSON.stringify(payload, null, 2), { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

/**
 * Legge una credenziale distinguendo i motivi del fallimento, senza mai
 * lanciare. È la forma da usare dove «passphrase mancante» va mostrata
 * all'utente invece di interrompere il flusso (status page, wizard, health).
 *
 * L'ordine dei controlli non è casuale: il file viene ispezionato **prima**
 * della passphrase, così una credenziale mai salvata resta `absent` anche
 * quando la passphrase manca — non ha senso reclamare una chiave per un dato
 * che non c'è.
 */
export function inspectCredential(provider: string): CredentialReadResult {
  const path = credentialPath(provider);
  if (!existsSync(path)) return { status: "absent" };

  let payload: EncryptedPayload;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isValidPayload(parsed)) return { status: "corrupted" };
    payload = parsed;
  } catch {
    return { status: "corrupted" };
  }

  let passphrase: string;
  try {
    passphrase = resolvePassphrase();
  } catch (error) {
    if (error instanceof MissingPassphraseError) {
      return {
        status: "missing_passphrase",
        message: missingPassphraseError(provider).message,
        envVar: PASSPHRASE_ENV_VAR,
      };
    }
    throw error;
  }

  try {
    const key = resolveMasterKey(passphrase);
    return { status: "ok", credential: decrypt<Credential>(payload, key) };
  } catch {
    // Auth tag GCM fallito, salt sostituito, passphrase diversa da quella di
    // scrittura: casi crittograficamente indistinguibili fra loro.
    return { status: "corrupted" };
  }
}

/**
 * Legge e decifra una credenziale da disco.
 *
 * Ritorna `null` se il file non esiste o non è decifrabile (corrotto, oppure
 * cifrato con un'altra passphrase — con GCM i due casi non si distinguono).
 *
 * @throws {MissingPassphraseError} se il file esiste ed è integro ma nessuna
 *   sorgente fornisce la passphrase. Prima questo caso tornava `null`, cioè
 *   una credenziale recuperabile veniva riportata come mai salvata, in
 *   contraddizione con `writeCredential` che invece lancia. Chi ha bisogno di
 *   un esito senza eccezioni usi `inspectCredential`.
 */
export function readCredential(provider: string): Credential | null {
  const result = inspectCredential(provider);
  if (result.status === "ok") return result.credential;
  if (result.status === "missing_passphrase") {
    throw missingPassphraseError(provider);
  }
  return null;
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
