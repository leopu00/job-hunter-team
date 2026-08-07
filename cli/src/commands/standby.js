// Comando standby — standby a SPESA ZERO del team, con condizione di uscita.
//
//   jht standby status                                  stato dello standby
//   jht standby on --reason "…" [--until <iso> | --wake-on-weekly [pct]]
//   jht standby off                                     esce subito (flag via, poi [RIPRENDI])
//
// Perché esiste: misurato in produzione il 2026-07-29, con TUTTI i worker a
// throttle=3600s e zero posizioni prodotte il weekly saliva comunque di ~2
// punti l'ora — la spesa residua sono i ruoli CORE e i tre bridge, che nessuna
// leva di pacing tocca. Lo standby li silenzia TUTTI, senza perdere la
// sveglia: i bridge continuano a LEGGERE la quota (non costa un turno di
// modello) e il sentinel-bridge risveglia il team quando la condizione di
// uscita è soddisfatta.
//
// La condizione di uscita è OBBLIGATORIA: uno standby senza condizione di
// uscita non si scrive (è il flag dimenticato-acceso che .burn-intent.flag
// esiste per non riprodurre). Il caso principale è `--wake-on-weekly`:
// «riaccenditi quando il weekly scende sotto il 100%», cioè al reset.
//
// `halted` vince su tutto: con .team-halted.flag presente, uscire dallo
// standby NON fa ripartire il team — lo stop dell'utente non è negoziabile.
//
// Scrive dentro il container (la home del team è del suo utente), con lo
// stesso pattern di `jht burn`.

import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { execScriptInContainer } from '../utils/container-proxy.js';

// Stesso trasporto di burn.js: container-proxy.js decide da solo se serve
// `docker exec` o se il CLI gira già dentro al container.
const SKILL = '/app/shared/skills/standby.py';
const STANDBY_FLAG = join(JHT_HOME, '.team-standby.flag');

// LANCIA sempre in caso di fallimento: il fallback di sola lettura di
// `standby status` dipende da questo throw (vedi burn.js).
async function runSkill(args) {
  const r = execScriptInContainer(SKILL, args, { interpreter: 'python3' });
  if (!r.ok || r.code !== 0) {
    throw new Error(`rc=${r.code} ${(r.stderr || '').trim()}`.trim());
  }
  return r.stdout;
}

// Fallback di sola lettura per quando il container è giù: lo stato è comunque
// un file sul disco (stessa cortesia di burn.js).
function readFlagLocally() {
  try {
    if (!existsSync(STANDBY_FLAG)) return null;
    return JSON.parse(readFileSync(STANDBY_FLAG, 'utf8'));
  } catch { return null; }
}

async function statusAction() {
  try {
    process.stdout.write(await runSkill(['status']));
    return;
  } catch (e) {
    const local = readFlagLocally();
    if (local === null) {
      console.log('STANDBY off — the team operates normally.');
      console.error(`  (container not reachable: ${e.message})`);
      return;
    }
    const cond = local.until
      ? `until ${local.until}`
      : (local.wake_on?.weekly_below != null
        ? `wake when weekly usage is below ${local.wake_on.weekly_below}%`
        : 'NO exit condition (invalid flag)');
    console.log(`STANDBY ACTIVE — ${cond} (reason: ${local.reason || 'not specified'}).`);
    console.error('  (read from the local file: container unreachable)');
  }
}

async function onAction(opts) {
  // La regola vale anche qui, PRIMA di toccare il container: uno standby senza
  // condizione di uscita non si scrive. `--wake-on-weekly` senza valore usa la
  // soglia 100 (= riaccenditi al reset del provider), il caso dell'incidente.
  if (!opts.until && opts.wakeOnWeekly === undefined) {
    console.error('✗ A standby without exit condition is not written.');
    console.error('  Specify --until <iso> for timed standby or --wake-on-weekly [pct].');
    console.error('  (Wake when weekly usage falls below pct; default 100 means after reset.)');
    process.exitCode = 1;
    return;
  }
  const args = ['on', '--by', 'user'];
  if (opts.reason) args.push('--reason', opts.reason);
  if (opts.until) args.push('--until', opts.until);
  if (opts.wakeOnWeekly !== undefined) {
    args.push('--wake-on-weekly');
    if (opts.wakeOnWeekly !== true) args.push(String(opts.wakeOnWeekly));
  }
  try {
    process.stdout.write(await runSkill(args));
    console.log('Bridge monitoring remains active; sentinel-bridge will wake the team.');
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error('The container "jht" must be running (jht team start).');
    process.exitCode = 1;
  }
}

async function offAction(opts) {
  const args = ['off'];
  if (opts.reason) args.push('--reason', opts.reason);
  try {
    process.stdout.write(await runSkill(args));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error('The container "jht" must be running (jht team start).');
    process.exitCode = 1;
  }
}

export function registerStandbyCommand(program) {
  const standby = new Command('standby')
    .description('Zero-spend standby: stop core roles while bridge monitoring remains active');

  standby
    .command('status')
    .description('Show if standby is active and with what exit condition')
    .action(statusAction);

  standby
    .command('on')
    .description('Enter standby (an exit condition is required)')
    .option('--reason <text>', 'reason recorded in logs and agent messages')
    .option('--until <iso>', 'timed standby: wake at this ISO-8601 time')
    .option('--wake-on-weekly [pct]', 'wake when weekly usage falls below pct (default: 100, at reset)')
    .action(onAction);

  standby
    .command('off')
    .description('He comes out immediately from standby: flag away, then [RIPRENDI] to all (halted wins)')
    .option('--reason <text>', 'reason recorded in logs')
    .action(offAction);

  program.addCommand(standby);
}
