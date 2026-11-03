import { execSync } from 'node:child_process';
import { c } from './_colors.js';
import { hint, marks, table, title } from '../lib/ui.js';

const AGENTS = [
  { id: 'capitano',   name: 'Capitano',   session: 'CAPITANO' },
  { id: 'scout',      name: 'Scout',      session: 'SCOUT-1' },
  { id: 'analista',   name: 'Analista',   session: 'ANALISTA-1' },
  { id: 'scorer',     name: 'Scorer',     session: 'SCORER-1' },
  { id: 'scrittore',  name: 'Scrittore',  session: 'SCRITTORE-1' },
  { id: 'critico',    name: 'Critico',    session: 'CRITICO' },
  { id: 'assistente', name: 'Assistente', session: 'ASSISTENTE' },
];

function getTmuxSessions() {
  try {
    return execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      .trim().split('\n').filter(Boolean);
  } catch { return []; }
}

/**
 * The agents and whether each one runs. (There used to be a "Task" column fed by tasks.json, a store nobody has
 * written since the text interface was removed: it was always a dash, and it is gone.)
 */
function handleAgents(options) {
  const sessions = getTmuxSessions();
  const rows = AGENTS.map((a) => ({ ...a, running: sessions.includes(a.session) }));
  const running = rows.filter((a) => a.running);

  if (options.json) {
    console.log(JSON.stringify({ running: running.length, total: rows.length, agents: rows.map(({ id, name, session, running: r }) => ({ id, name, session, running: r })) }, null, 2));
    return;
  }

  console.log(title('Agents', `${running.length} of ${rows.length} running`));
  const m = marks();
  console.log(table(
    [{ label: 'Agent' }, { label: 'Session' }, { label: 'State' }],
    rows.map((a) => [
      `${a.running ? c.green(m.ok) : c.gray(m.info)} ${a.name}`,
      a.session,
      a.running ? c.green('running') : c.gray('stopped'),
    ]),
  ));
  if (running.length === 0) {
    console.log('');
    console.log(hint('Start the team with: jht team start'));
  }
  if (options.verbose && running.length > 0) {
    console.log(`\n  ${c.gray('Session names in tmux:')}`);
    for (const s of sessions.filter((x) => AGENTS.some((a) => a.session === x))) console.log(`    ${s}`);
  }
  console.log('');
}

export function registerAgentsCommand(program) {
  program
    .command('agents')
    .description('List the agents and whether each one is running')
    .option('-v, --verbose', 'show the tmux session names')
    .option('--json', 'machine-readable output')
    .action(handleAgents);
}
