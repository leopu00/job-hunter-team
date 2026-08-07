import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';
import { GREEN, YELLOW, RED, DIM, BOLD, RESET } from './_colors.js';

const JHT_DIR    = JHT_HOME;
const NOTIF_PATH = join(JHT_DIR, 'notifications', 'notifications.json');

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

  console.error(`  Invalid action: ${action}`);
  console.error('  Actions: list, read --id <id>, clear');
  process.exitCode = 1;
}

async function listNotifications(options) {
  const store = await loadStore();
  let notifs = store.notifications ?? [];
  if (!options.all) notifs = notifs.filter(n => !n.read);

  if (notifs.length === 0) {
    console.log(`\n  ${DIM}No notification${options.all ? '' : ' not read'}.${RESET}\n`);
    return;
  }

  const total = store.notifications?.length ?? 0;
  const unread = (store.notifications ?? []).filter(n => !n.read).length;
  console.log(`\n  ${BOLD}JHT — Notifications${RESET} (${unread} unread / ${total} total)\n`);

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
    console.error('  Use --id <id> or --all to mark as read');
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
  console.log(`\n  ${count} notifications marked as read.\n`);
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
    .description('Notification management (actions: list, read, clear)')
    .option('--id <id>', 'Notification ID to mark as read')
    .option('-a, --all', 'show all / mark all as read')
    .action(handleNotifications);
}
