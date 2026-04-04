import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const JHT_DIR    = join(homedir(), '.jht');
const NOTIF_PATH = join(JHT_DIR, 'notifications', 'notifications.json');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const LEVEL_COLOR = { info: GREEN, warning: YELLOW, error: RED, success: GREEN };

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function loadStore() {
  try { return JSON.parse(await readFile(NOTIF_PATH, 'utf-8')); }
  catch { return { notifications: [] }; }
}

async function saveStore(store) {
  await mkdir(join(NOTIF_PATH, '..'), { recursive: true }).catch(() => {});
  const tmp = NOTIF_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify({ ...store, updatedAt: Date.now() }, null, 2), 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, NOTIF_PATH);
}

function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const diff = Math.floor((now.getTime() - ms) / 86400000);
  if (diff === 0) return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'ieri';
  if (diff < 7) return `${diff}g fa`;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}

async function handleNotifications(action, options) {
  if (!action || action === 'list' || action === 'ls') return await listNotifications(options);
  if (action === 'read') return await markRead(options);
  if (action === 'clear') return await clearNotifications();

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: list, read --id <id>, clear');
  process.exitCode = 1;
}

async function listNotifications(options) {
  const store = await loadStore();
  let notifs = store.notifications ?? [];
  if (!options.all) notifs = notifs.filter(n => !n.read);

  if (notifs.length === 0) {
    console.log(`\n  ${DIM}Nessuna notifica${options.all ? '' : ' non letta'}.${RESET}\n`);
    return;
  }

  const total = store.notifications?.length ?? 0;
  const unread = (store.notifications ?? []).filter(n => !n.read).length;
  console.log(`\n  ${BOLD}JHT — Notifiche${RESET} (${unread} non lette / ${total} totali)\n`);

  for (const n of notifs.slice(-50).reverse()) {
    const color = LEVEL_COLOR[n.level] ?? DIM;
    const readIcon = n.read ? `${DIM}○${RESET}` : `${color}●${RESET}`;
    const time = fmtDate(n.timestamp ?? n.createdAt);
    console.log(`  ${readIcon}  ${color}${(n.title ?? n.message ?? '').slice(0, 60)}${RESET}`);
    if (n.detail) console.log(`     ${DIM}${n.detail.slice(0, 80)}${RESET}`);
    console.log(`     ${DIM}${time}${n.channel ? ` · ${n.channel}` : ''}${n.id ? ` · ${n.id.slice(0, 8)}` : ''}${RESET}`);
  }
  console.log('');
}

async function markRead(options) {
  if (!options.id && !options.all) {
    console.error('  Usa --id <id> o --all per segnare come lette');
    process.exitCode = 1;
    return;
  }

  const store = await loadStore();
  let count = 0;
  for (const n of store.notifications ?? []) {
    if (n.read) continue;
    if (options.all || n.id === options.id) { n.read = true; n.readAt = Date.now(); count++; }
  }

  await saveStore(store);
  console.log(`\n  ${count} notifiche segnate come lette.\n`);
}

async function clearNotifications() {
  const store = await loadStore();
  const count = store.notifications?.length ?? 0;
  store.notifications = [];
  await saveStore(store);
  console.log(`\n  ${count} notifiche eliminate.\n`);
}

export function registerNotificationsCommand(program) {
  program
    .command('notifications [action]')
    .alias('notif')
    .description('Gestione notifiche (azioni: list, read, clear)')
    .option('--id <id>', 'ID notifica da segnare come letta')
    .option('-a, --all', 'mostra tutte / segna tutte come lette')
    .action(handleNotifications);
}
