// Comandi team list e team status
import {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, getActiveSessions, usingContainer, isAgentSession,
} from './agents.js';

export function listAction() {
  const sessions = getActiveSessions();
  const inContainer = usingContainer();

  console.log('');
  console.log(c.bold('Agenti disponibili:'));
  console.log(c.dim(inContainer ? '  (sorgente: container jht)' : '  (sorgente: tmux host)'));
  console.log('');
  console.log(
    `  ${'Ruolo'.padEnd(14)} ${'Sessione'.padEnd(16)} ${'Tipo'.padEnd(10)} ${'Effort'.padEnd(8)} Descrizione`
  );
  console.log(`  ${'─'.repeat(14)} ${'─'.repeat(16)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(40)}`);

  for (const agent of AGENTS) {
    const prefix = inContainer ? agent.prefix : `JHT-${agent.prefix}`;
    const sName = agent.multi ? `${prefix}-N` : prefix;
    const tipo = agent.multi ? 'multiplo' : 'singolo';
    const active = sessions.some((s) => isAgentSession(s, agent));
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
  // Se il container gira, tmux sta dentro lui — non serve averlo sull'host.
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato sull\'host e container jht non attivo.'));
    console.error(c.dim('  Avvia il container con: docker compose up -d jht'));
    process.exit(1);
  }

  const sessions = getActiveSessions();
  const agentSessions = sessions.filter((s) =>
    AGENTS.some((a) => isAgentSession(s, a))
  );

  if (agentSessions.length === 0) {
    console.log('');
    console.log(c.yellow('Nessun agente attivo.'));
    console.log(c.dim('  Avvia il team con: jht team start'));
    console.log('');
    return;
  }

  console.log('');
  const source = usingContainer() ? c.dim('(container jht)') : c.dim('(host)');
  console.log(`${c.bold(`Agenti attivi: ${agentSessions.length}`)} ${source}`);
  console.log('');

  for (const s of agentSessions.sort()) {
    const agent = AGENTS.find((a) => isAgentSession(s, a));
    const desc = agent ? c.dim(agent.desc) : '';
    console.log(`  ${c.green('●')} ${s.padEnd(20)} ${desc}`);
  }

  console.log('');
}
