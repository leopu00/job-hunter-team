// Comandi team send e team chat — conversazione con agenti via CLI
//
// `jht team send <agente> "<msg>"` — manda un singolo messaggio
// `jht team chat <agente>`         — REPL interattivo (readline)
//
// Usa la stessa identica logica di /api/team/send della web UI: consegna via
// `jht-tmux-send`, che verifica il pane prima e dopo l'Enter e distingue i
// modi di fallire (2/3/4/5). Se il container e' attivo si passa per docker
// exec, altrimenti tmux host.

import { execSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  AGENTS, c,
  tmuxAvailable, isSessionActive, sessionName, parseAgentArg,
  usingContainer, getActiveSessions, isAgentSession, resolveConfig, JHT_HOME,
} from './agents.js';
import { execInContainer, execScriptInContainer } from '../../utils/container-proxy.js';
import { answerTyped, describeAnswer } from '../../lib/terminal-answer.js';

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
export function resolveSession(agentArg) {
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
  2: 'session is not active',
  3: 'agent is not accepting input (blocked pane or TUI unavailable)',
  4: 'agent is busy with a long turn — try again shortly',
  5: 'agent is stuck: the message reached the prompt but was not processed',
};

/** Invia un messaggio testuale all'agente e ne VERIFICA la consegna. */
export function sendMessage(session, message) {
  // MAI `tmux send-keys` a mano: esce 0 appena la sessione esiste, quindi
  // dichiarerebbe consegnato anche un messaggio che la TUI ha ignorato. Il
  // wrapper aspetta il pane libero, verifica che il testo sia comparso e
  // ricontrolla che il turno sia davvero partito.
  const escaped = bashSingleQuote(message);
  const args = `'${session}' '${escaped}'`;
  // JHT_TMUX_SEND_FROM=user-console: il testo e' libero (nessuna busta) e lo scrive chi
  // usa la console. Chiede al trasporto di ripulirlo (ESC/CR, invisibili, finte buste)
  // senza attribuirlo a nessuno: shared/skills/message_origin.py, JHT-T21-b.
  const from = 'JHT_TMUX_SEND_FROM=user-console';
  const cmd =
    `if command -v jht-tmux-send >/dev/null 2>&1; then ${from} jht-tmux-send ${args}; ` +
    `else ${from} /app/agents/_skills/tmux-send/jht-tmux-send ${args}; fi`;
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

// ── The chat file: what the agent says to the person ───────────────────────
//
// The agent's words are in its chat file (agents/<agent>/chat.jsonl, written by `jht-send`), read through
// agent_chat.py as the app reads them. The pane of its terminal is only the terminal: a welcome the agent wrote to
// the chat is not on the screen, so a REPL that showed only the pane never showed it.

const CHAT_READER = '/app/shared/skills/agent_chat.py';
const HISTORY_ROWS = 6;
const POLL_MS = 3000;
const REPLY_WAIT_MS = 20_000;

/** The chat name of a session (ASSISTENTE -> assistente, SCOUT-1 -> scout), or null for a session without a chat. */
export function chatAgentOf(session) {
  const base = String(session).toLowerCase().replace(/^jht-/, '').replace(/-\d+$/, '').replace(/-s\d+$/, '');
  return ['capitano', 'assistente', 'mentor', 'scout', 'analista', 'scorer', 'scrittore', 'critico'].includes(base) ? base : null;
}

/** One read of the chat file: `{ messages, cursor }`, or null when it cannot be read (no container, an older image). */
export function readChatPage(agent, cursor, { run } = {}) {
  const args = ['read', agent, ...(cursor ? [String(cursor)] : [])];
  let result;
  try {
    if (run) {
      result = run(args);
    } else if (usingContainer()) {
      result = execScriptInContainer(CHAT_READER, args, { interpreter: 'python3', env: { JHT_HOME: '/jht_home' }, timeoutMs: 15_000 });
    } else {
      const { repoRoot } = resolveConfig();
      if (!repoRoot) return null;
      const done = spawnSync('python3', [join(repoRoot, 'shared', 'skills', 'agent_chat.py'), ...args], {
        encoding: 'utf8', timeout: 15_000, env: { ...process.env, JHT_HOME },
      });
      result = { code: done.status ?? -1, stdout: done.stdout || '', stderr: done.stderr || '' };
    }
  } catch {
    return null;
  }
  if (!result || result.code !== 0) return null;
  const line = String(result.stdout).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
  try {
    const page = JSON.parse(line);
    if (!Array.isArray(page.messages) || typeof page.cursor !== 'string') return null;
    return { messages: page.messages, cursor: page.cursor };
  } catch {
    return null;
  }
}

// What a terminal obeys never reaches the person's screen from an agent's words.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A chat row as lines for the screen: who, when, and the words. */
export function formatChatMessage(message, agent) {
  const who = message.role === 'user' ? 'you' : message.role === 'system' ? 'system' : agent;
  const at = Number(message.at) > 0 ? new Date(Number(message.at) * 1000).toTimeString().slice(0, 8) : '';
  const text = String(message.text ?? '').replace(CONTROLS, '').trim();
  const head = c.bold(who) + (at ? c.dim(` ${at}`) : '');
  const body = text.split('\n').map((l) => `  ${l}`).join('\n');
  const suggestions = Array.isArray(message.suggestions) && message.suggestions.length
    ? `\n${c.dim(`  [${message.suggestions.map((x) => String(x).replace(CONTROLS, '')).join(' | ')}]`)}`
    : '';
  return `${head}\n${body}${suggestions}`;
}

/** The chat as the REPL follows it: the newest rows first, then only what is new. */
export function createChatFeed(agent, read = readChatPage) {
  let cursor = null;
  let seen = new Set();
  return {
    /** The latest rows (the welcome is among them), or null when the chat cannot be read. */
    history(limit = HISTORY_ROWS) {
      const page = read(agent, null);
      if (!page) return null;
      cursor = page.cursor;
      seen = new Set(page.messages.map((m) => m.id));
      return page.messages.slice(-limit);
    },
    /** The rows that came since the last look. */
    fresh() {
      const page = read(agent, cursor);
      if (!page) return [];
      cursor = page.cursor;
      const out = page.messages.filter((m) => !seen.has(m.id));
      for (const m of out) seen.add(m.id);
      return out;
    },
  };
}

/**
 * The two ways the REPL looks at the chat, kept apart: the poller (`tick`) that prints what arrives while the person
 * is at the prompt, and the wait for the reply after a message (`awaitReply`). While the wait runs the poller sees
 * nothing (it must not take the reply and leave the wait to say «no reply yet» with the answer already on screen).
 */
export function createChatPump(feed) {
  let waiting = false;
  return {
    /** What the poller prints: the new rows, none while a reply is being waited for. */
    tick() {
      return waiting ? [] : feed.fresh();
    },
    /** Waits for the reply: the new rows as soon as there are any, or [] at the deadline. */
    async awaitReply({ sleep = (ms) => new Promise((res) => setTimeout(res, ms)), now = Date.now, timeoutMs = REPLY_WAIT_MS, everyMs = 2000 } = {}) {
      waiting = true;
      try {
        const until = now() + timeoutMs;
        let rows = [];
        while (!rows.length && now() < until) {
          await sleep(everyMs);
          rows = feed.fresh();
        }
        return rows;
      } finally {
        waiting = false;
      }
    },
  };
}

// ── send: one-shot ─────────────────────────────────────────────────

// Le guardie segnano `process.exitCode` e ritornano invece di chiamare
// `process.exit()`: l'exit code osservato resta 1, ma stderr fa in tempo a
// svuotarsi. Con `process.exit()` il messaggio che spiega COME rimediare
// ("Controlla con: jht team status") poteva non arrivare mai, perche' su una
// pipe la console e' asincrona. Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
export function sendAction(agentArg, message) {
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Error: tmux was not found and the jht container is not active.'));
    process.exitCode = 1;
    return;
  }
  if (!agentArg) {
    console.error(c.red('Usage: jht team send <agent> "<message>"'));
    process.exitCode = 1;
    return;
  }
  if (!message || typeof message !== 'string') {
    console.error(c.red('Missing message. Usage: jht team send capitano "hello"'));
    process.exitCode = 1;
    return;
  }
  if (message.length > 1000) {
    console.error(c.red('Message too long (max 1000 characters).'));
    process.exitCode = 1;
    return;
  }

  const session = resolveSession(agentArg);
  if (!session) {
    console.error(c.red(`No active session for '${agentArg}'.`));
    console.error(c.dim('  Check with: jht team status'));
    process.exitCode = 1;
    return;
  }

  // A number or a yes that answers a card the agent asked is the answer, not a text for its prompt.
  const typed = answerTyped(session, message, { usingContainer: usingContainer() });
  if (typed.result !== 'chat') {
    const said = describeAnswer(typed);
    (said.failed ? console.error : console.log)(said.failed ? c.red(said.text) : c.green(`✓ ${session}: ${said.text}`));
    if (said.failed) process.exitCode = 1;
    return;
  }

  const r = sendMessage(session, message);
  if (!r.ok) {
    console.error(c.red(`Failed sending: ${(r.error || '').split('\n')[0]}`));
    process.exitCode = 1;
    return;
  }
  console.log(c.green(`✓ ${session} <- "${message.length > 60 ? message.slice(0, 57) + '...' : message}"`));
}

// ── chat: REPL interattivo ─────────────────────────────────────────

export async function chatAction(agentArg, options = {}) {
  if (!usingContainer() && !tmuxAvailable()) {
    console.error(c.red('Error: tmux was not found and the jht container is not active.'));
    process.exitCode = 1;
    return;
  }
  if (!agentArg) {
    console.error(c.red('Usage: jht team chat < agent'));
    console.error(c.dim('  Example: jht team chat capitano'));
    process.exitCode = 1;
    return;
  }

  const session = resolveSession(agentArg);
  if (!session) {
    console.error(c.red(`No active session for '${agentArg}'.`));
    console.error(c.dim('  Agents available: ' + getActiveSessions().filter((s) =>
      AGENTS.some((a) => isAgentSession(s, a))
    ).join(', ')));
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input, output, terminal: true });
  console.log('');
  console.log(c.bold(`Chat with ${session}`) + c.dim(`  (${usingContainer() ? 'container jht' : 'tmux host'})`));
  console.log(c.dim('  /exit to exit · /read for new messages · /pane for the terminal · /clear to clean'));
  console.log('');

  // What the agent wrote to the chat (its welcome included), not only the terminal's screen.
  const agent = chatAgentOf(session);
  const feed = agent ? createChatFeed(agent) : null;
  const pump = feed ? createChatPump(feed) : null;
  const show = (rows) => { for (const row of rows) console.log(`${formatChatMessage(row, agent)}\n`); };
  if (feed) {
    const past = feed.history();
    if (past === null) console.log(c.dim('  (the chat cannot be read here: /pane shows the terminal)\n'));
    else if (past.length) show(past);
  }
  // A message that arrives while the person is at the prompt is printed above it.
  let poller = null;
  if (feed && !options.quiet) {
    poller = setInterval(() => {
      const rows = pump.tick();
      if (!rows.length) return;
      output.write('\r\x1b[K');
      show(rows);
      rl.prompt(true);
    }, POLL_MS);
    poller.unref?.();
  }

  const showPane = (lines = 20) => {
    const pane = capturePane(session, lines);
    const nonEmpty = pane.split('\n').filter((l) => l.trim()).slice(-lines).join('\n');
    console.log(c.dim('─── pane ─────────────────────────────────────────'));
    console.log(nonEmpty || c.dim('(empty)'));
    console.log(c.dim('──────────────────────────────────────────────────'));
  };

  try {
    while (true) {
      const line = await rl.question(c.bold('>') + ' ');
      const msg = line.trim();
      if (!msg) continue;
      if (msg === '/exit' || msg === '/quit') break;
      if (msg === '/pane') { showPane(30); continue; }
      if (msg === '/read') {
        const rows = feed ? feed.fresh() : [];
        if (rows.length) show(rows); else console.log(c.dim('  (no new messages)'));
        continue;
      }
      if (msg === '/clear') { console.clear(); continue; }
      if (msg.length > 1000) {
        console.log(c.red('  Message too long (max 1000 characters)'));
        continue;
      }
      const typed = answerTyped(session, msg, { usingContainer: usingContainer() });
      if (typed.result !== 'chat') {
        const said = describeAnswer(typed);
        console.log(said.failed ? c.red(`  ${said.text}`) : c.green(`  ✓ ${said.text}`));
        continue;
      }
      const r = sendMessage(session, msg);
      if (!r.ok) {
        console.log(c.red(`  : Failed sending: ${(r.error || '').split('\n')[0]}`));
        continue;
      }
      // The answer is in the chat: wait for it for a while; the terminal's screen only when the chat cannot be read.
      if (!options.quiet) {
        if (feed) {
          const rows = await pump.awaitReply();
          if (rows.length) show(rows); else console.log(c.dim('  (no reply yet: /read shows it when it comes)'));
        } else {
          await new Promise((res) => setTimeout(res, 3000));
          showPane(8);
        }
      }
    }
  } finally {
    if (poller) clearInterval(poller);
    rl.close();
    console.log(c.dim('  Closed chat.'));
  }
}
