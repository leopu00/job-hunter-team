// Comando team stop
import { execSync } from 'node:child_process';
import {
  AGENTS, c, tmuxAvailable, getActiveSessions,
  isSessionActive, sessionName, parseAgentArg,
} from './agents.js';

export function stopAction(agentArg, options) {
  if (!tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato.'));
    process.exit(1);
  }

  const sessions = getActiveSessions();
  let targets;

  if (options.all || !agentArg) {
    targets = sessions.filter((s) =>
      AGENTS.some((a) => s === a.prefix || s.startsWith(a.prefix + '-'))
    );
    if (targets.length === 0) {
      console.log(c.yellow('Nessun agente attivo da fermare.'));
      return;
    }
  } else {
    const parsed = parseAgentArg(agentArg);
    if (!parsed) {
      console.error(c.red(`Ruolo "${agentArg}" non riconosciuto.`));
      console.error('Ruoli validi: ' + AGENTS.map((a) => a.role).join(', '));
      process.exit(1);
    }
    const sName = sessionName(parsed.role, parsed.instance);
    if (!isSessionActive(sName)) {
      console.log(c.yellow(`${sName} non e attivo.`));
      return;
    }
    targets = [sName];
  }

  console.log('');
  console.log(c.bold('Fermo agenti...'));
  console.log('');

  let stopped = 0;
  for (const s of targets.sort()) {
    try {
      execSync(`tmux send-keys -t "${s}" "/exit" C-m`, { stdio: 'ignore' });
    } catch { /* sessione gia chiusa */ }

    try {
      execSync(`sleep 1 && tmux kill-session -t "${s}"`, { stdio: 'ignore' });
      console.log(`  ${c.green('✓')} ${s} fermato`);
      stopped++;
    } catch {
      console.log(`  ${c.yellow('⚠')} ${s} — non trovato (gia chiuso?)`);
    }
  }

  console.log('');
  console.log(`${c.green(stopped + ' agenti fermati')}`);
  console.log('');
}
