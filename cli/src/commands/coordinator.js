// Comando `jht coordinator` — le impostazioni del Capitano da riga di comando.
//
// [JHT-CLI-AGENT-PARITY]. Il gioco ha `request_coordinator_state` e
// `save_coordinator_settings` da mesi; il CLI non aveva niente, quindi la
// modalità di lavoro — la decisione che governa cosa fa la squadra tutto il
// giorno — si poteva cambiare SOLO aprendo l'ufficio. Per un agente LLM, che
// è il pubblico dichiarato in docs/guides/AI-AGENT-INTEGRATION.md, quella
// decisione era irraggiungibile.
//
// Qui NON c'è logica di dominio: il contratto del file (enum chiuso, `search`
// = assenza del file, `orders` solo per la cura, scadenza `mode_until`) vive
// in `shared/skills/coordinator_settings.py`, che è il single-writer. Questo
// file passa gli argomenti ed eredita l'exit code, così uno script può
// verificare l'esito senza leggere il testo.

import { Command } from 'commander';
import { runSkill } from './positions.js';

const run = (args) => { process.exitCode = runSkill('coordinator_settings.py', args); };

// `--flag value` → si passano solo le opzioni davvero fornite: la skill
// distingue "non detto" (lascia com'è) da un valore esplicito, e passarle
// tutte con un default le trasformerebbe in ordini che nessuno ha dato.
function passthrough(opts, mapping) {
  const out = [];
  for (const [flag, key] of Object.entries(mapping)) {
    if (opts[key] !== undefined) out.push(flag, String(opts[key]));
  }
  return out;
}

export function registerCoordinatorCommand(program) {
  const cmd = new Command('coordinator')
    .description("Capitano settings: working mode and its orders (proxy to coordinator_settings.py)");

  cmd
    .command('show')
    .description('Current mode, its orders, the deadline and the enrichment policy')
    .option('--json', 'machine-readable output')
    .action((opts) => run(['show', ...(opts.json ? ['--json'] : [])]));

  cmd
    .command('set-mode <mode>')
    .description('search | harvest | care | calibration | saving. `search` removes the file, which IS the default')
    .option('--until <iso>', 'the mode expires then and falls back to search on its own')
    .option('--clear-until', 'remove an existing deadline')
    .option('--stop-search <bool>', 'care only')
    .option('--discard-expired <bool>', 'care only')
    .option('--cv-min-score <n>', 'care only (0-100)')
    .option('--pre-check-liveness <bool>', 'care only')
    .action((mode, opts) => run([
      'set-mode', mode,
      ...(opts.clearUntil ? ['--clear-until'] : []),
      ...passthrough(opts, {
        '--until': 'until',
        '--stop-search': 'stopSearch',
        '--discard-expired': 'discardExpired',
        '--cv-min-score': 'cvMinScore',
        '--pre-check-liveness': 'preCheckLiveness',
      }),
    ]));

  cmd
    .command('clear-until')
    .description('Remove the deadline and keep the mode running until the user changes it')
    .action(() => run(['clear-until']));

  program.addCommand(cmd);
}
