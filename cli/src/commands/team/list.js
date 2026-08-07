// Comandi team list e team status
import {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, getActiveSessions, usingContainer, isAgentSession,
} from './agents.js';

export function listAction() {
  const sessions = getActiveSessions();
  const inContainer = usingContainer();

  console.log('');
  console.log(c.bold('Agents available:'));
  console.log(c.dim(inContainer ? '  (source: jht container)' : '  (source: tmux host)'));
  console.log('');
  console.log(
    `  ${'Role'.padEnd(14)} ${'Session'.padEnd(16)} ${'Type'.padEnd(10)} ${'Effort'.padEnd(8)} Description`
  );
  console.log(`  ${'─'.repeat(14)} ${'─'.repeat(16)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(40)}`);

  for (const agent of AGENTS) {
    const prefix = inContainer ? agent.prefix : `JHT-${agent.prefix}`;
    const sName = agent.multi ? `${prefix}-N` : prefix;
    const tipo = agent.multi ? 'multiple' : 'single';
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
  // `process.exitCode` + `return` invece di `process.exit()`: l'exit code resta
  // 1, ma le due righe di stderr — fra cui quella che dice come rimediare —
  // fanno in tempo a uscire. Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Error: tmux was not found on the host and the jht container is not active.'));
    console.error(c.dim('  Start the container with: docker compose up -d jht'));
    process.exitCode = 1;
    return;
  }

  const sessions = getActiveSessions();
  const agentSessions = sessions.filter((s) =>
    AGENTS.some((a) => isAgentSession(s, a))
  );

  if (agentSessions.length === 0) {
    console.log('');
    console.log(c.yellow('No active agent.'));
    console.log(c.dim('  Start the team with: jht team start'));
    console.log('');
    return;
  }

  console.log('');
  const source = usingContainer() ? c.dim('(container jht)') : c.dim('(host)');
  console.log(`${c.bold(`Active agents: ${agentSessions.length}`)} ${source}`);
  console.log('');

  for (const s of agentSessions.sort()) {
    const agent = AGENTS.find((a) => isAgentSession(s, a));
    const desc = agent ? c.dim(agent.desc) : '';
    console.log(`  ${c.green('●')} ${s.padEnd(20)} ${desc}`);
  }

  console.log('');
}
