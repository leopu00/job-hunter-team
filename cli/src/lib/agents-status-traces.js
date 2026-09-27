/**
 * What each agent of the JHT API executor is doing, from its traces, in the
 * shape the TUI publishes (agents-status.js, migration 089) under "api".
 *
 * The executor (agent-harness/runtime) runs each agent as a process that
 * writes one JSONL trace per run: <logs>/<agent>/<runId>.jsonl, with runId
 * an ISO time first, so the greatest name is the newest run
 * (src/core/trace.ts; the harness's dashboard reads them the same way).
 * Only the newest run of an agent counts.
 *
 * THE RULE, on that run's events (the main agent's only: a subagent's round
 * or tool carries its own `agent`; agent_started/agent_finished are the main
 * agent's, naming the subagent):
 *   - run_finished "completed": idle. A turn that ends with no pause and no
 *     mail ends the process; the TUI agent would wait at its prompt
 *     (docs/parity.md, runCycles 4);
 *   - run_finished "stopped", run_failed: no status, the agent is gone;
 *   - a run still open but silent for TRACE_LIVE_MS: no status. A live
 *     process writes a process_sample every 5 s, so silence is a process
 *     that died without closing its trace, and its last line is not the
 *     present;
 *   - the last turn_finished with nothing after it: throttled when that
 *     turn called `throttle` and the tool accepted it (the harness then
 *     sleeps its pause: runCycles 3, the TUI's throttle engine), idle
 *     otherwise (waiting for mail or for its children);
 *   - anything after the last turn_finished, or no turn finished yet:
 *     working; only process samples (a tail that began inside a long pause)
 *     is no status.
 * `since` is the time of the event that set the status, on the executor's
 * clock. The pause's length is not in the trace (the caller's --pause-ms),
 * so a throttled agent has no throttle_left_s: no countdown, never an
 * invented one.
 * A trace that the harness writes differently makes the test that reads its
 * event names red (tests/js/tasks/agents-status-traces.test.ts).
 */

import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalAgentId } from './agents-status.js';

/** A live run writes a process_sample every 5 s: silent this long, it is not live. */
export const TRACE_LIVE_MS = 30_000;

/** How much of the end of a trace is read: ~10,000 process samples, hours of a pause. */
export const TRACE_TAIL_BYTES = 2 * 1024 * 1024;

/** The events after a turn_finished that mean the agent is at work again. */
const ACTIVITY = new Set(['message_in', 'turn_started', 'round_started', 'tool_started', 'agent_started']);

/** The main agent's own events that name a subagent: it started one, or one reported back. */
const SUBAGENT = new Set(['agent_started', 'agent_finished']);

/** The trace's JSON lines; a partial or broken line is skipped. */
export function parseTraceLines(raw) {
  const events = [];
  for (const line of String(raw).split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === 'object' && typeof ev.type === 'string') events.push(ev);
    } catch {
      /* the first line of a tail, cut in half */
    }
  }
  return events;
}

/**
 * The status of the agent whose newest run wrote `events` (oldest first):
 * { status, since } or null when the trace does not say.
 */
export function statusFromTrace(events, now = Date.now()) {
  const own = events.filter((ev) => (ev.agent === undefined || SUBAGENT.has(ev.type)) && Number.isFinite(Date.parse(ev.ts)));
  if (own.length === 0) return null;
  const last = own[own.length - 1];

  const end = own.findLast((ev) => ev.type === 'run_finished' || ev.type === 'run_failed');
  if (end) return end.type === 'run_finished' && end.reason === 'completed' ? { status: 'idle', since: end.ts } : null;
  if (now - Date.parse(last.ts) > TRACE_LIVE_MS) return null;

  const turnEnd = own.findLastIndex((ev) => ev.type === 'turn_finished');
  if (turnEnd < 0) {
    // only samples: the tail began inside a pause or a wait, and does not say which
    const first = own.find((ev) => ev.type === 'run_started' || ACTIVITY.has(ev.type));
    return first ? { status: 'working', since: first.ts } : null;
  }
  const after = own.slice(turnEnd + 1).find((ev) => ACTIVITY.has(ev.type));
  if (after) return { status: 'working', since: after.ts };

  const turnStart = own.findLastIndex((ev, i) => i < turnEnd && ev.type === 'turn_started');
  const paused = own
    .slice(turnStart + 1, turnEnd)
    .some((ev) => ev.type === 'tool_finished' && ev.name === 'throttle' && ev.outcome === 'accepted');
  return { status: paused ? 'throttled' : 'idle', since: own[turnEnd].ts };
}

async function readTail(path, bytes = TRACE_TAIL_BYTES) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await file.read(buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    await file.close();
  }
}

/**
 * Reads <logsDir>/<agent>/<newest run>.jsonl for every agent and answers the
 * map to publish under "api": { uid: { status, since } }, or null when the
 * logs cannot be read at all (then nothing is published).
 */
export function createApiAgentsStatusReader({ logsDir, tail = readTail } = {}) {
  return {
    async read(now = new Date()) {
      let agents;
      try {
        agents = await readdir(logsDir, { withFileTypes: true });
      } catch {
        return null;
      }
      const map = {};
      for (const dir of agents) {
        if (!dir.isDirectory()) continue;
        try {
          const runs = (await readdir(join(logsDir, dir.name))).filter((f) => f.endsWith('.jsonl')).sort();
          if (runs.length === 0) continue;
          const status = statusFromTrace(parseTraceLines(await tail(join(logsDir, dir.name, runs.at(-1)))), now.getTime());
          if (status) map[canonicalAgentId(dir.name)] = status;
        } catch {
          /* an agent whose trace cannot be read has no status */
        }
      }
      return map;
    },
  };
}
