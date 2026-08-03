// Comandi team send e team chat — conversazione con agenti via CLI
//
// `jht team send <agente> "<msg>"` — manda un singolo messaggio
// `jht team chat <agente>`         — REPL interattivo (readline)
//
// Usa la stessa identica logica di /api/team/send della web UI: consegna via
// `jht-tmux-send`, che verifica il pane prima e dopo l'Enter e distingue i
// modi di fallire (2/3/4/5). Se il container e' attivo si passa per docker
// exec, altrimenti tmux host.

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

// Perche' un exit code merita una frase e non un "invio fallito": l'utente
// deve sapere se riprovare fra un minuto (occupato), se l'agente va sbloccato
// (muto) o se e' davvero giu'. Vedi agents/_skills/tmux-send/SKILL.md.
const SEND_ERRORS = {
  2: 'sessione non attiva',
  3: 'agente non ricettivo (pane bloccato o TUI giu\')',
  4: 'agente occupato su un turno lungo — riprova fra poco',
  5: 'agente bloccato: il messaggio e\' nel prompt ma non e\' partito — va sbloccato',
};

/** Invia un messaggio testuale all'agente e ne VERIFICA la consegna. */
function sendMessage(session, message) {
  // MAI `tmux send-keys` a mano: esce 0 appena la sessione esiste, quindi
  // dichiarerebbe consegnato anche un messaggio che la TUI ha ignorato. Il
  // wrapper aspetta il pane libero, verifica che il testo sia comparso e
  // ricontrolla che il turno sia davvero partito.
  const escaped = bashSingleQuote(message);
  const args = `'${session}' '${escaped}'`;
  const cmd =
    `if command -v jht-tmux-send >/dev/null 2>&1; then jht-tmux-send ${args}; ` +
    `else /app/agents/_skills/tmux-send/jht-tmux-send ${args}; fi`;
  const fail = (code, raw) => ({
    ok: false,
    code,
    error: SEND_ERRORS[code] || (raw || '').split('\n')[0] || `exit ${code}`,
  });
  if (usingContainer()) {
    const r = execInContainer(cmd);
    if (r.code !== 0) return fail(r.code, r.stderr || r.stdout);
    return { ok: true };
  }
  try {
    execSync(cmd, { stdio: 'ignore' });
    return { ok: true };
  } catch (err) {
    return fail(err.status, err.message);
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

// Le guardie segnano `process.exitCode` e ritornano invece di chiamare
// `process.exit()`: l'exit code osservato resta 1, ma stderr fa in tempo a
// svuotarsi. Con `process.exit()` il messaggio che spiega COME rimediare
// ("Controlla con: jht team status") poteva non arrivare mai, perche' su una
// pipe la console e' asincrona. Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
export function sendAction(agentArg, message) {
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato e container jht non attivo.'));
    process.exitCode = 1;
    return;
  }
  if (!agentArg) {
    console.error(c.red('Uso: jht team send <agente> "<messaggio>"'));
    process.exitCode = 1;
    return;
  }
  if (!message || typeof message !== 'string') {
    console.error(c.red('Messaggio mancante. Uso: jht team send capitano "ciao"'));
    process.exitCode = 1;
    return;
  }
  if (message.length > 1000) {
    console.error(c.red('Messaggio troppo lungo (max 1000 caratteri).'));
    process.exitCode = 1;
    return;
  }

  const session = resolveSession(agentArg);
  if (!session) {
    console.error(c.red(`Nessuna sessione attiva per '${agentArg}'.`));
    console.error(c.dim('  Controlla con: jht team status'));
    process.exitCode = 1;
    return;
  }

  const r = sendMessage(session, message);
  if (!r.ok) {
    console.error(c.red(`Invio fallito: ${(r.error || '').split('\n')[0]}`));
    process.exitCode = 1;
    return;
  }
  console.log(c.green(`✓ ${session} <- "${message.length > 60 ? message.slice(0, 57) + '...' : message}"`));
}

// ── chat: REPL interattivo ─────────────────────────────────────────

export async function chatAction(agentArg, options = {}) {
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato e container jht non attivo.'));
    process.exitCode = 1;
    return;
  }
  if (!agentArg) {
    console.error(c.red('Uso: jht team chat <agente>'));
    console.error(c.dim('  Esempio: jht team chat capitano'));
    process.exitCode = 1;
    return;
  }

  const session = resolveSession(agentArg);
  if (!session) {
    console.error(c.red(`Nessuna sessione attiva per '${agentArg}'.`));
    console.error(c.dim('  Agenti disponibili: ' + getActiveSessions().filter((s) =>
      AGENTS.some((a) => isAgentSession(s, a))
    ).join(', ')));
    process.exitCode = 1;
    return;
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
