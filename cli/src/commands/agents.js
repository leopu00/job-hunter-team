import { errorBlock } from '../lib/ui.js';
import { say, show } from '../lib/texts.js';
import { onboardingSpendText, quotaWallText, ramGuardText, spendNow, teamPause, teamPauseText } from '../lib/budget-pause.js';
import { hostWhere } from '../lib/host-where.js';
import { toolsSwitch } from '../lib/tools-switch.js';
import { readObservation } from '../lib/agent-observation.js';
import { errorText, renderObservation } from '../lib/agent-observation-view.js';
import { appendDiagnostic } from '../lib/runtime-diagnostic.js';
import { readActiveProvider } from '../lib/agent-observation-provider.js';
import { spawnFailureTexts } from '../lib/spawn-failed.js';

/**
 * `--json` is what the Assistente reads for the state of the team (JHT-T354): the sessions stay open in a pause, so the pause
 * (of the budget, of the person, technical; null when the team works), the spending the brake measured last and
 * where the team runs are in it, from the same files the text of `jht team status` reads.
 */
export function handleAgents(options = {}, read = readObservation, { pauseOf = teamPause, whereOf = hostWhere, spendOf = spendNow, switchOf = toolsSwitch } = {}) {
  try {
    const snapshot = read();
    if (options.json) {
      const moving = switchOf();
      console.log(JSON.stringify({ ...snapshot, pause: pauseOf() ?? null, spend_now: spendOf() ?? null, where: whereOf(),
        tools_switch: moving ? { at: new Date(moving.at * 1000).toISOString() } : null }, null, 2));
    }
    else {
      // the pause of the team (the brake of pi on the budget JHT-T322, the person, a technical standby): read again at every status
      const pause = teamPauseText();
      // the switch of the tools (JHT-T346): the core team is stopped and the full one is starting, for a couple of minutes. «No agent»
      // read as a team that died; it is said as what it is.
      if (switchOf() && !snapshot.running) console.log(`⏳ ${say('agents.tools_switching')}`);
      else process.stdout.write(renderObservation(snapshot, { usage: Boolean(options.usage), provider: readActiveProvider(), paused: Boolean(pause) }));
      const paused = pause ?? onboardingSpendText();
      if (paused) console.log(`⚠ ${show(paused)}`);
      // the RAM guard retired workers: the Captain is told too, but a Captain held by the budget never reads it
      const ram = ramGuardText();
      if (ram) console.log(`⚠ ${show(ram)}`);
      // the quota of the subscription is spent: the team is paused and says when it resumes
      const quota = quotaWallText();
      if (quota) console.log(`⚠ ${show(quota)}`);
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
