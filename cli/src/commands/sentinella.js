// Comando sentinella — monitoraggio rate-limit + risorse host dal CLI
//
// Sottocomandi:
//   jht sentinella status              ultimo tick (una riga formattata)
//   jht sentinella tail [-n 20]        ultimi N tick
//   jht sentinella graph [-n 40]       sparkline ASCII dell'usage
//   jht sentinella turni-fermi         turni consegnati che nessuno ha raccolto
//
// Sorgente dati: $JHT_HOME/logs/sentinel-data.jsonl (scritto dal bridge).
// Nessuna dipendenza dal container: legge direttamente il bind-mount.
//
// O-101: `turni-fermi` incrocia due sorgenti LOCALI — la coda dei turni in
// `jobs.db` e il registro degli invii in `logs/telegram-sent.jsonl` — e non
// tocca ne' rete ne' cloud. La decisione sta in `shared/agents/turn-pickup.js`
// e qui c'e' solo la lettura: cosi' la regola si collauda senza una macchina.

import { Command } from 'commander';
import { readFileSync, existsSync, statSync, watchFile } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { JHT_HOME, JHT_DB_PATH } from '../jht-paths.js';
import { c as col } from './_colors.js';
import { stalledTurns, turnPickupVerdicts } from '../../../shared/agents/turn-pickup.js';
import { BOT_ROLES, DEFAULT_BOT_ROLE } from '../lib/bot-roles.js';

const JSONL_PATH = join(JHT_HOME, 'logs', 'sentinel-data.jsonl');
const SENT_LOG_PATH = join(JHT_HOME, 'logs', 'telegram-sent.jsonl');

const STATUS_COLOR = {
  OK: col.green,
  SOTTOUTILIZZO: col.blue,
  ATTENZIONE: col.yellow,
  CRITICO: col.red,
  RESET: col.magenta,
  ANOMALIA: col.yellow,
};

function readAllTicks() {
  if (!existsSync(JSONL_PATH)) return [];
  const raw = readFileSync(JSONL_PATH, 'utf8');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

function fmtTick(t) {
  const ts = (t.ts || '').split('T')[1]?.slice(0, 8) || '??:??:??';
  const statusFn = STATUS_COLOR[t.status] || col.dim;
  const host = t.host || {};
  const hostLvl = t.host_level ? ` ${col.dim('host=' + (t.host_level || 'OK'))}` : '';
  const projection = t.projection != null ? `${Number(t.projection).toFixed(0)}%` : '-';
  const throttle = t.throttle != null ? `T${t.throttle}` : 'T?';
  const velSmooth = t.velocity_smooth != null ? `${Number(t.velocity_smooth).toFixed(1)}%/h` : '-';
  const provider = t.provider || '-';
  return (
    `${col.dim(ts)}  ${provider.padEnd(8)} ` +
    `usage=${col.bold(String(t.usage) + '%').padEnd(15)} ` +
    `${statusFn(t.status.padEnd(14))} ${throttle.padEnd(3)} ` +
    `vel=${velSmooth.padStart(8)} proj=${projection.padStart(5)} ` +
    `reset=${t.reset_at || '-'}` +
    (host.cpu_pct != null ? ` cpu=${host.cpu_pct}% ram=${host.ram_pct}%` : '') +
    hostLvl
  );
}

// ── status: ultimo tick ────────────────────────────────────────────
function statusAction() {
  const ticks = readAllTicks();
  if (!ticks.length) {
    console.log(col.yellow('No tick in the JSONL (' + JSONL_PATH + ').'));
    console.log(col.dim('  The Sentinella must be started (jht team start sentinella).'));
    return;
  }
  const last = ticks[ticks.length - 1];
  const age = Date.now() - new Date(last.ts).getTime();
  const ageStr = age < 60_000 ? `${Math.round(age / 1000)}s fa` : `${Math.round(age / 60_000)}m fa`;
  console.log('');
  console.log(`${col.bold('Latest Sentinella tick:')} ${col.dim(ageStr)}`);
  console.log('  ' + fmtTick(last));
  console.log('');
}

// ── tail: ultimi N tick + follow opzionale ────────────────────────
function tailAction(options = {}) {
  const n = parseInt(options.n ?? 20, 10);
  const ticks = readAllTicks();
  if (!ticks.length) {
    console.log(col.yellow('No tick in the JSONL.'));
    return;
  }
  const tail = ticks.slice(-n);
  console.log('');
  console.log(col.bold(`Latest ${tail.length} ticks:`));
  for (const t of tail) console.log('  ' + fmtTick(t));
  console.log('');

  if (options.follow) {
    console.log(col.dim('(follow) waiting for new tick... Ctrl-C to exit'));
    let lastSize = existsSync(JSONL_PATH) ? statSync(JSONL_PATH).size : 0;
    watchFile(JSONL_PATH, { interval: 2000 }, () => {
      try {
        const nowSize = statSync(JSONL_PATH).size;
        if (nowSize <= lastSize) return;
        const fd = readFileSync(JSONL_PATH, 'utf8');
        const newLines = fd.slice(lastSize).split(/\r?\n/).filter(Boolean);
        for (const line of newLines) {
          try { console.log('  ' + fmtTick(JSON.parse(line))); } catch { /* ignore */ }
        }
        lastSize = nowSize;
      } catch { /* ignore */ }
    });
  }
}

// ── graph: sparkline ASCII dell'usage ─────────────────────────────
function graphAction(options = {}) {
  const n = parseInt(options.n ?? 40, 10);
  const ticks = readAllTicks().slice(-n);
  if (!ticks.length) {
    console.log(col.yellow('No tick in the JSONL.'));
    return;
  }
  const usages = ticks.map((t) => Number(t.usage) || 0);
  const min = 0, max = 100;
  const bars = '▁▂▃▄▅▆▇█';
  const chart = usages.map((u) => {
    const idx = Math.min(bars.length - 1, Math.floor(((u - min) / (max - min)) * bars.length));
    return bars[idx];
  }).join('');
  const last = ticks[ticks.length - 1];
  const statusFn = STATUS_COLOR[last.status] || col.dim;

  console.log('');
  console.log(col.bold(`Usage sparkline (${ticks.length} tick):`));
  console.log('  ' + chart);
  const first = ticks[0];
  const firstTs = (first.ts || '').split('T')[1]?.slice(0, 5) || '';
  const lastTs = (last.ts || '').split('T')[1]?.slice(0, 5) || '';
  console.log('  ' + col.dim(firstTs + ' '.repeat(Math.max(0, ticks.length - 10)) + lastTs));
  console.log('');
  console.log(`  Now: ${col.bold(last.usage + '%')} ${statusFn(last.status)} T${last.throttle}  ` +
    `proj=${last.projection != null ? Math.round(last.projection) + '%' : '-'}  reset=${last.reset_at || '-'}`);
  console.log('');
}

/** Da quale bot esce un agente, e se quel bot e' suo soltanto. */
function botRoleOf(agent) {
  const role = String(agent || '').toLowerCase();
  return BOT_ROLES.includes(role)
    ? { role, exclusive: true }
    : { role: DEFAULT_BOT_ROLE, exclusive: false };
}

/** I turni dell'utente che il box ha gia' consegnato a un pane. */
function readDeliveredTurns(dbPath = JHT_DB_PATH) {
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT id AS legacyId, agent, delivered_at AS deliveredAt
           FROM pending_user_messages
          WHERE author = 'user' AND delivered_at IS NOT NULL
          ORDER BY delivered_at DESC
          LIMIT 200`
      )
      .all();
  } catch {
    // Un jobs.db piu' vecchio del codice non deve far fallire la Sentinella.
    return [];
  } finally {
    db.close();
  }
}

/** Il registro degli invii: solo metadati, nessun contenuto. */
function readSends(path = SENT_LOG_PATH) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function turniFermiAction(options = {}) {
  const input = {
    turns: readDeliveredTurns(),
    sends: readSends(),
    now: Date.now(),
    botRoleOf,
  };
  if (options.json) {
    console.log(JSON.stringify(turnPickupVerdicts(input), null, 2));
    return;
  }
  const fermi = stalledTurns(input);
  console.log('');
  if (!fermi.length) {
    console.log(col.green('Nessun turno consegnato senza presa in carico.'));
    console.log(col.dim('  Un turno e\' «fermo» solo se dopo la consegna quell\'agente non ha'));
    console.log(col.dim('  scritto nulla: chi non ha un bot suo resta indecidibile, non accusato.'));
    console.log('');
    return;
  }
  console.log(col.yellow(`${fermi.length} turno/i consegnato/i e mai raccolto/i:`));
  for (const turno of fermi) {
    console.log(`  ${col.bold(turno.agent)} · turno ${turno.legacyId}`);
  }
  console.log(col.dim('  Il testo e\' arrivato al pane, ma quell\'agente non ha scritto piu\' niente:'));
  console.log(col.dim('  il suo turno puo\' essere morto (limite di sessione) e il messaggio va rimandato.'));
  console.log('');
}

export function registerSentinellaCommand(program) {
  const sent = new Command('sentinella').description('Sentinella monitoring (rate-limit + host resources)');

  sent
    .command('status')
    .description('Show the latest Sentinella tick')
    .action(statusAction);

  sent
    .command('tail')
    .description('Show the latest N tick')
    .option('-n, --n <num>', 'number of ticks', '20')
    .option('-f, --follow', 'follow new ticks in real time', false)
    .action(tailAction);

  sent
    .command('turni-fermi')
    .description('Turni consegnati a un agente che nessuno ha raccolto')
    .option('--json', 'output completo con i verdetti di ogni turno', false)
    .action(turniFermiAction);

  sent
    .command('graph')
    .description('Sparkline ASCII dell\'usage')
    .option('-n, --n <num>', 'number of ticks to plot', '40')
    .action(graphAction);

  program.addCommand(sent);
}
