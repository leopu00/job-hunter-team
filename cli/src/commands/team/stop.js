// Comando team stop
import { execSync } from 'node:child_process';
import {
  AGENTS, c, tmuxAvailable, getActiveSessions,
  isSessionActive, sessionName, parseAgentArg,
  usingContainer, isAgentSession,
} from './agents.js';
import { execArgvInContainer } from '../../utils/container-proxy.js';

// Sessioni considerate 'core' — non le killiamo con 'stop --all' per
// non spegnere la chat utente. Regola nata con la route web
// `/api/team/stop-all` (rimossa il 2026-07-25): ASSISTENTE va preservato.
const KEEP_ALIVE_ON_STOP_ALL = new Set(['ASSISTENTE']);
const STOP_ALL_INFRASTRUCTURE = [
  /^(?:JHT-)?DOTTORE(?:[-_].*)?$/,
  /^(?:JHT-)?MANTENITORE(?:[-_].*)?$/,
];

function isStopAllInfrastructure(session) {
  return STOP_ALL_INFRASTRUCTURE.some((pattern) => pattern.test(session));
}

// Le guardie usano `process.exitCode` + `return`: stesso codice osservato (1),
// ma stderr fa in tempo a svuotarsi prima che il processo termini.
// Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
export function stopAction(agentArg, options = {}) {
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato sull\'host e container jht non attivo.'));
    process.exitCode = 1;
    return;
  }

  const sessions = getActiveSessions();
  let targets;

  if (options.all || !agentArg) {
    // Prima dello stop, non dopo: se il file non si riesce a creare il
    // watchdog potrebbe riaccendere gli agenti pochi secondi dopo e la UI
    // mentirebbe all'utente. `touch` gira nel container anche quando il CLI
    // viene invocato dall'host.
    if (usingContainer()) {
      const halted = execArgvInContainer(['touch', '/jht_home/.team-halted.flag']);
      if (halted.code !== 0) {
        console.error(c.red(
          `Impossibile applicare lo stop persistente: ${halted.stderr || halted.stdout || 'errore sconosciuto'}`
        ));
        process.exitCode = 1;
        return;
      }
    }
    targets = sessions.filter((s) =>
      (AGENTS.some((a) => isAgentSession(s, a)) && !KEEP_ALIVE_ON_STOP_ALL.has(s))
      || isStopAllInfrastructure(s)
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
      process.exitCode = 1;
      return;
    }
    const sName = sessionName(parsed.role, parsed.instance);
    if (!isSessionActive(sName)) {
      console.log(c.yellow(`${sName} non e attivo.`));
      return;
    }
    targets = [sName];
  }

  console.log('');
  const where = usingContainer() ? c.dim('(container jht)') : c.dim('(host)');
  console.log(`${c.bold('Fermo agenti...')} ${where}`);
  console.log('');

  let stopped = 0;
  for (const s of targets.sort()) {
    if (usingContainer()) {
      const r = execArgvInContainer(['tmux', 'kill-session', '-t', s]);
      if (r.code === 0) {
        console.log(`  ${c.green('✓')} ${s} fermato`);
        stopped++;
      } else {
        console.log(`  ${c.yellow('⚠')} ${s} — ${(r.stderr || r.stdout || 'non trovato').split('\n')[0]}`);
      }
    } else {
      // Host legacy: prova un /exit pulito, poi kill-session
      try {
        execSync(`tmux send-keys -t "${s}" "/exit" C-m`, { stdio: 'ignore' });
      } catch { /* gia chiusa */ }
      try {
        execSync(`sleep 1 && tmux kill-session -t "${s}"`, { stdio: 'ignore' });
        console.log(`  ${c.green('✓')} ${s} fermato`);
        stopped++;
      } catch {
        console.log(`  ${c.yellow('⚠')} ${s} — non trovato (gia chiuso?)`);
      }
    }
  }

  console.log('');
  console.log(`${c.green(stopped + ' agenti fermati')}`);
  if (options.all && sessions.some((s) => KEEP_ALIVE_ON_STOP_ALL.has(s))) {
    console.log(c.dim('  ASSISTENTE preservato (usa: jht team stop assistente per chiuderlo)'));
  }
  console.log('');
}
