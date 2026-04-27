import { readFile, writeFile, readdir, mkdir, access, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, scryptSync } from 'node:crypto';
import { JHT_HOME } from '../jht-paths.js';

const JHT_DIR   = JHT_HOME;
const CREDS_DIR = join(JHT_DIR, 'credentials');
const KEY_ENV   = 'JHT_SECRET_KEY';

// AES-256-GCM con KDF PBKDF2 (allineato a shared/credentials/crypto.ts)
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const DIM    = '\x1b[90m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function getPassphrase() {
  return process.env[KEY_ENV] ?? null;
}

/** Cifra `text` con AES-256-GCM. Salt random per file, derivazione PBKDF2. */
function encryptGCM(text, passphrase) {
  const salt = randomBytes(SALT_LENGTH);
  const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    version: 1,
    algorithm: ALGORITHM,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

/** Decifra un payload GCM serializzato come JSON. Lancia se auth tag invalido. */
function decryptGCM(payloadJson, passphrase) {
  const payload = JSON.parse(payloadJson);
  if (payload.version !== 1 || payload.algorithm !== ALGORITHM) {
    throw new Error(`Formato non supportato: v${payload.version} ${payload.algorithm}`);
  }
  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const ciphertext = Buffer.from(payload.data, 'hex');
  const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

/**
 * Decifra il vecchio formato CBC `iv:ciphertext` con scrypt+salt-fisso.
 * Mantenuto solo per migration silenziosa: nessun nuovo file viene
 * scritto in CBC.
 */
function decryptLegacyCBC(data, passphrase) {
  const key = scryptSync(passphrase, 'jht-salt', 32);
  const [ivHex, encHex] = data.split(':');
  if (!ivHex || !encHex) throw new Error('Payload CBC malformato');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}

async function handleSecrets(action, options) {
  if (!action || action === 'list' || action === 'ls') return await listSecrets();
  if (action === 'set') return await setSecret(options);
  if (action === 'get') return await getSecret(options);
  if (action === 'delete' || action === 'rm') return await deleteSecret(options);

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: list, set --name <n> --value <v>, get --name <n>, delete --name <n>');
  process.exitCode = 1;
}

async function listSecrets() {
  await mkdir(CREDS_DIR, { recursive: true });
  const entries = await readdir(CREDS_DIR);
  const secrets = entries.filter(e => e.endsWith('.enc') || e.endsWith('.json'));

  console.log(`\n  ${BOLD}JHT — Secrets${RESET} (${secrets.length})\n`);

  if (secrets.length === 0) {
    console.log(`  ${DIM}Nessun secret salvato.${RESET}\n`);
    return;
  }

  for (const f of secrets.sort()) {
    const type = f.endsWith('.enc') ? `${GREEN}cifrato${RESET}` : `${DIM}plaintext${RESET}`;
    const name = f.replace(/\.(enc|json)$/, '');
    console.log(`  ${GREEN}●${RESET}  ${name.padEnd(20)} ${type}`);
  }
  console.log('');
}

async function setSecret(options) {
  if (!options.name || !options.value) {
    console.error('  --name e --value obbligatori');
    process.exitCode = 1;
    return;
  }

  await mkdir(CREDS_DIR, { recursive: true, mode: 0o700 });
  const passphrase = getPassphrase();

  if (!passphrase) {
    console.error(`\n  ${RED}✗${RESET}  ${BOLD}${KEY_ENV} non impostata.${RESET}`);
    console.error(`  ${DIM}I secret devono essere cifrati a riposo. Imposta una passphrase:${RESET}`);
    console.error(`    ${BOLD}export ${KEY_ENV}="<passphrase robusta>"${RESET}`);
    console.error(`  ${DIM}Salvala anche nel tuo shell rc (~/.bashrc, ~/.zshrc) per persistenza,${RESET}`);
    console.error(`  ${DIM}o in un OS keyring (Keychain/Credential Manager/SecretService).${RESET}\n`);
    process.exitCode = 1;
    return;
  }

  const encrypted = encryptGCM(options.value, passphrase);
  await writeFile(join(CREDS_DIR, `${options.name}.enc`), encrypted, { encoding: 'utf-8', mode: 0o600 });
  console.log(`\n  ${GREEN}✓${RESET}  Secret "${options.name}" salvato (AES-256-GCM).\n`);
}

async function getSecret(options) {
  if (!options.name) { console.error('  --name obbligatorio'); process.exitCode = 1; return; }

  const encPath = join(CREDS_DIR, `${options.name}.enc`);
  const jsonPath = join(CREDS_DIR, `${options.name}.json`);

  if (await fileExists(encPath)) {
    const passphrase = getPassphrase();
    if (!passphrase) {
      console.error(`  Secret cifrato — imposta ${KEY_ENV} per decifrare.`);
      process.exitCode = 1;
      return;
    }
    const raw = (await readFile(encPath, 'utf-8')).trim();
    let value;
    let migrated = false;
    try {
      value = decryptGCM(raw, passphrase);
    } catch (gcmErr) {
      // Fallback: file in formato CBC legacy (`iv:ciphertext`).
      // Lo decifriamo con scrypt+salt-fisso e lo ri-scriviamo in
      // GCM, cosi' al prossimo accesso e' gia' nel formato moderno.
      try {
        value = decryptLegacyCBC(raw, passphrase);
        migrated = true;
      } catch {
        console.error('  Errore decifratura — chiave errata?');
        process.exitCode = 1;
        return;
      }
    }

    if (migrated) {
      try {
        const reEncrypted = encryptGCM(value, passphrase);
        await writeFile(encPath, reEncrypted, { encoding: 'utf-8', mode: 0o600 });
      } catch {
        // best-effort: se il rewrite fallisce, mostriamo comunque il
        // valore. Il file resta in CBC, alla prossima get ci riprovera'.
      }
    }
    console.log(value);
  } else if (await fileExists(jsonPath)) {
    const data = JSON.parse(await readFile(jsonPath, 'utf-8'));
    console.log(data.value ?? JSON.stringify(data));
  } else {
    console.error(`  Secret "${options.name}" non trovato.`);
    process.exitCode = 1;
  }
}

async function deleteSecret(options) {
  if (!options.name) { console.error('  --name obbligatorio'); process.exitCode = 1; return; }
  let deleted = false;
  for (const ext of ['.enc', '.json']) {
    const p = join(CREDS_DIR, `${options.name}${ext}`);
    if (await fileExists(p)) { await unlink(p); deleted = true; }
  }
  if (deleted) console.log(`\n  ${GREEN}✓${RESET}  Secret "${options.name}" eliminato.\n`);
  else { console.error(`  Secret "${options.name}" non trovato.`); process.exitCode = 1; }
}

export function registerSecretsCommand(program) {
  program
    .command('secrets [action]')
    .description('Gestione secrets cifrati (azioni: list, set, get, delete)')
    .option('-n, --name <name>', 'nome del secret')
    .option('-v, --value <value>', 'valore del secret (per set)')
    .action(handleSecrets);
}
