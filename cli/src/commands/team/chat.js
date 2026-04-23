// Comandi team send e team chat — conversazione con agenti via CLI
//
// `jht team send <agente> "<msg>"` — manda un singolo messaggio
// `jht team chat <agente>`         — REPL interattivo (readline)
//
// Usa la stessa identica logica di /api/team/send della web UI:
//   tmux send-keys -t <SESSION> -- '<msg>'
//   tmux send-keys -t <SESSION> Enter
// Se il container e' attivo si passa per docker exec, altrimenti tmux host.

import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  AGENTS, c,
  tmuxAvailable, isSessionActive, sessionName, parseAgentArg,
  usingContainer, getActiveSessions, isAgentSession,
} from './agents.js';
import { execInContainer } from '../../utils/container-proxy.js';

// Escape per passare il messaggio dentro single-quote bash:
//   ' -> '\''   $ -> \$   ` -> \`
function bashSingleQuote(msg) {
  return msg.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

/**
 * Risolve 'capitano' o 'scout:1' → nome sessione tmux effettivo.
 * Se l'arg e' gia' un nome di sessione (es. 'CRITICO-S1' spawnato dallo
 * Scrittore) lo accetta cosi' com'e' se esiste tra le attive.
 */
function resolveSession(agentArg) {
  const active = getActiveSessions();
  const parsed = parseAgentArg(agentArg);
  if (parsed) {
    const name = sessionName(parsed.role, parsed.instance);
    if (active.includes(name)) return name;
  }
  // Accetta anche un nome di sessione completo (case insensitive)
  const up = agentArg.toUpperCase();
  const match = active.find((s) => s.toUpperCase() === up);
  if (match) return match;
  return null;
}

/** Invia un messaggio testuale all'agente (una riga, + Enter). */
function sendMessage(session, message) {
  const escaped = bashSingleQuote(message);
  const sendCmd = `tmux send-keys -t '${session}' -- '${escaped}'`;
  const enterCmd = `tmux send-keys -t '${session}' Enter`;
  if (usingContainer()) {
    const r1 = execInContainer(sendCmd);
    if (r1.code !== 0) return { ok: false, error: r1.stderr || r1.stdout };
    const r2 = execInContainer(enterCmd);
    if (r2.code !== 0) return { ok: false, error: r2.stderr || r2.stdout };
    return { ok: true };
  }
  try {
    execSync(sendCmd, { stdio: 'ignore' });
    execSync(enterCmd, { stdio: 'ignore' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Cattura il pane della sessione (ultime N righe). */
function capturePane(session, lines = 30) {
  const cmd = `tmux capture-pane -t '${session}' -p -S -${lines} 2>/dev/null`;
  if (usingContainer()) {
    const r = execInContainer(cmd);
    return r.code === 0 ? r.stdout : '';
  }
  try {
    return execSync(cmd, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

// ── send: one-shot ─────────────────────────────────────────────────

export function sendAction(agentArg, message) {
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato e container jht non attivo.'));
    process.exit(1);
  }
  if (!agentArg) {
    console.error(c.red('Uso: jht team send <agente> "<messaggio>"'));
    process.exit(1);
  }
  if (!message || typeof message !== 'string') {
    console.error(c.red('Messaggio mancante. Uso: jht team send capitano "ciao"'));
    process.exit(1);
  }
  if (message.length > 1000) {
    console.error(c.red('Messaggio troppo lungo (max 1000 caratteri).'));
    process.exit(1);
  }

  const session = resolveSession(agentArg);
  if (!session) {
    console.error(c.red(`Nessuna sessione attiva per '${agentArg}'.`));
    console.error(c.dim('  Controlla con: jht team status'));
    process.exit(1);
  }

  const r = sendMessage(session, message);
  if (!r.ok) {
    console.error(c.red(`Invio fallito: ${(r.error || '').split('\n')[0]}`));
    process.exit(1);
  }
  console.log(c.green(`✓ ${session} <- "${message.length > 60 ? message.slice(0, 57) + '...' : message}"`));
}

// ── chat: REPL interattivo ─────────────────────────────────────────

export async function chatAction(agentArg, options = {}) {
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato e container jht non attivo.'));
    process.exit(1);
  }
  if (!agentArg) {
    console.error(c.red('Uso: jht team chat <agente>'));
    console.error(c.dim('  Esempio: jht team chat capitano'));
    process.exit(1);
  }

  const session = resolveSession(agentArg);
  if (!session) {
    console.error(c.red(`Nessuna sessione attiva per '${agentArg}'.`));
    console.error(c.dim('  Agenti disponibili: ' + getActiveSessions().filter((s) =>
      AGENTS.some((a) => isAgentSession(s, a))
    ).join(', ')));
    process.exit(1);
  }

  const rl = createInterface({ input, output, terminal: true });
  console.log('');
  console.log(c.bold(`Chat con ${session}`) + c.dim(`  (${usingContainer() ? 'container jht' : 'tmux host'})`));
  console.log(c.dim('  /exit per uscire · /pane per vedere l\'ultimo output · /clear per pulire'));
  console.log('');

  const showPane = (lines = 20) => {
    const pane = capturePane(session, lines);
    const nonEmpty = pane.split('\n').filter((l) => l.trim()).slice(-lines).join('\n');
    console.log(c.dim('─── pane ─────────────────────────────────────────'));
    console.log(nonEmpty || c.dim('(vuoto)'));
    console.log(c.dim('──────────────────────────────────────────────────'));
  };

  try {
    while (true) {
      const line = await rl.question(c.bold('>') + ' ');
      const msg = line.trim();
      if (!msg) continue;
      if (msg === '/exit' || msg === '/quit') break;
      if (msg === '/pane') { showPane(30); continue; }
      if (msg === '/clear') { console.clear(); continue; }
      if (msg.length > 1000) {
        console.log(c.red('  Messaggio troppo lungo (max 1000 caratteri)'));
        continue;
      }
      const r = sendMessage(session, msg);
      if (!r.ok) {
        console.log(c.red(`  ✗ invio fallito: ${(r.error || '').split('\n')[0]}`));
        continue;
      }
      // Mostra breve peek del pane dopo 3s per vedere l'inizio della risposta
      if (!options.quiet) {
        await new Promise((res) => setTimeout(res, 3000));
        showPane(8);
      }
    }
  } finally {
    rl.close();
    console.log(c.dim('  Chat chiusa.'));
  }
}
