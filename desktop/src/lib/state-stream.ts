import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

/**
 * The channel the app keeps open to the team's container (jht state-stream, in the native side) only SAYS that
 * something changed; it never carries content. The page reads with the commands it always used, which cost
 * milliseconds while the channel is up. So this module holds two things and nothing else: whether the channel
 * is up, and the hints «agents / profile / chat changed, read again».
 *
 *   up        the channel is open: a page may poll slower and read again at a hint.
 *   fallback  the app is trying to open it again (or it dropped): the pages keep today's pace.
 *   off       there is no channel (a VPS, switched off, an app without it, outside the desktop): today's pace.
 *
 * The poll never goes away: with the channel up it only gets slower, because a hint is a suggestion that can
 * be lost. Anything this module does not recognise is `off`, never `up`.
 */
export type StreamState = "up" | "fallback" | "off";
export type StreamTopic = "agents" | "profile" | "chat" | "positions";
export type StreamHint = { topic: StreamTopic; agent?: string };

export const STREAM_EVENT = "state-stream://event";
export const STREAM_STATUS_EVENT = "state-stream://status";
const STATUS_COMMAND = "state_stream_status";

const TOPICS: readonly StreamTopic[] = ["agents", "profile", "chat", "positions"];
const AGENT_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

let state: StreamState = "off";
let started = false;
let visibilityBound = false;
/** Counts the status events heard: an answer to `state_stream_status` asked before one of them is older than it. */
let statusSeq = 0;
const stateListeners = new Set<() => void>();
const hintListeners = new Set<(hint: StreamHint) => void>();

function setState(next: StreamState) {
  if (next === state) return;
  state = next;
  stateListeners.forEach((listener) => listener());
}

/** The closed shape of a status, null for anything else. */
export function parseStreamStatus(raw: unknown): StreamState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = (raw as { state?: unknown }).state;
  return value === "up" || value === "fallback" || value === "off" ? value : null;
}

/** The closed shape of a hint, null for anything else (a topic not in the list, an agent name that is not a name). */
export function parseStreamHint(raw: unknown): StreamHint | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { topic, agent } = raw as { topic?: unknown; agent?: unknown };
  if (typeof topic !== "string" || !TOPICS.includes(topic as StreamTopic)) return null;
  if (agent === undefined || agent === null) return { topic: topic as StreamTopic };
  if (typeof agent !== "string" || !AGENT_NAME.test(agent)) return null;
  return { topic: topic as StreamTopic, agent };
}

async function askStatus(): Promise<void> {
  const before = statusSeq;
  try {
    const next = parseStreamStatus(await invoke<unknown>(STATUS_COMMAND));
    if (statusSeq === before) setState(next ?? "off");
  } catch {
    // An app without the command, or a refusal: no channel.
    if (statusSeq === before) setState("off");
  }
}

/**
 * Starts listening, once. Safe to call again and outside the desktop (the state stays `off`). The listeners
 * are put first and the status is asked after, so a change between the two is not lost.
 */
export async function startStateStream(): Promise<void> {
  if (started || !isTauri()) return;
  started = true;
  try {
    await listen<unknown>(STREAM_STATUS_EVENT, (event) => {
      statusSeq++;
      setState(parseStreamStatus(event.payload) ?? "off");
    });
    await listen<unknown>(STREAM_EVENT, (event) => {
      const hint = parseStreamHint(event.payload);
      if (hint) hintListeners.forEach((listener) => listener(hint));
    });
  } catch {
    setState("off");
    return;
  }
  // A window seen again asks once more: whatever the channel did meanwhile, the state is the native side's.
  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (started && document.visibilityState === "visible") void askStatus();
    });
  }
  await askStatus();
}

export function streamState(): StreamState {
  return state;
}

function subscribeState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Calls `listener` when the state changes; returns the way to stop. */
export function onStreamState(listener: (next: StreamState) => void): () => void {
  const call = () => listener(state);
  return subscribeState(call);
}

export function useStreamState(): StreamState {
  return useSyncExternalStore(subscribeState, streamState, () => "off");
}

/**
 * The pace of a poll: `base` as it is today, `relaxed` while the channel is up. Never below `base`, so a channel
 * can only slow a poll down.
 */
export function streamPace(base: number, relaxed: number): number {
  return state === "up" ? Math.max(base, relaxed) : base;
}

/**
 * Calls `listener` for a hint of `topic` (and of `agent`, when one is given and the hint names one), at most
 * once every `minGapMs`: a burst of hints (a team starting) is one call at the start and one at the end of the
 * gap. Returns the way to stop, which also drops a call that was waiting.
 */
export function onStreamHint(topic: StreamTopic, listener: () => void, minGapMs = 0, agent?: string): () => void {
  let last = Number.NEGATIVE_INFINITY;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    waiting = undefined;
    last = Date.now();
    listener();
  };
  const hear = (hint: StreamHint) => {
    if (hint.topic !== topic) return;
    if (agent !== undefined && hint.agent !== undefined && hint.agent !== agent) return;
    if (waiting !== undefined) return;
    const wait = last + minGapMs - Date.now();
    if (wait <= 0) fire();
    else waiting = setTimeout(fire, wait);
  };
  hintListeners.add(hear);
  return () => {
    hintListeners.delete(hear);
    clearTimeout(waiting);
    waiting = undefined;
  };
}

/** For the tests: forget everything this module heard. */
export function resetStateStreamForTests(): void {
  state = "off";
  started = false;
  statusSeq = 0;
  stateListeners.clear();
  hintListeners.clear();
}
