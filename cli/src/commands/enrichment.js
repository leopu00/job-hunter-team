// jht enrichment show | set — the switches of the Analisti's enrichments (enrichment-policy.json), from a shell.
//
// The file had no writer a person could reach: `jht coordinator show` read it, the desktop had nothing, and only
// `python3 enrichment_policy.py set` inside the container wrote it. The rules stay in that skill, the one writer; here the
// words a person types become typed values (lib/enrichment.js), the write is the skill's `apply` (all or nothing), and the
// answer, read again from the file, is said in the person's language. `--json` prints the skill's closed answer instead.
//
// Exit 0 done, 1 refused or unavailable, 2 a request this command cannot even send.
import { Command } from 'commander';
import { runSkillCaptured } from './positions.js';
import { closedPolicy, describe, lastJson, refusalText, SWITCH_KEYS, typedValue } from '../lib/enrichment.js';
import { say } from '../lib/texts.js';

const SKILL = 'enrichment_policy.py';

/** {exit, out} of `show` or `apply`: the closed policy, or a closed refusal code. */
export function runPolicy(args, input = null, run = runSkillCaptured) {
  const r = run(SKILL, args, input === null ? {} : { input });
  const answer = lastJson(r.stdout);
  if (answer && answer.ok === false && typeof answer.code === 'string') {
    return { exit: 1, refused: ['key_unknown', 'value_invalid', 'write_failed'].includes(answer.code) ? answer.code : 'policy_unavailable' };
  }
  const closed = r.code === 0 ? closedPolicy(answer) : null;
  return closed ? { exit: 0, ...closed } : { exit: 1, refused: 'policy_unavailable' };
}

function print(result, json, key = '') {
  if (json) {
    const out = result.refused ? { ok: false, code: result.refused } : { ok: true, policy: result.policy, mode: result.mode };
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } else if (result.refused) {
    process.stderr.write(`${refusalText(result.refused, key)}\n`);
  } else {
    process.stdout.write(`${describe(result)}\n`);
  }
  process.exitCode = result.exit;
}

export function registerEnrichmentCommand(program) {
  const cmd = new Command('enrichment').description(say('enrichment.description'));

  cmd.command('show')
    .description(say('enrichment.show_description'))
    .option('--json', 'machine-readable output')
    .action((opts) => print(runPolicy(['show']), opts.json));

  cmd.command('set <switch> <value>')
    .description(say('enrichment.set_description', { keys: SWITCH_KEYS.join(', ') }))
    .option('--json', 'machine-readable output')
    .action((key, raw, opts) => {
      if (!SWITCH_KEYS.includes(key)) return print({ exit: 2, refused: 'key_unknown' }, opts.json, key);
      const value = typedValue(key, raw);
      if (value === undefined) return print({ exit: 2, refused: 'value_invalid' }, opts.json, key);
      return print(runPolicy(['apply'], JSON.stringify({ [key]: value })), opts.json, key);
    });

  program.addCommand(cmd);
}
