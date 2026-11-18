// jht enrichment show | set — the switches of the Analisti's enrichments (enrichment-policy.json), from a shell.
//
// The file had no writer a person could reach: `jht coordinator show` read it, the desktop had nothing, and only
// `python3 enrichment_policy.py set` inside the container wrote it. The rules stay in that skill, the one writer; here the
// words a person types become typed values (lib/enrichment.js), the write is the skill's `apply` (all or nothing), and the
// answer, read again from the file, is said in the person's language. `--json` prints the skill's closed answer instead.
//
// Turning a switch toward the dearer side first says what it costs more («about X $ more per position: with 50 positions a day that is about Y $ a day»,
// from the costs the team sends with `show`) and asks to confirm; `--yes` confirms beforehand, and without a terminal to ask
// on the change is refused with that same sentence (code confirm_needed), never made unasked.
//
// Exit 0 done or cancelled, 1 refused or unavailable, 2 a request this command cannot even send.
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { runSkillCaptured } from './positions.js';
import { closedPolicy, costText, describe, extraCost, lastJson, refusalText, SWITCH_KEYS, typedValue } from '../lib/enrichment.js';
import { say, textLanguage } from '../lib/texts.js';

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

/** The value of a dotted key in a closed policy. */
const current = (policy, key) => key.split('.').reduce((node, name) => node?.[name], policy);

/** The yes of the person: the first word of `enrichment.confirm_yes` that the answer starts with, in any case. */
export function isYes(answer, language = textLanguage()) {
  const word = String(answer ?? '').trim().toLowerCase();
  return word !== '' && say('enrichment.confirm_yes', {}, language).split(',').some((yes) => yes.trim() === word);
}

async function askYes(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return isYes(await rl.question(`${question} `));
  } finally {
    rl.close();
  }
}

/**
 * `jht enrichment set`: {exit, ...} after the cost, when there is one, was confirmed. `ask` asks the person (null: no terminal).
 * The cost is read from the team's own answer, so it is the team's table, not one of this machine.
 */
export async function setSwitch(key, value, { yes = false, ask = null, run = runSkillCaptured } = {}) {
  const before = runPolicy(['show'], null, run);
  if (before.refused) return before;
  const cost = extraCost(key, current(before.policy, key), value, before.costs);
  if (cost && !yes) {
    const sentence = costText(key, cost, textLanguage());
    if (!ask) return { exit: 1, refused: 'confirm_needed', cost, sentence };
    if (!(await ask(`${sentence}\n${say('enrichment.confirm_question')}`))) return { exit: 0, cancelled: true };
  }
  return runPolicy(['apply'], JSON.stringify({ [key]: value }), run);
}

function print(result, json, key = '') {
  if (json) {
    const out = result.refused
      ? { ok: false, code: result.refused, ...(result.cost ? { cost: result.cost } : {}) }
      : result.cancelled ? { ok: false, code: 'cancelled' } : { ok: true, policy: result.policy, mode: result.mode };
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } else if (result.refused === 'confirm_needed') {
    process.stderr.write(`${result.sentence}\n${say('enrichment.confirm_needed')}\n`);
  } else if (result.refused) {
    process.stderr.write(`${refusalText(result.refused, key)}\n`);
  } else if (result.cancelled) {
    process.stdout.write(`${say('enrichment.cancelled')}\n`);
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
    .option('--yes', say('enrichment.yes_option'))
    .option('--json', 'machine-readable output')
    .action(async (key, raw, opts) => {
      if (!SWITCH_KEYS.includes(key)) return print({ exit: 2, refused: 'key_unknown' }, opts.json, key);
      const value = typedValue(key, raw);
      if (value === undefined) return print({ exit: 2, refused: 'value_invalid' }, opts.json, key);
      const ask = !opts.json && process.stdin.isTTY && process.stdout.isTTY ? askYes : null;
      return print(await setSwitch(key, value, { yes: Boolean(opts.yes), ask }), opts.json, key);
    });

  program.addCommand(cmd);
}
