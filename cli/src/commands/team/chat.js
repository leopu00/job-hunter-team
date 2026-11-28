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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import {
  AGENTS, c,
  tmuxAvailable, isSessionActive, sessionName, parseAgentArg,
  usingContainer, getActiveSessions, isAgentSession, resolveConfig, JHT_HOME,
} from './agents.js';
import { execInContainer, execScriptInContainer } from '../../utils/container-proxy.js';
import { answerTyped, describeAnswer } from '../../lib/terminal-answer.js';
import { errorBlock } from '../../lib/ui.js';
import { blockedNoticeFor } from '../../lib/chat-blocked-notice.js';
import { creditNotice } from '../../lib/provider-credit.js';
import { localTimeZone } from '../../lib/local-tz.js';
import { say, textLanguage } from '../../lib/texts.js';
import { agentTitle } from '../../../../shared/i18n/role-names.js';
import { toolsSwitch } from '../../lib/tools-switch.js';

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
/** The agent asked for is not running: say whether it is the team that is off or just that agent, and what to do. */
function noSessionError(agentArg) {
  const running = getActiveSessions().filter((s) => AGENTS.some((a) => isAgentSession(s, a)));
  return running.length === 0
    ? errorBlock({ what: 'the team is not running', why: `There is nobody to talk to as '${agentArg}' yet.`, fix: 'Start it with: jht team start' })
    : errorBlock({ what: `'${agentArg}' is not running`, why: `Running now: ${running.join(', ')}.`, fix: `Start it with: jht team start ${agentArg}` });
}

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

/**
 * The person writes from the terminal: the agent reads `[@utente -> @<agent>] [CLI] <text>`, its own marker, apart from
 * `[CHAT]` (the app) and `[TG]` (Telegram), so it answers with commands to type and never with buttons of an app that is
 * not there; the log keeps the person as the author and the CLI as the transport (JHT-T348).
 */
export function cliEnvelope(session, text) {
  return `[@utente -> @${String(session).toLowerCase().replace(/^jht-/, '')}] [CLI] ${text}`;
}

/**
 * Invia un messaggio testuale all'agente e ne VERIFICA la consegna. `fromPerson`: the text is the person's own words
 * (`jht team send`, `jht team chat`) and travels behind `[CLI]`; a text the product composes (`jht profile import`) does
 * not wear the person's envelope.
 */
export function sendMessage(session, message, { fromPerson = false } = {}) {
  // MAI `tmux send-keys` a mano: esce 0 appena la sessione esiste, quindi
  // dichiarerebbe consegnato anche un messaggio che la TUI ha ignorato. Il
  // wrapper aspetta il pane libero, verifica che il testo sia comparso e
  // ricontrolla che il turno sia davvero partito.
  const escaped = bashSingleQuote(fromPerson ? cliEnvelope(session, message) : message);
  const args = `'${session}' '${escaped}'`;
  // JHT_TMUX_SEND_FROM=user-console: lo scrive chi usa la console, che aspetta il comando (il trasporto gli concede
  // l'attesa del composer). Il testo dopo la busta [CLI] il trasporto lo recinta come quello della chat:
  // shared/skills/message_origin.py, JHT-T21 e JHT-T348.
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
// A message pasted into a terminal that is in the middle of a turn can be lost (A2 of the Linux CLI gate, 02/11: the
// second line, typed while the Assistant was still answering the first, never reached it and the chat said nothing).
// So the next message waits for the agent to be free, and says so; at the limit it is NOT sent and the person is told.
const FREE_WAIT_MS = 180_000;
const FREE_POLL_MS = 2000;

/**
 * Whether the pane shows a turn in progress: a status line with «esc to interrupt» in its last rows. The same
 * reading as the transport's (agents/_skills/tmux-send/jht-tmux-send, _pane_busy): the phrase quoted or followed by
 * prose is not a status line, and in doubt the pane is NOT busy (a message to a free pane is the harmless mistake).
 */
export function paneLooksBusy(pane, scanLines = 10) {
  const rows = String(pane || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').split('\n').slice(-scanLines);
  for (const row of rows) {
    const lower = row.toLowerCase();
    const at = lower.indexOf('esc to interrupt');
    if (at < 0) continue;
    const before = lower.slice(0, at);
    const after = lower.slice(at + 'esc to interrupt'.length);
    if (/["'“«]$/.test(before)) continue;           // quoted: prose
    if (after.length > 40) continue;                // followed by a speech: prose
    const rest = after.replace(/[) ]*$/, '').replace(/^ */, '');
    if (rest === '' || /^[·•|,-]/.test(rest)) return true;
  }
  return false;
}

/**
 * Waits until the agent's pane is free. Calls `onWait` once, the first time it is busy. True when free (at once
 * or after waiting), false when it is still busy at the limit.
 */
export async function waitForFreePane({
  capture, sleep = (ms) => new Promise((res) => setTimeout(res, ms)), now = Date.now,
  maxMs = FREE_WAIT_MS, everyMs = FREE_POLL_MS, onWait = () => {},
} = {}) {
  if (!paneLooksBusy(capture())) return true;
  onWait();
  const until = now() + maxMs;
  while (now() < until) {
    await sleep(everyMs);
    if (!paneLooksBusy(capture())) return true;
  }
  return false;
}

/**
 * The lines the person types, kept from the moment the chat opens. `rl.question` only hears a line while it is being
 * asked: a line typed while the chat waits for the reply, or for the agent to be free, was dropped without a word (B1
 * of the Linux CLI ritest, 02/11: the second and third messages never left). Here every line is kept, in order, and
 * handed out when the loop asks for the next one. `null` is the end of the input.
 */
export function createLineQueue(rl) {
  const lines = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (line) => {
    const waiter = waiting.shift();
    if (waiter) waiter(line); else lines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiting.length) waiting.shift()(null);
  });
  return {
    /** Whether a line is already waiting its turn. */
    pending: () => lines.length > 0,
    /** The next line, waiting for it if the person has not typed it yet; null once the input has ended. */
    next(prompt) {
      if (lines.length) return Promise.resolve(lines.shift());
      if (closed) return Promise.resolve(null);
      if (prompt) { rl.setPrompt(prompt); rl.prompt(); }
      return new Promise((res) => waiting.push(res));
    },
  };
}

/** The chat name of a session (ASSISTENTE -> assistente, SCOUT-1 -> scout), or null for a session without a chat. */
export function chatAgentOf(session) {
  const base = String(session).toLowerCase().replace(/^jht-/, '').replace(/-\d+$/, '').replace(/-s\d+$/, '');
  return ['capitano', 'assistente', 'mentor', 'scout', 'analista', 'scorer', 'scrittore', 'critico'].includes(base) ? base : null;
}

/** Runs agent_chat.py with `args` (in the container, or on the host) and returns the JSON line it printed, or null. */
function runChatScript(args, { run, timeoutMs = 15_000 } = {}) {
  let result;
  try {
    if (run) {
      result = run(args);
    } else if (usingContainer()) {
      result = execScriptInContainer(CHAT_READER, args, { interpreter: 'python3', env: { JHT_HOME: '/jht_home' }, timeoutMs });
    } else {
      const { repoRoot } = resolveConfig();
      if (!repoRoot) return null;
      const done = spawnSync('python3', [join(repoRoot, 'shared', 'skills', 'agent_chat.py'), ...args], {
        encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, JHT_HOME },
      });
      result = { code: done.status ?? -1, stdout: done.stdout || '', stderr: done.stderr || '' };
    }
  } catch {
    return null;
  }
  if (!result || result.code !== 0) return null;
  const line = String(result.stdout).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** One read of the chat file: `{ messages, cursor }`, or null when it cannot be read (no container, an older image). */
export function readChatPage(agent, cursor, { run } = {}) {
  // The server drops the line a cursor lands in, and a cursor that is the start of a line (where the last read
  // stopped) lands in the first NEW one: read from the byte before, the newline that ends the line already seen.
  const from = cursor ? String(Math.max(0, Number(cursor) - 1)) : null;
  const page = runChatScript(['read', agent, ...(from !== null ? [from] : [])], { run });
  if (!page || !Array.isArray(page.messages) || typeof page.cursor !== 'string') return null;
  return { messages: page.messages, cursor: page.cursor };
}

/**
 * The open cards of the agent (`agent_chat.py questions`): the questions it asked and nobody answered, whatever channel
 * they were delivered by. [] when there are none, null when they cannot be read (an older image has no such command).
 */
export function readOpenCards(agent, { run } = {}) {
  const found = runChatScript(['questions', agent], { run });
  if (!found || !Array.isArray(found.questions)) return null;
  return found.questions.filter((q) => q && typeof q.id === 'string' && Array.isArray(q.options) && q.options.length);
}

// What a terminal obeys never reaches the person's screen from an agent's words.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A chat row as lines for the screen: who, when, and the words. */
/**
 * The mood tag an agent puts at the very start of a message in the chat («[caldo] Welcome!»): the app turns it into
 * the avatar's expression and never shows it (desktop/src/lib/assistant-emotion.ts, the same closed list and the same
 * rule); a terminal has no avatar, so the tag is taken out and the text shown is the words only. ONE leading tag of
 * the list, with its spaces; anything else (another word, a tag in capitals, in the middle, a second one, a link
 * `[x](…)`) stays as written.
 */
const MOOD_TAGS = ['neutro', 'caldo', 'divertito', 'severo', 'pensieroso', 'sorpreso'];
const LEADING_MOOD = /^\s*\[([a-z]+)\](?!\()[ \t]*/;
export function withoutMoodTag(text) {
  const found = LEADING_MOOD.exec(text);
  return found && MOOD_TAGS.includes(found[1]) ? text.slice(found[0].length) : text;
}

/**
 * HH:MM:SS of a message in the person's zone. The CLI of the chat runs in the container, whose own zone is UTC: the
 * time is said in the zone the person chose (localTimeZone), not in the container's (giro Windows 16/11: 14:07 for 15:07).
 */
export function chatClock(seconds, zone = localTimeZone()) {
  const when = new Date(Number(seconds) * 1000);
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(when);
  } catch {
    return when.toTimeString().slice(0, 8);
  }
}

export function formatChatMessage(message, agent, zone = undefined, language = textLanguage()) {
  // the agent by its name in the person's language (shared/i18n/role-names.json, JHT-T358), never the id
  const who = message.role === 'user' ? 'you' : message.role === 'system' ? 'system' : agentTitle(agent, language);
  const at = Number(message.at) > 0 ? chatClock(message.at, zone) : '';
  const written = String(message.text ?? '').replace(CONTROLS, '').trim();
  // only what the agent wrote carries a mood tag: a person's own «[caldo]» stays
  const text = message.role === 'user' || message.role === 'system' ? written : withoutMoodTag(written).trim();
  const head = c.bold(who) + (at ? c.dim(` ${at}`) : '');
  const body = text.split('\n').map((l) => `  ${l}`).join('\n');
  const suggestions = Array.isArray(message.suggestions) && message.suggestions.length
    ? `\n${c.dim(`  [${message.suggestions.map((x) => String(x).replace(CONTROLS, '')).join(' | ')}]`)}`
    : '';
  return `${head}\n${body}${suggestions}`;
}

/** An open card as lines for the screen: its code, its text and its options numbered, and how to answer. */
export function formatCard(card, language = textLanguage()) {
  const clean = (value) => String(value ?? '').replace(CONTROLS, '').trim();
  const head = c.bold(say('chat.card.question', {}, language)) + c.dim(` ${clean(card.code)}  ${clean(card.subject)}`);
  const body = clean(card.text).split('\n').map((l) => `  ${l}`).join('\n');
  const options = card.options.map((option, index) => `  ${index + 1}) ${clean(option)}`).join('\n');
  const how = card.multiple
    ? c.dim(`  ${say('chat.card.answer_in_app', {}, language)}`)
    : c.dim(`  ${say('chat.card.answer_number', { code: clean(card.code) }, language)}`);
  return `${head}\n${body}\n${options}\n${how}`;
}

/**
 * The chat as the REPL follows it: the newest rows first, then only what is new. The agent's open cards come with the
 * rows as `{ card }`, each once: the card of the plan is not in the chat file when it was delivered by the app, and a
 * person at a terminal would otherwise have to guess the number.
 */
export function createChatFeed(agent, read = readChatPage, readCards = () => []) {
  let cursor = null;
  let seen = new Set();
  const shown = new Set();
  const newCards = () => {
    const cards = readCards(agent) || [];
    const fresh = cards.filter((card) => !shown.has(card.id));
    for (const card of fresh) shown.add(card.id);
    return fresh.map((card) => ({ card }));
  };
  return {
    /** The latest rows (the welcome is among them) and the open cards, or null when the chat cannot be read. */
    history(limit = HISTORY_ROWS) {
      const page = read(agent, null);
      if (!page) return null;
      cursor = page.cursor;
      seen = new Set(page.messages.map((m) => m.id));
      return [...page.messages.slice(-limit), ...newCards()];
    },
    /** The rows that came since the last look, and the cards that opened. */
    fresh() {
      const page = read(agent, cursor);
      const out = [];
      if (page) {
        cursor = page.cursor;
        for (const m of page.messages) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
      }
      return [...out, ...newCards()];
    },
    /** Every card open now, shown before or not (`/cards`). */
    open() {
      const cards = readCards(agent) || [];
      for (const card of cards) shown.add(card.id);
      return cards.map((card) => ({ card }));
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
    /** Waits for the reply: the new rows as soon as there are any, or [] at the deadline (or when `stop()` says so). */
    async awaitReply({ sleep = (ms) => new Promise((res) => setTimeout(res, ms)), now = Date.now, timeoutMs = REPLY_WAIT_MS, everyMs = 2000, stop = () => false } = {}) {
      waiting = true;
      try {
        const until = now() + timeoutMs;
        let rows = [];
        // `stop`: the person has already typed the next line, which must not wait for a reply that may take minutes.
        while (!rows.length && now() < until && !stop()) {
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
    console.error(noSessionError(agentArg));
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

  const r = sendMessage(session, message, { fromPerson: true });
  if (!r.ok) {
    console.error(c.red(`Failed sending: ${(r.error || '').split('\n')[0]}`));
    process.exitCode = 1;
    return;
  }
  console.log(c.green(`✓ ${session} <- "${message.length > 60 ? message.slice(0, 57) + '...' : message}"`));
  // delivered is not answered: on an empty balance every call of the agent comes back refused (collaudo Linux, 12/11)
  const credit = creditNotice();
  if (credit) console.log(c.yellow(`⚠ ${credit}`));
}

// ── The question that got no answer ────────────────────────────────

// An update or a switch of the tools removes the container under the REPL: the agent's terminal goes with it, and the question
// asked a moment before is never answered. The REPL keeps the last text it sent, in the team's own folder (it outlives the
// container), until something the agent wrote comes back. The chat that the wrapper brings back after the restart
// (JHT_TEAM_CHAT_RESUMED=1) asks it again, once, when nothing came after it.
const ASKED_MAX_AGE_S = 30 * 60;
const ASKED_MAX_CHARS = 1000;   // the longest message the chat sends

function askedFile(agent, home) {
  return join(home, 'state', `chat-asked-${String(agent).replace(/[^a-z0-9-]/gi, '')}.json`);
}

/** Keeps `text` as the last question sent to `agent`. Never throws: a chat that cannot keep it works as before. */
export function rememberAsked(agent, text, { home = JHT_HOME, now = () => Date.now() / 1000 } = {}) {
  try {
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(askedFile(agent, home), JSON.stringify({ text, at: now() }), { mode: 0o600 });
  } catch {
    /* nothing kept, nothing asked again */
  }
}

/** The agent answered: there is nothing to ask again. */
export function forgetAsked(agent, { home = JHT_HOME } = {}) {
  try {
    rmSync(askedFile(agent, home), { force: true });
  } catch {
    /* nothing to forget */
  }
}

/** Whether a row of the chat is something the agent said (not the person's own turn, not a line of the system). */
function isAgentRow(row) {
  return Boolean(row) && !row.card && row.role !== 'user' && row.role !== 'system';
}

/**
 * The text of the last question that nothing answered, or null: none kept, kept too long ago to still be the one, or an
 * agent row came after it (the answer is there). `rows` are the latest rows of the chat.
 */
export function unansweredQuestion(agent, rows, { home = JHT_HOME, now = () => Date.now() / 1000 } = {}) {
  let kept;
  try {
    kept = JSON.parse(readFileSync(askedFile(agent, home), 'utf8'));
  } catch {
    return null;
  }
  const at = Number(kept?.at);
  // The file is in a folder the agents can write: what it holds is taken as text from outside. A text a terminal would obey (ESC, OSC,
  // direction marks), one longer than a message can be, or an empty one is not a question the person asked: the file is discarded.
  const raw = typeof kept?.text === 'string' ? kept.text.trim() : '';
  const text = raw.replace(CONTROLS, '');
  if (!text || text !== raw || text.length > ASKED_MAX_CHARS || !(at > 0) || now() - at > ASKED_MAX_AGE_S) return null;
  if ((rows || []).some((row) => isAgentRow(row) && Number(row.at) >= at - 1)) return null;
  return text;
}

// ── The line being typed, through a restart ───────────────────────

// The switch of the tools (and an update) removes the container under the REPL while the person may be typing (JHT-T346: the
// notice of the wrapper was printed in the middle of the line, and the line was gone). The REPL keeps the line being typed, in the
// team's own folder, about once a second; the chat that comes back after the restart (JHT_TEAM_CHAT_RESUMED=1) puts it back on
// the prompt. A line sent or a chat closed by the person leaves nothing behind.
const DRAFT_MAX_AGE_S = 30 * 60;
const DRAFT_TICK_MS = 1000;

function draftFile(agent, home) {
  return join(home, 'state', `chat-draft-${String(agent).replace(/[^a-z0-9-]/gi, '')}.json`);
}

/** Keeps `text` as the line being typed to `agent`; an empty line keeps nothing. Never throws. */
export function keepDraft(agent, text, { home = JHT_HOME, now = () => Date.now() / 1000 } = {}) {
  try {
    if (!text) { rmSync(draftFile(agent, home), { force: true }); return; }
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(draftFile(agent, home), JSON.stringify({ text, at: now() }), { mode: 0o600 });
  } catch {
    /* nothing kept: the chat works as before */
  }
}

/**
 * The line that was being typed, or null: none kept, kept too long ago, or not a line the person could have typed (the file is in a
 * folder the agents write: a text a terminal would obey, or longer than a message, is discarded). Read once: it is forgotten.
 */
export function takeDraft(agent, { home = JHT_HOME, now = () => Date.now() / 1000 } = {}) {
  let kept;
  try {
    kept = JSON.parse(readFileSync(draftFile(agent, home), 'utf8'));
  } catch {
    return null;
  }
  keepDraft(agent, '', { home });
  const raw = typeof kept?.text === 'string' ? kept.text : '';
  const at = Number(kept?.at);
  if (!raw.trim() || raw.replace(CONTROLS, '') !== raw || raw.length > ASKED_MAX_CHARS || !(at > 0) || now() - at > DRAFT_MAX_AGE_S) return null;
  return raw;
}

/**
 * Once a second: keeps the line being typed, and says on a line of its own (the line typed is drawn again below it) when the switch
 * of the tools starts. A switch already under way when the chat opened is not said again: it is the chat that came back after it.
 */
export function createRestartWatch({ agent, line, say: tell, keep = keepDraft, moving = toolsSwitch }) {
  let kept = '';
  let seen = moving()?.at ?? null;
  return {
    tick() {
      const typing = line() || '';
      if (agent && typing !== kept) { kept = typing; keep(agent, typing); }
      const now = moving();
      if (now && now.at !== seen) { seen = now.at; tell(); }
    },
    sent() { kept = ''; if (agent) keep(agent, ''); },
  };
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
    console.error(noSessionError(agentArg));
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input, output, terminal: true });
  const typedLines = createLineQueue(rl);
  console.log('');
  const language = textLanguage();
  console.log(c.bold(say('chat.header.title', { session: agentTitle(session, language) }, language))
    + c.dim(`  (${usingContainer() ? say('chat.header.container', {}, language) : say('chat.header.host', {}, language)})`));
  console.log(c.dim(`  ${say('chat.header.commands', {}, language)}`));
  console.log('');

  // What the agent wrote to the chat (its welcome included), not only the terminal's screen.
  const agent = chatAgentOf(session);
  const feed = agent ? createChatFeed(agent, readChatPage, readOpenCards) : null;
  const pump = feed ? createChatPump(feed) : null;
  // A blocked agent never answers: say why (and the command that puts it right) instead of «no reply yet».
  const notice = () => blockedNoticeFor(session, options.blockedNotice || {});
  const printNotice = (lines) => { for (const line of lines) console.log(c.yellow(line)); };
  const show = (rows) => { for (const row of rows) console.log(`${row.card ? formatCard(row.card) : formatChatMessage(row, agent)}\n`); };
  let lost = null;
  if (feed) {
    const past = feed.history();
    if (past === null) console.log(c.dim(`  ${say('chat.repl.unreadable')}\n`));
    else if (past.length) show(past);
    // the chat comes back after an update or a switch of the tools: the question that got no answer is asked again
    if (past !== null && process.env.JHT_TEAM_CHAT_RESUMED === '1') lost = unansweredQuestion(agent, past);
  }
  printNotice(notice());
  // The line being typed is kept, and the switch of the tools is said on a line of its own (JHT-T346).
  const restart = createRestartWatch({
    agent,
    line: () => rl.line,
    say: () => { output.write('\r\x1b[K'); console.log(c.yellow(`⏳ ${say('chat.repl.switching', {}, language)}`)); rl.prompt(true); },
  });
  const restartTimer = output.isTTY ? setInterval(() => restart.tick(), DRAFT_TICK_MS) : null;
  restartTimer?.unref?.();
  // The chat came back after a restart: the line that was being typed goes back on the prompt.
  let typedBefore = agent && process.env.JHT_TEAM_CHAT_RESUMED === '1' ? takeDraft(agent) : null;
  // A message that arrives while the person is at the prompt is printed above it.
  let poller = null;
  if (feed && !options.quiet) {
    poller = setInterval(() => {
      const rows = pump.tick();
      if (!rows.length) return;
      if (rows.some(isAgentRow)) forgetAsked(agent);
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
    console.log(nonEmpty || c.dim(say('chat.repl.empty')));
    console.log(c.dim('──────────────────────────────────────────────────'));
  };

  // One question to the agent: wait for it to be free, send it, keep it until it is answered, wait for the answer.
  // True when the message was sent.
  const ask = async (msg, { again = false } = {}) => {
    // Never paste into a turn in progress: the text can be lost without a word. Wait for the agent, say so.
    const free = await waitForFreePane({
      capture: () => capturePane(session, 12),
      onWait: () => console.log(c.dim(`  ${say('chat.repl.busy')}`)),
    });
    if (!free) {
      console.log(c.red('  Your message was NOT sent: the agent is still busy after 3 minutes.'));
      console.log(c.dim(`  Send it again when it has answered (/read shows the answer). Your text: ${msg.length > 80 ? msg.slice(0, 80) + '…' : msg}`));
      return false;
    }
    const r = sendMessage(session, msg, { fromPerson: true });
    if (!r.ok) {
      console.log(c.red(`  : Failed sending: ${(r.error || '').split('\n')[0]}`));
      return false;
    }
    if (agent) rememberAsked(agent, msg);
    // The answer is in the chat: wait for it for a while; the terminal's screen only when the chat cannot be read.
    if (!options.quiet) {
      if (feed) {
        const rows = await pump.awaitReply({ stop: again ? () => false : typedLines.pending });
        if (rows.some(isAgentRow)) forgetAsked(agent);
        if (rows.length) show(rows);
        else if (!typedLines.pending()) { const why = notice(); if (why.length) printNotice(why); else console.log(c.dim(`  ${say('chat.repl.no_reply')}`)); }
      } else {
        await new Promise((res) => setTimeout(res, 3000));
        showPane(8);
      }
    }
    return true;
  };

  try {
    if (lost) {
      console.log(c.dim(`  ${say('chat.repl.asked_again', { text: lost.length > 80 ? lost.slice(0, 80) + '…' : lost }, language)}`));
      const sent = await ask(lost, { again: true });
      if (!sent) console.log(c.yellow(`  ${say('chat.repl.asked_again_failed', { text: lost.length > 80 ? lost.slice(0, 80) + '…' : lost }, language)}`));
    }
    if (typedBefore) console.log(c.dim(`  ${say('chat.repl.draft_back', {}, language)}`));
    while (true) {
      const next = typedLines.next(c.bold('>') + ' ');
      if (typedBefore) { rl.write(typedBefore); typedBefore = null; }
      const line = await next;
      if (line === null) break;
      restart.sent();
      const msg = line.trim();
      if (!msg) continue;
      if (msg === '/exit' || msg === '/quit') break;
      if (msg === '/pane') { showPane(30); continue; }
      if (msg === '/read') {
        const rows = feed ? feed.fresh() : [];
        if (rows.length) show(rows);
        else { const why = notice(); if (why.length) printNotice(why); else console.log(c.dim(`  ${say('chat.repl.no_new')}`)); }
        continue;
      }
      if (msg === '/cards') {
        const rows = feed ? feed.open() : [];
        if (rows.length) show(rows); else console.log(c.dim(`  ${say('chat.repl.no_questions')}`));
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
      await ask(msg);
    }
  } finally {
    if (poller) clearInterval(poller);
    if (restartTimer) clearInterval(restartTimer);
    // a chat the person closes leaves nothing; one the switch of the tools ends keeps the line for the chat that comes back
    if (!toolsSwitch()) restart.sent();
    rl.close();
    console.log(c.dim(`  ${say('chat.repl.closed')}`));
  }
}
