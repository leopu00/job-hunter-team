import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { execArgvInContainer } from '../utils/container-proxy.js';

// #9 — `jht wh simulate` girava SEMPRE via `docker exec jht`, ma il wrapper
// `jht` esegue già DENTRO il container (JHT_SHELL_VIA=docker:jht): da lì non
// esiste il binario `docker` → `spawn docker ENOENT`. La scelta fra i due casi
// non si rifà più qui: la fa container-proxy.js, che è anche l'unico posto in
// cui vive la domanda «sono nel container?».

const CONFIG_FILE = join(JHT_HOME, 'jht.config.json');
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Vincoli orari (decisione utente 2026-06-19): blocchi CONTIGUI, min 4h/giorno.
const MIN_WINDOW_HOURS = 4;

// Durata in ore di un range HH:MM→HH:MM, gestendo il wrap di mezzanotte
// (es. 22:00→07:00 = 9h). Allineato a windowDurationHours di shared/config.
function windowHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let h = (eh + em / 60) - (sh + sm / 60);
  if (h <= 0) h += 24;
  return h;
}

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
    if (i < 0 || j < 0 || i > j) throw new Error(`invalid days range: "${spec}"`);
    return ALL_DAYS.slice(i, j + 1);
  }
  const list = s.split(',').map(d => d.trim()).filter(Boolean);
  for (const d of list) {
    if (!ALL_DAYS.includes(d)) throw new Error(`invalid day: "${d}"`);
  }
  return list;
}

function parseHHMMRange(spec) {
  const [start, end] = (spec || '').split('-').map(s => s.trim());
  if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) {
    throw new Error(`invalid time range: "${spec}" (expected HH:MM-HH:MM)`);
  }
  if (start === end) {
    throw new Error(`beginning and end cannot coincide ("${spec}")`);
  }
  const h = windowHours(start, end);
  if (h < MIN_WINDOW_HOURS) {
    throw new Error(
      `the block must last at least ${MIN_WINDOW_HOURS}h (currently ${h.toFixed(1)}h) — ` +
      `working hours must be contiguous and at least ${MIN_WINDOW_HOURS} hours long`,
    );
  }
  return { start, end };
}

function formatStatus(wh) {
  if (!wh || !wh.windows || wh.windows.length === 0) {
    return '🌐 24/7 (always active)';
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
    total += windowHours(w.start, w.end) * (w.days || []).length;
  }
  return Math.round(total * 10) / 10;
}

async function handleShow() {
  const cfg = await loadConfig();
  if (!cfg) {
    console.error('No configuration found. Run: jht setup');
    process.exitCode = 1; return;
  }
  const wh = cfg.team?.working_hours;
  console.log('📅 Working hours:');
  console.log(formatStatus(wh));
  console.log(`\nHours/week: ${computeHoursPerWeek(wh)}`);
}

async function handleSet(presetName) {
  const preset = PRESETS[presetName];
  if (!preset) {
    console.error(`Preset unknown: "${presetName}". Available:`);
    for (const [k, v] of Object.entries(PRESETS)) console.error(`  ${k.padEnd(10)} ${v.label}`);
    process.exitCode = 1; return;
  }

  let cfg = (await loadConfig()) || {};
  cfg.team = cfg.team || {};

  if (preset.clear) {
    delete cfg.team.working_hours;
    await saveConfig(cfg);
    console.log('✓ Working hours → 24/7 (config removed)');
    return;
  }

  cfg.team.working_hours = {
    timezone: cfg.team.working_hours?.timezone || detectLocalTz(),
    windows: [{ days: preset.days, start: preset.start, end: preset.end }],
  };
  await saveConfig(cfg);
  console.log(`✓ Working hours → ${preset.label}`);
  console.log(formatStatus(cfg.team.working_hours));
  console.log(`\nHours/week: ${computeHoursPerWeek(cfg.team.working_hours)}`);
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
  console.log('✓ Custom working hours set');
  console.log(formatStatus(cfg.team.working_hours));
  console.log(`\nHours/week: ${computeHoursPerWeek(cfg.team.working_hours)}`);
}

async function handleClear() {
  let cfg = (await loadConfig()) || {};
  if (cfg.team?.working_hours) delete cfg.team.working_hours;
  await saveConfig(cfg);
  console.log('✓ Working hours removed → team runs 24/7');
}

// La simulazione è un `import` di due moduli Python + un calcolo: sta
// abbondantemente sotto i 30s di default di execArgvInContainer, ma il
// timeout qui è esplicito perché prima non ce n'era nessuno e un container
// in avvio lento non deve tradursi in un errore criptico.
const SIMULATE_TIMEOUT_MS = 60_000;

function runPython(args) {
  const r = execArgvInContainer(['python3', ...args], { timeoutMs: SIMULATE_TIMEOUT_MS });
  if (!r.ok || r.code !== 0) {
    throw new Error(`rc=${r.code} ${(r.stderr || '').trim()}`.trim());
  }
  return r.stdout;
}

async function handleSimulate() {
  try {
    const out = runPython([
      '-c',
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
    console.log('Current target simulation (active usage + current schedule):\n');
    console.log(out);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error('Make sure the "jht" container is running (jht team start).');
    process.exitCode = 1;
  }
}

export function registerWorkingHoursCommand(program) {
  const wh = program
    .command('working-hours')
    .alias('wh')
    .description('Team working hours management (weekly budget distribution)');

  wh.command('show')
    .description('Show the working hours configured + total hours/week')
    .action(handleShow);

  wh.command('set <preset>')
    .description(`Set a preset (${Object.keys(PRESETS).join(' | ')})`)
    .action(handleSet);

  wh.command('set-custom <days> <range>')
    .description('Custom — es: jht wh set-custom mon-fri 09:00-18:00')
    .option('--tz <iana>', 'IANA timezone (default: local)')
    .action(handleSetCustom);

  wh.command('clear')
    .description('Removes working hours → team 24/7')
    .action(handleClear);

  wh.command('simulate')
    .description('Simulate the current target (requires a running container)')
    .action(handleSimulate);
}
