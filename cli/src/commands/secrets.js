import { readFile, writeFile, readdir, mkdir, access, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { JHT_HOME } from '../jht-paths.js';

const JHT_DIR   = JHT_HOME;
const CREDS_DIR = join(JHT_DIR, 'credentials');
const KEY_ENV   = 'JHT_SECRET_KEY';

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const DIM    = '\x1b[90m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function getEncryptionKey() {
  const passphrase = process.env[KEY_ENV];
  if (!passphrase) return null;
  return scryptSync(passphrase, 'jht-salt', 32);
}

function encrypt(text, key) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(data, key) {
  const [ivHex, encHex] = data.split(':');
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
  const key = getEncryptionKey();

  if (!key) {
    console.error(`\n  ${RED}✗${RESET}  ${BOLD}${KEY_ENV} non impostata.${RESET}`);
    console.error(`  ${DIM}I secret devono essere cifrati a riposo. Imposta una passphrase:${RESET}`);
    console.error(`    ${BOLD}export ${KEY_ENV}="<passphrase robusta>"${RESET}`);
    console.error(`  ${DIM}Salvala anche nel tuo shell rc (~/.bashrc, ~/.zshrc) per persistenza,${RESET}`);
    console.error(`  ${DIM}o in un OS keyring (Keychain/Credential Manager/SecretService).${RESET}\n`);
    process.exitCode = 1;
    return;
  }

  const encrypted = encrypt(options.value, key);
  await writeFile(join(CREDS_DIR, `${options.name}.enc`), encrypted, { encoding: 'utf-8', mode: 0o600 });
  console.log(`\n  ${GREEN}✓${RESET}  Secret "${options.name}" salvato (cifrato).\n`);
}

async function getSecret(options) {
  if (!options.name) { console.error('  --name obbligatorio'); process.exitCode = 1; return; }

  const encPath = join(CREDS_DIR, `${options.name}.enc`);
  const jsonPath = join(CREDS_DIR, `${options.name}.json`);

  if (await fileExists(encPath)) {
    const key = getEncryptionKey();
    if (!key) { console.error(`  Secret cifrato — imposta ${KEY_ENV} per decifrare.`); process.exitCode = 1; return; }
    try {
      const data = await readFile(encPath, 'utf-8');
      const value = decrypt(data.trim(), key);
      console.log(value);
    } catch { console.error('  Errore decifratura — chiave errata?'); process.exitCode = 1; }
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
