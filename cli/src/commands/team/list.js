// Comandi team list e team status
import { errorBlock, hint, marks, table, terminalWidth, title, wrapText } from '../../lib/ui.js';
import {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, getActiveSessions, usingContainer, isAgentSession,
} from './agents.js';

export function listAction() {
  const sessions = getActiveSessions();
  const inContainer = usingContainer();
  const m = marks();

  console.log(title('Team', `${AGENTS.length} roles`));
  if (process.env.JHT_DEBUG) console.log(c.dim(inContainer ? '  (source: jht container)' : '  (source: tmux host)'));
  console.log(table(
    [{ label: 'Role' }, { label: 'Session' }, { label: 'Kind', drop: true }, { label: 'Effort', drop: true }, { label: 'What it does', shrink: true, min: 24 }],
    AGENTS.map((agent) => {
      const prefix = inContainer ? agent.prefix : `JHT-${agent.prefix}`;
      const active = sessions.some((s) => isAgentSession(s, agent));
      return [
        `${active ? c.green(m.ok) : c.dim(m.info)} ${agent.role}`,
        agent.multi ? `${prefix}-N` : prefix,
        agent.multi ? 'several' : 'one',
        agent.effort,
        agent.desc,
      ];
    }),
  ));
  console.log('');
  for (const part of wrapText('Default team: ' + DEFAULT_TEAM.join(', '), terminalWidth() - 4)) console.log(`  ${c.dim(part)}`);
  console.log('');
}

export function statusAction() {
  // Se il container gira, tmux sta dentro lui — non serve averlo sull'host.
  // `process.exitCode` + `return` invece di `process.exit()`: l'exit code resta
  // 1, ma le due righe di stderr — fra cui quella che dice come rimediare —
  // fanno in tempo a uscire. Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(errorBlock({
      what: 'the team cannot be reached',
      why: 'tmux was not found on this computer and the jht container is not running',
      fix: 'Start it with: jht up',
    }));
    process.exitCode = 1;
    return;
  }

  const sessions = getActiveSessions();
  const agentSessions = sessions.filter((s) =>
    AGENTS.some((a) => isAgentSession(s, a))
  );

  if (agentSessions.length === 0) {
    console.log(title('Team', 'not running'));
    console.log(hint('Start the team with: jht team start'));
    console.log('');
    return;
  }

  console.log(title('Team', `${agentSessions.length} running${process.env.JHT_DEBUG ? (usingContainer() ? ' (container)' : ' (host)') : ''}`));
  console.log(table(
    [{ label: 'Session' }, { label: 'What it does', shrink: true }],
    agentSessions.sort().map((name) => {
      const agent = AGENTS.find((a) => isAgentSession(name, a));
      return [`${c.green(marks().ok)} ${name}`, agent ? agent.desc : ''];
    }),
  ));
  console.log('');
}
