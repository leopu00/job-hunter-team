/**
 * `jht keyring` — gestione passphrase nel keyring OS.
 *
 * Subcomandi:
 *   set      Salva la passphrase JHT_CREDENTIALS_KEY nel keyring di sistema.
 *   get      Stampa la passphrase salvata (utile in script).
 *   delete   Rimuove l'entry dal keyring.
 *   status   Mostra se @napi-rs/keyring e' installato e se l'entry esiste.
 *
 * @napi-rs/keyring e' una dependency opzionale (peer): viene caricata
 * lazy via createRequire. Se non e' installata, il comando spiega
 * come aggiungerla e suggerisce l'env var come fallback.
 */
import { createRequire } from 'node:module';

const SERVICE = 'jht-credentials';
const ACCOUNT_DEFAULT = 'JHT_CREDENTIALS_KEY';

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[90m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

const requireMaybe = (() => {
  try { return createRequire(import.meta.url); } catch { return null; }
})();

function loadKeyringModule() {
  if (!requireMaybe) return null;
  try {
    const mod = requireMaybe('@napi-rs/keyring');
    if (!mod?.Entry) return null;
    return mod;
  } catch {
    return null;
  }
}

function printInstallHint() {
  console.error(`\n  ${RED}✗${RESET}  ${BOLD}@napi-rs/keyring non installato.${RESET}`);
  console.error(`  ${DIM}Per usare il keyring OS:${RESET}`);
  console.error(`    ${BOLD}npm install -g @napi-rs/keyring${RESET}`);
  console.error(`  ${DIM}Oppure usa la env var come fallback:${RESET}`);
  console.error(`    ${BOLD}export JHT_CREDENTIALS_KEY="<passphrase>"${RESET}\n`);
}

/** Prompt password con mascheramento. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(question);
    let value = '';
    if (typeof stdin.setRawMode !== 'function') {
      // Non-TTY: leggi una riga senza mask.
      stdin.once('data', (chunk) => resolve(chunk.toString().replace(/\r?\n$/, '')));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        stdin.setRawMode(false);
        process.exit(130);
      } else if (ch === '\u007f') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        value += ch;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function setEntry(options) {
  const mod = loadKeyringModule();
  if (!mod) { printInstallHint(); process.exitCode = 1; return; }
  const account = options.service?.trim() || ACCOUNT_DEFAULT;
  const passphrase = process.env.JHT_KEYRING_PASSPHRASE?.trim()
    ?? await promptHidden(`  Passphrase per ${BOLD}${account}${RESET}: `);
  if (!passphrase) {
    console.error(`  ${RED}✗${RESET}  Passphrase vuota — annullato.`);
    process.exitCode = 1;
    return;
  }
  const entry = new mod.Entry(SERVICE, account);
  entry.setPassword(passphrase);
  console.log(`\n  ${GREEN}✓${RESET}  Passphrase salvata in keyring (${SERVICE}/${account}).\n`);
}

async function getEntry(options) {
  const mod = loadKeyringModule();
  if (!mod) { printInstallHint(); process.exitCode = 1; return; }
  const account = options.service?.trim() || ACCOUNT_DEFAULT;
  const entry = new mod.Entry(SERVICE, account);
  const value = entry.getPassword();
  if (!value) {
    console.error(`  ${RED}✗${RESET}  Nessuna passphrase salvata per ${SERVICE}/${account}.`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(value + '\n');
}

async function deleteEntry(options) {
  const mod = loadKeyringModule();
  if (!mod) { printInstallHint(); process.exitCode = 1; return; }
  const account = options.service?.trim() || ACCOUNT_DEFAULT;
  const entry = new mod.Entry(SERVICE, account);
  const deleted = entry.deletePassword();
  if (deleted) {
    console.log(`\n  ${GREEN}✓${RESET}  Entry ${SERVICE}/${account} rimossa.\n`);
  } else {
    console.error(`  ${YELLOW}!${RESET}  Nessuna entry da rimuovere per ${SERVICE}/${account}.`);
    process.exitCode = 1;
  }
}

async function statusEntry(options) {
  const mod = loadKeyringModule();
  const account = options.service?.trim() || ACCOUNT_DEFAULT;
  console.log(`\n  ${BOLD}JHT — Keyring status${RESET}\n`);
  console.log(`  Service:        ${SERVICE}`);
  console.log(`  Account:        ${account}`);
  console.log(`  @napi-rs/keyring installato: ${mod ? `${GREEN}sì${RESET}` : `${RED}no${RESET}`}`);
  if (!mod) {
    console.log(`  ${DIM}Fallback attivo: env var JHT_CREDENTIALS_KEY (se settata).${RESET}\n`);
    return;
  }
  try {
    const entry = new mod.Entry(SERVICE, account);
    const has = !!entry.getPassword();
    console.log(`  Entry presente: ${has ? `${GREEN}sì${RESET}` : `${RED}no${RESET}`}`);
  } catch (err) {
    console.log(`  ${RED}Errore lettura keyring:${RESET} ${err.message ?? err}`);
  }
  console.log('');
}

async function handleKeyring(action, options) {
  if (action === 'set')          return await setEntry(options);
  if (action === 'get')          return await getEntry(options);
  if (action === 'delete'
   || action === 'rm')           return await deleteEntry(options);
  if (!action || action === 'status') return await statusEntry(options);

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: status (default), set, get, delete');
  process.exitCode = 1;
}

export function registerKeyringCommand(program) {
  program
    .command('keyring [action]')
    .description('Gestione passphrase JHT_CREDENTIALS_KEY nel keyring OS (richiede @napi-rs/keyring)')
    .option('-s, --service <name>', `account name (default: ${ACCOUNT_DEFAULT})`)
    .action(handleKeyring);
}
