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
import { GREEN, RED, YELLOW, DIM, BOLD, RESET } from './_colors.js';

const SERVICE = 'jht-credentials';
const ACCOUNT_DEFAULT = 'JHT_CREDENTIALS_KEY';

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
  console.error(`\n  ${RED}✗${RESET}  ${BOLD}@napi-rs/keyring not installed.${RESET}`);
  console.error(`  ${DIM}To use the OS keyring:${RESET}`);
  console.error(`    ${BOLD}npm install -g @napi-rs/keyring${RESET}`);
  console.error(`  ${DIM}Or use env var as fallback:${RESET}`);
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
    ?? await promptHidden(`  Passphrase for ${BOLD}${account}${RESET}: `);
  if (!passphrase) {
    console.error(`  ${RED}✗${RESET}  Empty passphrase — cancelled.`);
    process.exitCode = 1;
    return;
  }
  const entry = new mod.Entry(SERVICE, account);
  entry.setPassword(passphrase);
  console.log(`\n  ${GREEN}✓${RESET}  Passphrase saved in keyring (${SERVICE}/${account}).\n`);
}

async function getEntry(options) {
  const mod = loadKeyringModule();
  if (!mod) { printInstallHint(); process.exitCode = 1; return; }
  const account = options.service?.trim() || ACCOUNT_DEFAULT;
  const entry = new mod.Entry(SERVICE, account);
  const value = entry.getPassword();
  if (!value) {
    console.error(`  ${RED}✗${RESET}  No passphrase saved for ${SERVICE}/${account}.`);
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
    console.log(`\n  ${GREEN}✓${RESET}  Entry ${SERVICE}/${account} removed.\n`);
  } else {
    console.error(`  ${YELLOW}!${RESET}  No entry to remove ${SERVICE}/${account}.`);
    process.exitCode = 1;
  }
}

async function statusEntry(options) {
  const mod = loadKeyringModule();
  const account = options.service?.trim() || ACCOUNT_DEFAULT;
  console.log(`\n  ${BOLD}JHT — Keyring status${RESET}\n`);
  console.log(`  Service:        ${SERVICE}`);
  console.log(`  Account:        ${account}`);
  console.log(`  @napi-rs/keyring installed: ${mod ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`}`);
  if (!mod) {
    console.log(`  ${DIM}Active fallback: env var JHT_CREDENTIALS_KEY (if set).${RESET}\n`);
    return;
  }
  try {
    const entry = new mod.Entry(SERVICE, account);
    const has = !!entry.getPassword();
    console.log(`  Entry present: ${has ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`}`);
  } catch (err) {
    console.log(`  ${RED}Keyring reading error:${RESET} ${err.message ?? err}`);
  }
  console.log('');
}

async function handleKeyring(action, options) {
  if (action === 'set')          return await setEntry(options);
  if (action === 'get')          return await getEntry(options);
  if (action === 'delete'
   || action === 'rm')           return await deleteEntry(options);
  if (!action || action === 'status') return await statusEntry(options);

  console.error(`  Invalid action: ${action}`);
  console.error('  Actions: status (default), set, get, delete');
  process.exitCode = 1;
}

export function registerKeyringCommand(program) {
  program
    .command('keyring [action]')
    .description('Manage the JHT_CREDENTIALS_KEY passphrase in the OS keyring (requires @napi-rs/keyring)')
    .option('-s, --service <name>', `account name (default: ${ACCOUNT_DEFAULT})`)
    .action(handleKeyring);
}
