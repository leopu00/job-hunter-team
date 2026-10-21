// Comando team stop
import { execFileSync } from 'node:child_process';
import {
  AGENTS, c, tmuxAvailable, getActiveSessions,
  isSessionActive, parseAgentArg,
  usingContainer,
} from './agents.js';
import { execArgvInContainer } from '../../utils/container-proxy.js';

// Sessioni considerate 'core' — non le killiamo con 'stop --all' per
// non spegnere la chat utente. Regola nata con la route web
// `/api/team/stop-all` (rimossa il 2026-07-25): ASSISTENTE va preservato.
const KEEP_ALIVE_ON_STOP_ALL = new Set(['ASSISTENTE']);
// Anche col prefisso dell'host legacy: `JHT-ASSISTENTE` è la stessa sessione di `ASSISTENTE`.
function keepsAliveOnStopAll(session) {
  return KEEP_ALIVE_ON_STOP_ALL.has(session.replace(/^JHT-/, ''));
}

const STOP_ALL_INFRASTRUCTURE = [
  /^(?:JHT-)?DOTTORE(?:[-_].*)?$/,
  /^(?:JHT-)?MANTENITORE(?:[-_].*)?$/,
];

function isStopAllInfrastructure(session) {
  return STOP_ALL_INFRASTRUCTURE.some((pattern) => pattern.test(session));
}

// I nomi delle sessioni che il team possiede, esatti: la stessa grammatica di start-agent.sh e del
// pannello degli agenti (shared/skills/agent_control.py). Un prefisso non basta: `SENTINELLA-WORKER`
// non è un agente del team ma la sonda `/usage` del bridge (la sua vita è del bridge), e `SCOUT-1`
// non deve trascinare con sé `SCOUT-10` né un qualunque nome che lo estenda.
//   singoli:    CAPITANO ASSISTENTE MENTOR SENTINELLA CRITICO
//   numerati:   SCOUT-n ANALISTA-n SCORER-n SCRITTORE-n CLOSER-n   (n senza zero iniziale)
//   revisori:   CRITICO-S<n>  (effimeri: li crea e li chiude lo Scrittore)
const TEAM_SESSION = /^(?:JHT-)?(?:CAPITANO|ASSISTENTE|MENTOR|SENTINELLA|CRITICO|(?:SCOUT|ANALISTA|SCORER|SCRITTORE|CLOSER)-[1-9][0-9]{0,3}|CRITICO-S[1-9][0-9]{0,3})$/;

export function isTeamSession(session) {
  return TEAM_SESSION.test(session);
}

/**
 * La sessione che un argomento di `jht team stop <agent>` nomina, o `{ error }`.
 * Oltre ai ruoli di `AGENTS`: `closer` (CLOSER-1) e i revisori `critico:s2` / `critico-s2` (CRITICO-S2).
 * Un numero su un ruolo senza istanze (`critico:2`) è un errore, non "CRITICO": spegnere un agente
 * diverso da quello chiesto è peggio che non spegnerne nessuno.
 */
export function resolveStopTarget(arg, container = usingContainer()) {
  const prefix = container ? '' : 'JHT-';
  const lower = String(arg).toLowerCase().trim();
  const reviewer = lower.match(/^critico[-:]?s([1-9][0-9]{0,3})$/);
  if (reviewer) return { session: `${prefix}CRITICO-S${reviewer[1]}` };
  const closer = lower.match(/^closer(?:[-:]?([1-9][0-9]{0,3}))?$/);
  if (closer) return { session: `${prefix}CLOSER-${closer[1] || '1'}` };
  const parsed = parseAgentArg(lower);
  if (!parsed) return { error: 'unknown' };
  const agent = AGENTS.find((a) => a.role === parsed.role);
  if (!agent.multi && /\d/.test(lower)) return { error: 'no-instances', role: agent.role };
  // Il nome si costruisce qui, col `container` ricevuto: `sessionName` lo deciderebbe da solo
  // guardando se il container gira, e la risposta cambierebbe con la macchina.
  const instance = agent.multi ? parsed.instance : null;
  return { session: `${prefix}${agent.prefix}${instance ? `-${instance}` : ''}` };
}

// `=` forza il confronto ESATTO del nome: senza, tmux risolve il target per prefisso e `-t SCOUT-1`
// trova anche SCOUT-10, `-t CRITICO` anche CRITICO-S3. Stessa convenzione di start-agent.sh.
export function exactSession(session) {
  return `=${session}`;
}

// Le guardie usano `process.exitCode` + `return`: stesso codice osservato (1),
// ma stderr fa in tempo a svuotarsi prima che il processo termini.
// Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
export function stopAction(agentArg, options = {}) {
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Error: tmux was not found on the host and the jht container is not running.'));
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
          `Unable to apply persistent stop: ${halted.stderr || halted.stdout || 'unknown error'}`
        ));
        process.exitCode = 1;
        return;
      }
    }
    targets = sessions.filter((s) =>
      (isTeamSession(s) && !keepsAliveOnStopAll(s))
      || isStopAllInfrastructure(s)
    );
    if (targets.length === 0) {
      console.log(c.yellow('No active agents to stop.'));
      return;
    }
  } else {
    const target = resolveStopTarget(agentArg);
    if (target.error === 'no-instances') {
      console.error(c.red(`Role "${target.role}" has no numbered instances ("${agentArg}").`));
      if (target.role === 'critico') console.error('A writer\'s reviewer is critico:s<N> (for example critico:s2).');
      process.exitCode = 1;
      return;
    }
    if (target.error) {
      console.error(c.red(`Role "${agentArg}" is not recognized.`));
      console.error('Valid roles: ' + [...AGENTS.map((a) => a.role), 'closer', 'critico:s<N>'].join(', '));
      process.exitCode = 1;
      return;
    }
    const sName = target.session;
    if (!isSessionActive(sName)) {
      console.log(c.yellow(`${sName} is not active.`));
      return;
    }
    targets = [sName];
  }

  console.log('');
  const where = usingContainer() ? c.dim('(container jht)') : c.dim('(host)');
  console.log(`${c.bold('Stopping agents...')} ${where}`);
  console.log('');

  let stopped = 0;
  for (const s of targets.sort()) {
    if (usingContainer()) {
      const r = execArgvInContainer(['tmux', 'kill-session', '-t', exactSession(s)]);
      if (r.code === 0) {
        console.log(`  ${c.green('✓')} ${s} stopped`);
        stopped++;
      } else {
        console.log(`  ${c.yellow('⚠')} ${s} — ${(r.stderr || r.stdout || 'not found').split('\n')[0]}`);
      }
    } else {
      // Host legacy: prova un /exit pulito, poi kill-session. Argomenti separati, niente shell: il
      // nome della sessione arriva da `tmux list-sessions` e non deve poter diventare comando.
      try {
        execFileSync('tmux', ['send-keys', '-t', `${exactSession(s)}:`, '/exit', 'C-m'], { stdio: 'ignore' });
      } catch { /* gia chiusa */ }
      try {
        execFileSync('sleep', ['1'], { stdio: 'ignore' });
        execFileSync('tmux', ['kill-session', '-t', exactSession(s)], { stdio: 'ignore' });
        console.log(`  ${c.green('✓')} ${s} stopped`);
        stopped++;
      } catch {
        console.log(`  ${c.yellow('⚠')} ${s} — not found (already closed?)`);
      }
    }
  }

  console.log('');
  console.log(c.green(`${stopped} agents stopped`));
  if (options.all && sessions.some(keepsAliveOnStopAll)) {
    console.log(c.dim('  ASSISTENTE preserved (use jht team stop assistente to close it)'));
  }
  console.log('');
}
