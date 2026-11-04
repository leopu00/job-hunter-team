// Comandi team list e team status
import { errorBlock, hint, marks, table, terminalWidth, title, wrapText } from '../../lib/ui.js';
import { say } from '../../lib/texts.js';
import {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, getActiveSessions, usingContainer, isAgentSession,
} from './agents.js';

export function listAction() {
  const sessions = getActiveSessions();
  const inContainer = usingContainer();
  const m = marks();

  console.log(title(say('team.title'), say('team.roles', { n: AGENTS.length })));
  if (process.env.JHT_DEBUG) console.log(c.dim(inContainer ? '  (source: jht container)' : '  (source: tmux host)'));
  console.log(table(
    [{ label: say('team.col_role') }, { label: say('team.col_session') }, { label: say('team.col_kind'), drop: true }, { label: say('team.col_effort'), drop: true }, { label: say('team.col_does'), shrink: true, min: 24 }],
    AGENTS.map((agent) => {
      const prefix = inContainer ? agent.prefix : `JHT-${agent.prefix}`;
      const active = sessions.some((s) => isAgentSession(s, agent));
      return [
        `${active ? c.green(m.ok) : c.dim(m.info)} ${agent.role}`,
        agent.multi ? `${prefix}-N` : prefix,
        agent.multi ? say('team.several') : say('team.one'),
        agent.effort,
        agent.desc ? say(`role.${agent.role}`) : '',
      ];
    }),
  ));
  console.log('');
  for (const part of wrapText(say('team.default_team', { list: DEFAULT_TEAM.join(', ') }), terminalWidth() - 4)) console.log(`  ${c.dim(part)}`);
  console.log('');
}

export function statusAction() {
  // Se il container gira, tmux sta dentro lui — non serve averlo sull'host.
  // `process.exitCode` + `return` invece di `process.exit()`: l'exit code resta
  // 1, ma le due righe di stderr — fra cui quella che dice come rimediare —
  // fanno in tempo a uscire. Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(errorBlock({
      what: say('team.unreachable_what'),
      why: say('team.unreachable_why'),
      fix: say('team.unreachable_fix'),
    }));
    process.exitCode = 1;
    return;
  }

  const sessions = getActiveSessions();
  const agentSessions = sessions.filter((s) =>
    AGENTS.some((a) => isAgentSession(s, a))
  );

  if (agentSessions.length === 0) {
    console.log(title(say('team.title'), say('team.not_running')));
    console.log(hint(say('team.next_start')));
    console.log('');
    return;
  }

  console.log(title(say('team.title'), `${say('team.n_running', { n: agentSessions.length })}${process.env.JHT_DEBUG ? (usingContainer() ? ' (container)' : ' (host)') : ''}`));
  console.log(table(
    [{ label: say('team.col_session') }, { label: say('team.col_does'), shrink: true }],
    agentSessions.sort().map((name) => {
      const agent = AGENTS.find((a) => isAgentSession(name, a));
      return [`${c.green(marks().ok)} ${name}`, agent ? say(`role.${agent.role}`) : ''];
    }),
  ));
  console.log('');
}
