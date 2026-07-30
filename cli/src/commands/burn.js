// Comando burn — l'intento di spesa dell'utente, con scadenza.
//
//   jht burn status                          stato della deroga
//   jht burn on [--hours N] [--reason "…"]   deroga agli automatismi di spesa
//   jht burn off [--reason "…"]              revoca subito
//
// Gli automatismi che fermano il team (daily-halt, gate orario, WORKER_FLOOR,
// ladder) scattano sui numeri e basta: senza questo comando l'unico modo di
// dire "il budget non è un vincolo, spremete" era smontarli a mano uno per uno
// dall'esterno — e uno di loro rimetteva a posto la deroga da solo.
//
// La deroga SCADE: default 5h (una finestra), tetto 12h. Non esiste la forma
// permanente, perché ogni file creato a mano quella notte è rimasto acceso
// finché qualcuno non si è ricordato di cancellarlo.
//
// NON cede mai, nemmeno in deroga: weekly-halt (oltre, il provider non
// risponde), host_agent_cap (tetto RAM: superarlo RIDUCE la produzione), SC-09
// (una posizione per iterazione), freeze_team (ultima rete prima del lockout).
//
// Scrive dentro il container (la home del team è del suo utente), con lo stesso
// pattern di `jht wh simulate`.

import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { execScriptInContainer } from '../utils/container-proxy.js';

// Il trasporto verso il container (docker exec dall'host, esecuzione diretta
// se il CLI gira già dentro) è tutto in container-proxy.js: qui non si
// costruiscono più argv `docker`, e `--reason` arriva alla skill come
// argomento separato, senza passare da una shell.
const SKILL = '/app/shared/skills/burn_intent.py';
const INTENT_FLAG = join(JHT_HOME, '.burn-intent.flag');

// LANCIA sempre in caso di fallimento — container giù, docker assente o skill
// che esce != 0. Il fallback di sola lettura qui sotto vive su questo throw:
// se runSkill diventasse silenziosa, `burn status` smetterebbe di rispondere
// proprio quando il team è spento.
async function runSkill(args) {
  const r = execScriptInContainer(SKILL, args, { interpreter: 'python3' });
  if (!r.ok || r.code !== 0) {
    throw new Error(`rc=${r.code} ${(r.stderr || '').trim()}`.trim());
  }
  return r.stdout;
}

// Fallback di sola lettura per quando il container è giù: lo stato è comunque
// un file sul disco, e negare la risposta perché il team è spento sarebbe
// esattamente il tipo di attrito che questo comando esiste per togliere.
function readFlagLocally() {
  try {
    if (!existsSync(INTENT_FLAG)) return null;
    return JSON.parse(readFileSync(INTENT_FLAG, 'utf8'));
  } catch { return null; }
}

async function statusAction() {
  try {
    process.stdout.write(await runSkill(['status']));
    return;
  } catch (e) {
    const local = readFlagLocally();
    if (local === null) {
      console.log('BURN-INTENT off — gli automatismi di spesa sono attivi.');
      console.error(`  (container non raggiungibile: ${e.message})`);
      return;
    }
    const expires = new Date(local.expires_at);
    const active = Number.isFinite(expires.valueOf()) && expires > new Date();
    console.log(active
      ? `BURN-INTENT ATTIVO — scade ${local.expires_at} (motivo: ${local.reason || 'non indicato'})`
      : `BURN-INTENT scaduto il ${local.expires_at} — gli automatismi sono di nuovo attivi.`);
    console.error('  (letto dal file locale: container non raggiungibile)');
  }
}

async function onAction(opts) {
  const args = ['grant', '--hours', String(opts.hours ?? 5), '--by', 'user'];
  if (opts.reason) args.push('--reason', opts.reason);
  try {
    process.stdout.write(await runSkill(args));
    console.log('I bridge lo leggono al prossimo tick (≤5 min) e avvisano il Capitano.');
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error('Il container "jht" deve essere in esecuzione (jht team start).');
    process.exitCode = 1;
  }
}

async function offAction(opts) {
  const args = ['revoke'];
  if (opts.reason) args.push('--reason', opts.reason);
  try {
    process.stdout.write(await runSkill(args));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error('Il container "jht" deve essere in esecuzione (jht team start).');
    process.exitCode = 1;
  }
}

export function registerBurnCommand(program) {
  const burn = new Command('burn')
    .alias('burn-intent')
    .description('Deroga a termine agli automatismi di spesa (il budget non è un vincolo, per N ore)');

  burn
    .command('status')
    .description('Mostra se la deroga è attiva e quanto le resta')
    .action(statusAction);

  burn
    .command('on')
    .description('Concede la deroga (default 5h = una finestra, max 12h)')
    .option('--hours <n>', 'durata in ore (max 12)', '5')
    .option('--reason <text>', 'perché — finisce nei log e nel messaggio al Capitano')
    .action(onAction);

  burn
    .command('off')
    .description('Revoca subito la deroga: gli automatismi tornano attivi')
    .option('--reason <text>', 'perché (finisce nei log)')
    .action(offAction);

  program.addCommand(burn);
}
