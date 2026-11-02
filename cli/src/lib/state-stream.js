// `jht state-stream` — the one long exec the desktop app keeps open to the team's container.
//
// Today every read of a page (the chat, the agents' panel, the profile bar) is a new exec: the app
// attests the container, opens the connection, starts an interpreter, reads, closes. Here the app opens
// ONE exec, attests it once, and asks over it: one JSON object per line on stdin, one per line on
// stdout (NDJSON, protocol 1).
//
//   in   {"id":n,"op":"chat.read","args":{"agent":"capitano","cursor":"12"}} | agents.list | agents.team |
//        agents.screen {"name"} | profile.progress | watch {"topics":[…]} | invalidate | ping | bye
//        (ids grow; at most 256 KiB a line, 8 levels deep)
//   out  {"t":"hello","proto":1,"ops":[…],"cid":"<container id from inside>","sha256":{…}}  first line
//        {"t":"res","id":n,"ok":true,"exit":0,"out":"<stdout of the reader>","age_ms":0,"cached":false}
//        {"t":"res","id":n,"ok":false,"err":"args_invalid|op_unknown|busy|timeout|too_big|reader_failed"}
//        {"t":"ev","topic":"agents|profile|settings|positions|chat:<agent>","rev":n}   «changed, read again», no content
//        {"t":"pong","id":n}
//
// What this process is, and is not:
//   - It does not rewrite any read. It RUNS the readers that already exist (agent_chat.py read,
//     agent_control.py list|team|screen, profile_progress.py) from a closed table, with an absolute
//     argv, no shell, a fixed working directory and an explicit environment, and gives back their
//     stdout whole and their exit code. The app closes that text with the same parsers as for the old
//     exec, so the answer is the same by construction.
//   - It writes nothing, opens no database, listens on no port. Its only child processes are the
//     readers of the table and `tmux list-sessions` (for the «the roster changed» hint).
//   - Everything that comes in is untrusted: a line over the cap, deeper than the cap, not JSON, with
//     an id that does not grow, an op or a key not in the table ends the stream (exit 3). The app does
//     not trust what comes out either (the app side checks again).
//
// One place runs a program: `runReader`. A source test holds that.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { agentControlArgv } from './agent-control-args.js';

export const PROTO = 1;
/** The longest line, in bytes, ENCODED, in both directions. */
export const MAX_LINE = 256 * 1024;
export const MAX_DEPTH = 8;
export const MAX_IN_FLIGHT = 8;
export const MAX_PER_SECOND = 10;
export const READER_TIMEOUT_MS = 8000;
/** A reader may write at most this much before it is stopped; the encoded line is then checked against MAX_LINE. */
export const READER_STDOUT_MAX = 1024 * 1024;
export const IDLE_EXIT_MS = 60_000;
export const MAX_TOPICS = 12;
/** The least time between two hints for the positions: the database changes far more often than a page needs to read. */
export const POSITIONS_HINT_MS = 10_000;
export const EXIT_PROTOCOL = 3;
/** What is kept of answered reads: at most this many entries and this many bytes of text; the oldest go first. */
export const CACHE_MAX_ENTRIES = 64;
export const CACHE_MAX_BYTES = 4 * 1024 * 1024;

const PYTHON = '/usr/bin/python3';
const TMUX = '/usr/bin/tmux';
/** The image's own Node and CLI, for the one read whose reader is the CLI command the old way ran (`agent-control settings get`). */
const NODE = '/usr/local/bin/node';
const JHT_ENTRY = '/app/cli/bin/jht.js';
const SKILLS = '/app/shared/skills';
/** Root-owned, in the image layer, not writable by the agents. */
export const CWD = '/app';
const PATH = '/usr/local/bin:/usr/bin:/bin';
/** The only variables a reader inherits (the image's own); the agents cannot change an exec's environment. */
const ENV_KEPT = ['HOME', 'USER', 'LANG', 'LC_ALL', 'TZ', 'TMUX_TMPDIR', 'JHT_HOME', 'JHT_USER_DIR', 'JHT_DB', 'IS_CONTAINER'];

/** The agents the chat talks to (the same list as the app's `CHAT_AGENTS`). */
export const CHAT_AGENTS = ['capitano', 'assistente', 'mentor', 'scout', 'analista', 'scorer', 'scrittore', 'critico'];
const CURSOR = /^[0-9]{1,12}$/;

export const PROFILE_SCRIPT = `${SKILLS}/profile_progress.py`;
const PROFILE_REQUEST = '{"op":"read"}\n';

const NO_ARGS = (args) => (args === undefined ? [] : null);
const keysOnly = (value, allowed) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every((key) => allowed.includes(key));

/**
 * The closed table. `argv(args)` returns the absolute argv for the reader, or null when `args` is not one of the
 * shapes; every non-constant word of it is checked against a closed list or alphabet that cannot start with «-».
 * `ttl` is how long a successful answer serves the next asks of the same op and arguments.
 */
export const READERS = {
  'chat.read': {
    ttl: 300,
    argv(args) {
      if (!keysOnly(args, ['agent', 'cursor'])) return null;
      if (typeof args.agent !== 'string' || !CHAT_AGENTS.includes(args.agent)) return null;
      const argv = [PYTHON, '-I', `${SKILLS}/agent_chat.py`, 'read', args.agent];
      if (args.cursor !== undefined) {
        if (typeof args.cursor !== 'string' || !CURSOR.test(args.cursor)) return null;
        argv.push(args.cursor);
      }
      return argv;
    },
  },
  'agents.list': { ttl: 1000, argv: (args) => (NO_ARGS(args) ? control(['list']) : null) },
  'agents.team': { ttl: 1000, argv: (args) => (NO_ARGS(args) ? control(['team']) : null) },
  'agents.history': { ttl: 2000, argv: (args) => (NO_ARGS(args) ? control(['history']) : null) },
  'agents.exclusions': { ttl: 1000, argv: (args) => (NO_ARGS(args) ? control(['exclusions']) : null) },
  'team.settings': { ttl: 3000, argv: (args) => (NO_ARGS(args) ? [NODE, JHT_ENTRY, 'agent-control', 'settings', 'get'] : null) },
  'agents.screen': {
    ttl: 500,
    argv(args) {
      if (!keysOnly(args, ['name']) || typeof args.name !== 'string') return null;
      return control(['screen', args.name]);
    },
  },
  'profile.progress': {
    ttl: 5000,
    stdin: PROFILE_REQUEST,
    argv: (args) => (NO_ARGS(args) ? [PYTHON, '-I', PROFILE_SCRIPT] : null),
  },
};

function control(words) {
  const checked = agentControlArgv(words);
  return checked ? [PYTHON, '-I', `${SKILLS}/agent_control.py`, ...checked] : null;
}

const CONTROL_OPS = ['watch', 'invalidate', 'ping', 'bye'];
/** What the hello says this process can do (the profile read only when its file is in the image). */
export function opsOf(profileKnown) {
  return [...Object.keys(READERS).filter((op) => op !== 'profile.progress' || profileKnown), ...CONTROL_OPS];
}

/** The environment of a reader: the image's own few variables and a fixed PATH. */
export function readerEnv(source = process.env) {
  const env = { PATH };
  for (const key of ENV_KEPT) if (typeof source[key] === 'string') env[key] = source[key];
  return env;
}

/**
 * THE place that runs a program. No shell, an absolute argv, a fixed directory, an explicit environment, its own
 * process group (killed whole on a timeout, on a cap, or when the stream ends). Never throws: resolves
 * {exit, out} or {err}.
 */
export function runReader(argv, { stdin = null, timeoutMs = READER_TIMEOUT_MS, maxStdout = READER_STDOUT_MAX, cwd = CWD, env = readerEnv(), track } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, detached: true, stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'ignore'] });
    } catch {
      resolve({ err: 'reader_failed' });
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const killGroup = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (track) track.delete(killGroup);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killGroup();
      finish({ err: 'timeout' });
    }, timeoutMs);
    if (track) track.add(killGroup);
    child.on('error', () => finish({ err: 'reader_failed' }));
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxStdout) {
        killGroup();
        finish({ err: 'too_big' });
        return;
      }
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      // killed from outside (no exit code): not an answer
      if (code === null) finish({ err: 'reader_failed' });
      else finish({ exit: code, out: Buffer.concat(chunks).toString('utf8') });
    });
    if (stdin !== null) {
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
    }
  });
}

/** The container id as seen from inside, from what the agents cannot write: the engine's `/run/.containerenv`, then the hostname. */
export function containerId(readText = (path) => readFileSync(path, 'utf8'), host = hostname) {
  try {
    const found = /^id="([0-9a-f]{64})"$/m.exec(readText('/run/.containerenv'));
    if (found) return found[1];
  } catch { /* not a Podman container */ }
  const name = String(host());
  return /^[0-9a-f]{12}$/.test(name) ? name : null;
}

export function sha256File(path, readBytes = readFileSync) {
  try {
    return createHash('sha256').update(readBytes(path)).digest('hex');
  } catch {
    return null;
  }
}

/** Nesting of a line of JSON, counted before it is parsed. */
export function depthOf(line) {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i += 1;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) {
      inString = true;
    } else if (c === 0x7b || c === 0x5b) {
      depth += 1;
      if (depth > max) max = depth;
    } else if (c === 0x7d || c === 0x5d) {
      depth -= 1;
    }
  }
  return max;
}

const AGENT_TOPIC = /^chat:([a-z]+)$/;
/** A topic the app may watch: `agents`, `profile`, `settings`, `positions`, or `chat:<agent>` for one of the chat's agents. */
export function validTopic(topic) {
  if (topic === 'agents' || topic === 'profile' || topic === 'settings' || topic === 'positions') return true;
  const found = typeof topic === 'string' ? AGENT_TOPIC.exec(topic) : null;
  return Boolean(found && CHAT_AGENTS.includes(found[1]));
}

function cacheKey(op, args) {
  const sorted = args && typeof args === 'object' ? Object.fromEntries(Object.keys(args).sort().map((key) => [key, args[key]])) : null;
  return `${op}\n${JSON.stringify(sorted)}`;
}

/**
 * The stream: bytes in, lines out. Everything with the world (the readers, the clock, the files watched) is
 * passed in, so the protocol is proved without a container.
 *
 *   write(line)  one encoded line, no newline
 *   end(code)    the process must stop with this exit code (children already killed)
 */
export function createStateStream({
  write,
  end,
  run = runReader,
  now = () => Date.now(),
  home = process.env.JHT_HOME || '/jht_home',
  stat = (path) => {
    try {
      const s = statSync(path);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return null;
    }
  },
  cid = containerId,
  profileSha = () => sha256File(PROFILE_SCRIPT),
  timeoutMs = READER_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const cache = new Map();
  const inflight = new Map();
  const killers = new Set();
  const recent = new Map();
  let buffer = '';
  let lastId = 0;
  let busy = 0;
  let over = false;
  let topics = [];
  let signatures = new Map();
  const revs = new Map();
  let idle;
  let watcher;
  let sweeping = false;

  const stop = (code) => {
    if (over) return;
    over = true;
    clearTimer(idle);
    clearInterval(watcher);
    for (const kill of [...killers]) kill();
    end(code);
  };
  const violation = () => stop(EXIT_PROTOCOL);

  const send = (object) => {
    if (over) return true;
    const line = JSON.stringify(object);
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE) return false;
    write(line);
    return true;
  };
  const answer = (id, body) => {
    if (!send({ t: 'res', id, ...body })) send({ t: 'res', id, ok: false, err: 'too_big' });
  };

  const armIdle = () => {
    clearTimer(idle);
    idle = setTimer(() => stop(0), IDLE_EXIT_MS);
  };

  const withinRate = (op) => {
    const t = now();
    const stamps = (recent.get(op) ?? []).filter((at) => t - at < 1000);
    if (stamps.length >= MAX_PER_SECOND) {
      recent.set(op, stamps);
      return false;
    }
    stamps.push(t);
    recent.set(op, stamps);
    return true;
  };

  // Put an answer away: the ones past their time go, then the oldest until the count and the bytes are within the cap.
  const remember = (key, entry) => {
    cache.delete(key);
    cache.set(key, entry);
    const t = now();
    let bytes = 0;
    for (const [other, kept] of cache) {
      if (t - kept.at >= kept.ttl) cache.delete(other);
      else bytes += kept.out.length;
    }
    for (const other of cache.keys()) {
      if (cache.size <= CACHE_MAX_ENTRIES && bytes <= CACHE_MAX_BYTES) break;
      if (other === key) continue;
      bytes -= cache.get(other).out.length;
      cache.delete(other);
    }
  };

  const readThrough = async (id, op, args, argv) => {
    const reader = READERS[op];
    const key = cacheKey(op, args);
    const kept = cache.get(key);
    if (kept && now() - kept.at < reader.ttl) {
      answer(id, { ok: true, exit: kept.exit, out: kept.out, age_ms: now() - kept.at, cached: true });
      return;
    }
    let pending = inflight.get(key);
    const shared = Boolean(pending);
    if (!pending) {
      pending = run(argv, { stdin: reader.stdin ?? null, timeoutMs, track: killers });
      inflight.set(key, pending);
    }
    let result;
    try {
      result = await pending;
    } finally {
      if (!shared) inflight.delete(key);
    }
    if (over) return;
    if (result.err) {
      answer(id, { ok: false, err: result.err });
      return;
    }
    if (!shared && result.exit === 0) remember(key, { at: now(), ttl: reader.ttl, exit: result.exit, out: result.out });
    answer(id, { ok: true, exit: result.exit, out: result.out, age_ms: 0, cached: false });
  };

  const topicPaths = (topic) => {
    if (topic === 'profile') return [`${home}/profile/candidate_profile.yml`];
    // what `agent-control settings get` reads: the config, the burst's record, the containment holds, the budget's file
    if (topic === 'settings') return [`${home}/jht.config.json`, `${home}/.burst.json`, `${home}/logs/containment`, `${home}/logs/sentinel-data.jsonl`];
    // the database and its write-ahead log (in WAL a write touches the log, not the main file); only stat'ed
    if (topic === 'positions') return [`${home}/jobs.db`, `${home}/jobs.db-wal`];
    const chat = AGENT_TOPIC.exec(topic);
    return chat ? [`${home}/agents/${chat[1]}/chat.jsonl`] : [];
  };

  const bump = (topic) => {
    const rev = (revs.get(topic) ?? 0) + 1;
    revs.set(topic, rev);
    if (topic === 'agents') for (const key of cache.keys()) if (key.startsWith('agents.')) cache.delete(key);
    if (topic === 'profile') for (const key of cache.keys()) if (key.startsWith('profile.')) cache.delete(key);
    if (topic === 'settings') for (const key of cache.keys()) if (key.startsWith('team.settings\n')) cache.delete(key);
    const chat = AGENT_TOPIC.exec(topic);
    if (chat) for (const key of cache.keys()) if (key.startsWith('chat.read\n') && key.includes(`"agent":"${chat[1]}"`)) cache.delete(key);
    send({ t: 'ev', topic, rev });
  };

  let positionsDirty = false;
  let positionsHintAt = -Infinity;
  const sweep = async () => {
    if (over || sweeping) return;
    sweeping = true;
    try {
      for (const topic of topics) {
        let signature;
        if (topic === 'agents') {
          const roster = await run([TMUX, 'list-sessions', '-F', '#{session_name} #{session_created}'], { timeoutMs: 2000, track: killers });
          signature = roster.err ? 'unreadable' : `${roster.exit}:${roster.out}`;
        } else {
          signature = topicPaths(topic).map((path) => stat(path)).join('|');
        }
        if (over) return;
        const before = signatures.get(topic);
        signatures.set(topic, signature);
        if (topic === 'positions') {
          // a scoring team writes many times a minute: one hint at most every POSITIONS_HINT_MS, and the last change always gets one
          if (before !== undefined && before !== signature) positionsDirty = true;
          if (positionsDirty && now() - positionsHintAt >= POSITIONS_HINT_MS) {
            positionsDirty = false;
            positionsHintAt = now();
            bump(topic);
          }
        } else if (before !== undefined && before !== signature) {
          bump(topic);
        }
      }
    } finally {
      sweeping = false;
    }
  };

  const control_ = (id, op, args) => {
    if (op === 'ping') {
      send({ t: 'pong', id });
    } else if (op === 'invalidate') {
      cache.clear();
      answer(id, { ok: true });
    } else if (op === 'bye') {
      answer(id, { ok: true });
      stop(0);
    } else if (op === 'watch') {
      const list = keysOnly(args, ['topics']) && Array.isArray(args.topics) ? args.topics : null;
      if (!list || list.length > MAX_TOPICS || !list.every(validTopic)) {
        answer(id, { ok: false, err: 'args_invalid' });
        return;
      }
      topics = [...new Set(list)];
      signatures = new Map();
      positionsDirty = false;
      clearInterval(watcher);
      if (topics.length) {
        watcher = setInterval(() => { sweep().catch(() => {}); }, 1000);
        watcher.unref?.();
        sweep().catch(() => {});
      }
      answer(id, { ok: true });
    }
  };

  const handle = (line) => {
    if (depthOf(line) > MAX_DEPTH) return violation();
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return violation();
    }
    if (!keysOnly(request, ['id', 'op', 'args'])) return violation();
    const { id, op, args } = request;
    if (!Number.isInteger(id) || id < 1 || id > 2 ** 31 - 1 || id <= lastId) return violation();
    lastId = id;
    if (typeof op !== 'string') return violation();
    const known = Object.hasOwn(READERS, op) || CONTROL_OPS.includes(op);
    if (!known) {
      answer(id, { ok: false, err: 'op_unknown' });
      return;
    }
    if (op === 'profile.progress' && profileShaValue === null) {
      answer(id, { ok: false, err: 'op_unknown' });
      return;
    }
    // the arguments are checked before the ask takes a slot: a wrong one answers at once and costs nothing
    const argv = Object.hasOwn(READERS, op) ? READERS[op].argv(args) : null;
    if (Object.hasOwn(READERS, op) && !argv) {
      answer(id, { ok: false, err: 'args_invalid' });
      return;
    }
    if (!withinRate(op) || (argv && busy >= MAX_IN_FLIGHT)) {
      answer(id, { ok: false, err: 'busy' });
      return;
    }
    if (argv) {
      busy += 1;
      readThrough(id, op, args, argv)
        .catch(() => { answer(id, { ok: false, err: 'reader_failed' }); })
        .finally(() => { busy -= 1; });
    } else {
      control_(id, op, args);
    }
  };

  const profileShaValue = profileSha();

  return {
    /** How many answers are kept (for the tests). */
    kept: () => cache.size,
    /** First line, before anything is read. */
    hello() {
      const sha = profileShaValue ? { 'profile.progress': profileShaValue } : {};
      send({ t: 'hello', proto: PROTO, ops: opsOf(profileShaValue !== null), cid: cid(), sha256: sha });
      armIdle();
    },
    /** Bytes from stdin. */
    push(chunk) {
      if (over) return;
      armIdle();
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline === -1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line, 'utf8') > MAX_LINE) return violation();
        if (line.length === 0) continue;
        handle(line);
        if (over) return;
      }
      // a line that has not ended yet is already over the cap: no waiting for more
      if (buffer.length > MAX_LINE) violation();
    },
    /** stdin ended: the app closed it, or died. */
    close() {
      stop(0);
    },
  };
}
