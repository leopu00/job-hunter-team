// The closed grammar of `jht agent-control`, kept apart from commander so a
// test can hold it without the CLI's dependencies.
//
// The desktop app reaches the agents' control panel through this command (the
// attested `jht` wrapper runs it in the container). It passes on exactly one
// of the shapes below, as argv, to shared/skills/agent_control.py, which
// checks everything again: no shell, no free text, nothing else.

export const AGENT_CONTROL_SCRIPT = '/app/shared/skills/agent_control.py';

// The script's own codes are 100-112 and 115-121; these two are the command's.
export const EXIT_INVALID = 100;
export const EXIT_NO_TEAM = 113;
export const EXIT_UNANSWERED = 114;

// A session the panel can name: the agents, the writer's reviewers, and the
// two scheduled ones (the script refuses an action on those with its code).
const SESSION = new RegExp(
  '^(?:CAPITANO|ASSISTENTE|MENTOR|SENTINELLA|CRITICO|DOTTORE|MANTENITORE'
  + '|(?:SCOUT|ANALISTA|SCORER|SCRITTORE|CLOSER)-[1-9][0-9]{0,3}'
  + '|CRITICO-S[1-9][0-9]{0,3})$',
);
const HOURS = /^[1-9][0-9]{0,2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const WITH_SESSION = new Set(['start', 'stop', 'restart', 'screen']);
const ALONE = new Set(['resume', 'stop-team', 'list', 'team', 'history', 'exclusions']);
// A code of the exclusions' closed vocabulary (JHT-T24-b); the script checks it against the list.
const WITH_CODE = new Set(['exclusion-accept', 'exclusion-withdraw']);
const CODE = /^[a-z][a-z_]{0,31}$/;
// The answer to an agent's structured question (JHT-T38): the question's id and one option's id,
// in the shapes agent_questions.py gives them. Never text; the script checks the option is the question's.
const QUESTION_ID = /^aq:[a-z0-9][a-z0-9_-]{0,39}:[0-9]{1,20}-[a-z0-9]{1,16}$/;
const OPTION_ID = /^(?:_rinvia|[a-z0-9][a-z0-9_]{0,23})$/;

/** The argv for the script, or null when `args` is not one of the shapes. */
export function agentControlArgv(args) {
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return null;
  const [op, ...rest] = args;
  if (WITH_SESSION.has(op)) {
    return rest.length === 1 && SESSION.test(rest[0]) ? [op, rest[0]] : null;
  }
  if (WITH_CODE.has(op)) {
    return rest.length === 1 && CODE.test(rest[0]) ? [op, rest[0]] : null;
  }
  if (op === 'answer') {
    return rest.length === 2 && QUESTION_ID.test(rest[0]) && OPTION_ID.test(rest[1]) ? [op, rest[0], rest[1]] : null;
  }
  if (ALONE.has(op)) return rest.length === 0 ? [op] : null;
  if (op !== 'pause') return null;
  if (rest.length === 1 && rest[0] === '--wake-on-weekly') return [op, '--wake-on-weekly'];
  if (rest.length !== 2) return null;
  const [flag, value] = rest;
  if (flag === '--for-hours' && HOURS.test(value) && Number(value) <= 168) return [op, flag, value];
  if (flag === '--until' && INSTANT.test(value)) return [op, flag, value];
  return null;
}

/** The command's own answer when the script could not give one. */
export function unansweredReply(result) {
  const reason = String(result?.stderr || '');
  if (/is not running|is unreachable|empty argv/.test(reason)) {
    return { code: EXIT_NO_TEAM, reply: { ok: false, error: 'agent_control_no_team' } };
  }
  return { code: EXIT_UNANSWERED, reply: { ok: false, error: 'agent_control_unanswered' } };
}
