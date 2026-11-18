import { errorBlock } from '../lib/ui.js';
import { say, show } from '../lib/texts.js';
import { budgetPauseText, onboardingSpendText, ramGuardText } from '../lib/budget-pause.js';
import { readObservation } from '../lib/agent-observation.js';
import { errorText, renderObservation } from '../lib/agent-observation-view.js';
import { appendDiagnostic } from '../lib/runtime-diagnostic.js';
import { readActiveProvider } from '../lib/agent-observation-provider.js';
import { spawnFailureTexts } from '../lib/spawn-failed.js';

export function handleAgents(options = {}, read = readObservation) {
  try {
    const snapshot = read();
    if (options.json) console.log(JSON.stringify(snapshot, null, 2));
    else {
      // the pause of the brake of pi on the budget (JHT-T322): read again at every status, the reason can change
      const pause = budgetPauseText();
      process.stdout.write(renderObservation(snapshot, { usage: Boolean(options.usage), provider: readActiveProvider(), paused: Boolean(pause) }));
      const paused = pause ?? onboardingSpendText();
      if (paused) console.log(`⚠ ${show(paused)}`);
      // the RAM guard retired workers: the Captain is told too, but a Captain held by the budget never reads it
      const ram = ramGuardText();
      if (ram) console.log(`⚠ ${show(ram)}`);
      // a role that cannot start (the Dottore, the Mantenitore): said here, not only retried in the watchdog's log
      for (const text of spawnFailureTexts()) console.log(`⚠ ${show(text)}`);
    }
    if (options.verbose && !options.json) {
      console.log(say('agents.sessions_in_tmux'));
      for (const row of snapshot.agents.filter((r) => r.running)) console.log(`  ${row.session}`);
    }
    if (!snapshot.ok) process.exitCode = 1;
  } catch (error) {
    const code = ['observer_read_failed', 'observer_read_invalid'].includes(error.message)
      ? error.message : 'observer_read_failed';
    if (options.json) console.log(JSON.stringify({ ok: false, error: code }));
    else console.error(errorBlock({ what: errorText(code), fix: say('observation.fix') }));
    try { appendDiagnostic(code); }
    catch { console.error(errorText('observer_log_unavailable')); }
    process.exitCode = 1;
  }
}

export function registerAgentsCommand(program) {
  program.command('agents').description(say('agents.description'))
    .option('-v, --verbose', say('agents.verbose'))
    .option('--usage', say('observation.usage_option'))
    .option('--json', say('option.json'))
    .action((options) => handleAgents(options));
}
