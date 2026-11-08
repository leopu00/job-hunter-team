import { handleAgents } from '../agents.js';
// Comandi team list e team status
import { marks, table, terminalWidth, title, wrapText } from '../../lib/ui.js';
import { say } from '../../lib/texts.js';
import {
  AGENTS, DEFAULT_TEAM, c,
  getActiveSessions, usingContainer, isAgentSession,
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
  return handleAgents();
}
