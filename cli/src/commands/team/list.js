// Comandi team list e team status
import { AGENTS, DEFAULT_TEAM, c, tmuxAvailable, getActiveSessions } from './agents.js';

export function listAction() {
  const sessions = getActiveSessions();

  console.log('');
  console.log(c.bold('Agenti disponibili:'));
  console.log('');
  console.log(
    `  ${'Ruolo'.padEnd(14)} ${'Sessione'.padEnd(16)} ${'Tipo'.padEnd(10)} ${'Effort'.padEnd(8)} Descrizione`
  );
  console.log(`  ${'─'.repeat(14)} ${'─'.repeat(16)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(40)}`);

  for (const agent of AGENTS) {
    const sName = agent.multi ? `${agent.prefix}-N` : agent.prefix;
    const tipo = agent.multi ? 'multiplo' : 'singolo';
    const active = sessions.some((s) => s.startsWith(agent.prefix));
    const status = active ? c.green('●') : c.dim('○');
    console.log(
      `  ${status} ${agent.role.padEnd(12)} ${sName.padEnd(16)} ${tipo.padEnd(10)} ${agent.effort.padEnd(8)} ${agent.desc}`
    );
  }

  console.log('');
  console.log(c.dim('  Team default: ' + DEFAULT_TEAM.join(', ')));
  console.log('');
}

export function statusAction() {
  if (!tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato.'));
    process.exit(1);
  }

  const sessions = getActiveSessions();
  const agentSessions = sessions.filter((s) =>
    AGENTS.some((a) => s === a.prefix || s.startsWith(a.prefix + '-'))
  );

  if (agentSessions.length === 0) {
    console.log('');
    console.log(c.yellow('Nessun agente attivo.'));
    console.log(c.dim('  Avvia il team con: jht team start'));
    console.log('');
    return;
  }

  console.log('');
  console.log(c.bold(`Agenti attivi: ${agentSessions.length}`));
  console.log('');

  for (const s of agentSessions.sort()) {
    const agent = AGENTS.find((a) => s === a.prefix || s.startsWith(a.prefix + '-'));
    const desc = agent ? c.dim(agent.desc) : '';
    console.log(`  ${c.green('●')} ${s.padEnd(20)} ${desc}`);
  }

  console.log('');
}
