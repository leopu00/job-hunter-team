import { handleAgents } from '../agents.js';
import { openAlertLines } from '../../lib/open-alerts.js';
import { spendNowText } from '../../lib/budget-pause.js';
// Comandi team list e team status
import { marks, table, terminalWidth, title, wrapText } from '../../lib/ui.js';
import { say, show, textLanguage } from '../../lib/texts.js';
import { roleName } from '../../../../shared/i18n/role-names.js';
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
        `${active ? c.green(m.ok) : c.dim(m.info)} ${roleName(agent.role, textLanguage())}`,
        agent.multi ? `${prefix}-N` : prefix,
        agent.multi ? say('team.several') : say('team.one'),
        agent.effort,
        agent.desc ? say(`role.${agent.role}`) : '',
      ];
    }),
  ));
  console.log('');
  for (const part of wrapText(say('team.default_team', { list: DEFAULT_TEAM.map((one) => { const [role, n] = String(one).split(':'); return n ? `${roleName(role, textLanguage())} ×${n}` : roleName(role, textLanguage()); }).join(', ') }), terminalWidth() - 4)) console.log(`  ${c.dim(part)}`);
  console.log('');
}

export async function statusAction(options = {}) {
  handleAgents({ json: Boolean(options.json) });
  if (options.json) return;
  // what the team has spent and at what rate, as the brake measured it at its last look: never the first figure told (JHT-T349)
  const spend = spendNowText();
  if (spend) console.log(`  ${show(spend)}`);
  // the alerts for the person nobody has read: on the web or Telegram only, the terminal never saw them
  for (const line of await openAlertLines()) console.log(c.yellow(`⚠ ${line}`));
}
