import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { JHT_HOME } from '../jht-paths.js';

const CONFIG_FILE = join(JHT_HOME, 'jht.config.json');
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const PRESETS = {
  office:   { label: '💼 Office hours',  days: ['mon','tue','wed','thu','fri'], start: '09:00', end: '18:00' },
  weekend:  { label: '🌴 Weekend only',  days: ['sat','sun'],                   start: '09:00', end: '18:00' },
  daytime:  { label: '☀️ Every day',     days: ALL_DAYS,                        start: '09:00', end: '18:00' },
  night:    { label: '🌙 Night shift',   days: ALL_DAYS,                        start: '22:00', end: '07:00' },
  '24-7':   { label: '🌐 24/7 (always)', clear: true },
};

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf-8'));
  } catch { return null; }
}

async function saveConfig(cfg) {
  await mkdir(JHT_HOME, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

function detectLocalTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}

function parseDayList(spec) {
  const s = (spec || '').toLowerCase().trim();
  if (s === 'all' || s === 'every-day') return ALL_DAYS;
  // mon-fri | sat-sun | mon,wed,fri | mon
  if (s.includes('-')) {
    const [a, b] = s.split('-');
    const i = ALL_DAYS.indexOf(a), j = ALL_DAYS.indexOf(b);
    if (i < 0 || j < 0 || i > j) throw new Error(`range giorni invalido: "${spec}"`);
    return ALL_DAYS.slice(i, j + 1);
  }
  const list = s.split(',').map(d => d.trim()).filter(Boolean);
  for (const d of list) {
    if (!ALL_DAYS.includes(d)) throw new Error(`giorno invalido: "${d}"`);
  }
  return list;
}

function parseHHMMRange(spec) {
  const [start, end] = (spec || '').split('-').map(s => s.trim());
  if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) {
    throw new Error(`range orario invalido: "${spec}" (atteso HH:MM-HH:MM)`);
  }
  return { start, end };
}

function formatStatus(wh) {
  if (!wh || !wh.windows || wh.windows.length === 0) {
    return '🌐 24/7 (sempre attivo)';
  }
  const tz = wh.timezone || 'UTC';
  const lines = [`tz=${tz}`];
  for (const w of wh.windows) {
    const days = (w.days || []).join(',');
    lines.push(`  • ${days}  ${w.start} → ${w.end}`);
  }
  return lines.join('\n');
}

function computeHoursPerWeek(wh) {
  if (!wh || !wh.windows || !wh.windows.length) return 168;
  let total = 0;
  for (const w of wh.windows) {
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    let h = (eh + em / 60) - (sh + sm / 60);
    if (h <= 0) h += 24; // wrap
    total += h * (w.days || []).length;
  }
  return Math.round(total * 10) / 10;
}

async function handleShow() {
  const cfg = await loadConfig();
  if (!cfg) {
    console.error('Nessuna configurazione trovata. Esegui: jht setup');
    process.exitCode = 1; return;
  }
  const wh = cfg.team?.working_hours;
  console.log('📅 Working hours:');
  console.log(formatStatus(wh));
  console.log(`\nOre/sett: ${computeHoursPerWeek(wh)}`);
}

async function handleSet(presetName) {
  const preset = PRESETS[presetName];
  if (!preset) {
    console.error(`Preset sconosciuto: "${presetName}". Disponibili:`);
    for (const [k, v] of Object.entries(PRESETS)) console.error(`  ${k.padEnd(10)} ${v.label}`);
    process.exitCode = 1; return;
  }

  let cfg = (await loadConfig()) || {};
  cfg.team = cfg.team || {};

  if (preset.clear) {
    delete cfg.team.working_hours;
    await saveConfig(cfg);
    console.log('✓ Working hours → 24/7 (config rimosso)');
    return;
  }

  cfg.team.working_hours = {
    timezone: cfg.team.working_hours?.timezone || detectLocalTz(),
    windows: [{ days: preset.days, start: preset.start, end: preset.end }],
  };
  await saveConfig(cfg);
  console.log(`✓ Working hours → ${preset.label}`);
  console.log(formatStatus(cfg.team.working_hours));
  console.log(`\nOre/sett: ${computeHoursPerWeek(cfg.team.working_hours)}`);
}

async function handleSetCustom(daysSpec, rangeSpec, opts) {
  let days, start, end;
  try {
    days = parseDayList(daysSpec);
    ({ start, end } = parseHHMMRange(rangeSpec));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1; return;
  }
  let cfg = (await loadConfig()) || {};
  cfg.team = cfg.team || {};
  cfg.team.working_hours = {
    timezone: opts?.tz || cfg.team.working_hours?.timezone || detectLocalTz(),
    windows: [{ days, start, end }],
  };
  await saveConfig(cfg);
  console.log('✓ Working hours custom impostate');
  console.log(formatStatus(cfg.team.working_hours));
  console.log(`\nOre/sett: ${computeHoursPerWeek(cfg.team.working_hours)}`);
}

async function handleClear() {
  let cfg = (await loadConfig()) || {};
  if (cfg.team?.working_hours) delete cfg.team.working_hours;
  await saveConfig(cfg);
  console.log('✓ Working hours rimosse → team 24/7');
}

function dockerExec(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', ['exec', 'jht', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => {
      if (code !== 0) reject(new Error(`docker exec rc=${code} ${err}`));
      else resolve(out);
    });
  });
}

async function handleSimulate() {
  try {
    const out = await dockerExec([
      'python3', '-c',
      `import sys,json
sys.path.insert(0,'/app/shared/skills')
import work_hours_target as wht, provider_capacity as pcap
from datetime import datetime, timedelta, timezone
now = datetime.now(timezone.utc)
ws = now.replace(minute=0, second=0, microsecond=0)
we = ws + timedelta(hours=5)
ratio = pcap.get_window_cap_pct_of_weekly()
r = wht.compute_target(now, ws, we, ratio)
r['provider_active'] = pcap.read_active_provider()
r['ratio_used'] = ratio
print(json.dumps(r, indent=2, default=str))`,
    ]);
    console.log('🧪 Simulazione target corrente (provider attivo + schedule attuale):\n');
    console.log(out);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error('Assicurati che il container "jht" sia in esecuzione (jht team start).');
    process.exitCode = 1;
  }
}

export function registerWorkingHoursCommand(program) {
  const wh = program
    .command('working-hours')
    .alias('wh')
    .description('Gestione orari di lavoro del team (distribuzione weekly budget)');

  wh.command('show')
    .description('Mostra le working hours configurate + ore/sett totali')
    .action(handleShow);

  wh.command('set <preset>')
    .description(`Imposta un preset (${Object.keys(PRESETS).join(' | ')})`)
    .action(handleSet);

  wh.command('set-custom <days> <range>')
    .description('Custom — es: jht wh set-custom mon-fri 09:00-18:00')
    .option('--tz <iana>', 'timezone IANA (default: locale)')
    .action(handleSetCustom);

  wh.command('clear')
    .description('Rimuove le working hours → team 24/7')
    .action(handleClear);

  wh.command('simulate')
    .description('Simula target attuale (richiede container running)')
    .action(handleSimulate);
}
