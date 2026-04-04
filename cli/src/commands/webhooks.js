import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const JHT_DIR      = join(homedir(), '.jht');
const WEBHOOKS_PATH = join(JHT_DIR, 'webhooks', 'webhooks.json');

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[90m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function loadStore() {
  try { return JSON.parse(await readFile(WEBHOOKS_PATH, 'utf-8')); }
  catch { return { webhooks: [] }; }
}

async function saveStore(store) {
  await mkdir(join(WEBHOOKS_PATH, '..'), { recursive: true });
  const tmp = WEBHOOKS_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify({ ...store, updatedAt: Date.now() }, null, 2), 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, WEBHOOKS_PATH);
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function handleWebhooks(action, options) {
  if (!action || action === 'list' || action === 'ls') return await listWebhooks();
  if (action === 'create' || action === 'add') return await createWebhook(options);
  if (action === 'delete' || action === 'rm') return await deleteWebhook(options);
  if (action === 'test') return await testWebhook(options);

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: list, create --url <url> --event <event>, delete --id <id>, test --id <id>');
  process.exitCode = 1;
}

async function listWebhooks() {
  const store = await loadStore();
  const webhooks = store.webhooks ?? [];

  console.log(`\n  ${BOLD}JHT — Webhooks${RESET} (${webhooks.length})\n`);

  if (webhooks.length === 0) {
    console.log(`  ${DIM}Nessun webhook configurato.${RESET}\n`);
    return;
  }

  for (const w of webhooks) {
    const enabled = w.enabled !== false;
    const icon = enabled ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
    const status = w.lastStatus ? (w.lastStatus < 300 ? `${GREEN}${w.lastStatus}${RESET}` : `${RED}${w.lastStatus}${RESET}`) : `${DIM}—${RESET}`;
    console.log(`  ${icon}  ${w.name ?? w.id.slice(0, 8)}`);
    console.log(`     ${DIM}URL:${RESET}    ${w.url}`);
    console.log(`     ${DIM}Evento:${RESET} ${YELLOW}${w.event}${RESET}  ${DIM}Ultimo:${RESET} ${fmtDate(w.lastTriggeredAt)}  ${DIM}Status:${RESET} ${status}`);
    console.log(`     ${DIM}ID:${RESET} ${w.id}\n`);
  }
}

async function createWebhook(options) {
  if (!options.url) { console.error('  --url obbligatorio'); process.exitCode = 1; return; }
  if (!options.event) { console.error('  --event obbligatorio (es: task.completed, agent.started, session.ended)'); process.exitCode = 1; return; }

  const store = await loadStore();
  const webhook = {
    id: randomUUID(),
    name: options.name ?? null,
    url: options.url,
    event: options.event,
    enabled: true,
    createdAt: Date.now(),
    lastTriggeredAt: null,
    lastStatus: null,
  };

  store.webhooks = store.webhooks ?? [];
  store.webhooks.push(webhook);
  await saveStore(store);

  console.log(`\n  ${GREEN}✓${RESET}  Webhook creato`);
  console.log(`     ${DIM}ID:${RESET}     ${webhook.id}`);
  console.log(`     ${DIM}URL:${RESET}    ${webhook.url}`);
  console.log(`     ${DIM}Evento:${RESET} ${webhook.event}\n`);
}

async function deleteWebhook(options) {
  if (!options.id) { console.error('  --id obbligatorio'); process.exitCode = 1; return; }
  const store = await loadStore();
  const before = (store.webhooks ?? []).length;
  store.webhooks = (store.webhooks ?? []).filter(w => w.id !== options.id);
  if (store.webhooks.length === before) { console.error(`  Webhook non trovato: ${options.id}`); process.exitCode = 1; return; }
  await saveStore(store);
  console.log(`\n  ${GREEN}✓${RESET}  Webhook eliminato: ${options.id}\n`);
}

async function testWebhook(options) {
  if (!options.id) { console.error('  --id obbligatorio'); process.exitCode = 1; return; }
  const store = await loadStore();
  const webhook = (store.webhooks ?? []).find(w => w.id === options.id);
  if (!webhook) { console.error(`  Webhook non trovato: ${options.id}`); process.exitCode = 1; return; }

  console.log(`\n  ${DIM}Test webhook → ${webhook.url}${RESET}`);
  const payload = JSON.stringify({ event: webhook.event, test: true, timestamp: new Date().toISOString() });

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'JHT-Webhook/1.0' },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    webhook.lastTriggeredAt = Date.now();
    webhook.lastStatus = res.status;
    await saveStore(store);

    if (res.ok) console.log(`  ${GREEN}✓${RESET}  Risposta: ${res.status} ${res.statusText}\n`);
    else console.log(`  ${RED}✗${RESET}  Risposta: ${res.status} ${res.statusText}\n`);
  } catch (e) {
    webhook.lastTriggeredAt = Date.now();
    webhook.lastStatus = 0;
    await saveStore(store);
    console.error(`  ${RED}✗${RESET}  Errore: ${e.message}\n`);
  }
}

export function registerWebhooksCommand(program) {
  program
    .command('webhooks [action]')
    .description('Gestione webhooks (azioni: list, create, delete, test)')
    .option('--url <url>', 'URL endpoint webhook')
    .option('--event <event>', 'evento trigger (es: task.completed)')
    .option('--name <name>', 'nome webhook (opzionale)')
    .option('--id <id>', 'ID webhook (per delete/test)')
    .action(handleWebhooks);
}
