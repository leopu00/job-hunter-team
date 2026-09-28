import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfficeEvent, OfficeSnapshot } from "./contract";

/**
 * The office alive (D09): it follows the cloud by itself, without a reload.
 *
 *  - Realtime on what the office reads (positions, position_transitions,
 *    team_state), the user's rows only. A change asks for a read; reads are
 *    never closer than READ_GAP_MS, the changes in between make one read.
 *  - While the channel is not up (not yet, fallen, refused), a read every
 *    READ_GAP_MS instead. When it comes back, one read to catch up:
 *    postgres_changes does not replay what was missed.
 *  - A transition that arrives on the channel is a trip at once, not at the
 *    next read; the read that brings it again does not make it twice.
 *  - The first snapshot seats everyone and moves nobody: the transitions
 *    already there are the past (diffOfficeSnapshots with prev = null).
 */

export const READ_GAP_MS = 60_000;

type Timers = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
};

export type ReadScheduler = {
  /** something changed: read as soon as the gap allows (changes in between make one read) */
  poke(): void;
  /** the channel's state: down = a read every gap, up = only on changes (and one read to catch up) */
  setChannel(up: boolean): void;
  stop(): void;
};

export function createReadScheduler(read: () => Promise<void>, options: { gapMs?: number; timers?: Timers } = {}): ReadScheduler {
  const gap = options.gapMs ?? READ_GAP_MS;
  const t = options.timers ?? realTimers;
  let lastStart = -Infinity;
  let reading = false;
  let wanted = false;
  let timer: unknown = null;
  let fallback: unknown = null;
  let channelUp = false;
  let stopped = false;

  const run = () => {
    timer = null;
    if (stopped) return;
    if (reading) {
      wanted = true;
      return;
    }
    reading = true;
    wanted = false;
    lastStart = t.now();
    read()
      .catch(() => undefined)
      .finally(() => {
        reading = false;
        if (wanted) poke();
      });
  };
  const poke = () => {
    if (stopped) return;
    if (reading) {
      wanted = true;
      return;
    }
    if (timer !== null) return;
    timer = t.setTimeout(run, Math.max(0, lastStart + gap - t.now()));
  };
  const armFallback = () => {
    if (stopped || channelUp) return;
    fallback = t.setTimeout(() => {
      fallback = null;
      poke();
      armFallback();
    }, gap);
  };

  poke();
  armFallback();
  return {
    poke,
    setChannel(up) {
      if (up === channelUp) return;
      channelUp = up;
      if (up) {
        if (fallback !== null) t.clearTimeout(fallback);
        fallback = null;
        poke();
      } else {
        armFallback();
      }
    },
    stop() {
      stopped = true;
      if (timer !== null) t.clearTimeout(timer);
      if (fallback !== null) t.clearTimeout(fallback);
    },
  };
}

type Transition = OfficeSnapshot["transitions"][number];

/** One way to write a time, whoever wrote it (PostgREST and Realtime do not agree on timestamptz). */
function iso(ts: string): string {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? ts : new Date(ms).toISOString();
}

const normalise = (s: OfficeSnapshot): OfficeSnapshot => ({ ...s, transitions: (s.transitions ?? []).map((x) => ({ ...x, ts: iso(x.ts) })) });

/** A position_transitions row, as Realtime sends it, as a snapshot's transition; null when it is not one. */
export function transitionFromRow(row: unknown): Transition | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.ts !== "string" || typeof r.by_agent !== "string" || typeof r.position_legacy_id !== "number") return null;
  return {
    ts: iso(r.ts),
    byAgent: r.by_agent,
    from: typeof r.from_state === "string" ? r.from_state : null,
    to: typeof r.to_state === "string" ? r.to_state : null,
    position: { id: null, legacyId: r.position_legacy_id, title: null, company: null },
  };
}

/** The channel's transitions kept at most, waiting for a read to bring them (the oldest are forgotten first). */
export const WALKED_MAX = 1000;

export type LiveOffice = {
  /** a full read: what changed since the last one */
  snapshot(next: OfficeSnapshot): void;
  /** a transition from the channel: its trip now, never again at the next read */
  transition(t: Transition): void;
  /** how many channel transitions wait for a read to bring them */
  pending(): number;
};

/**
 * Between the reads and the engine. `apply` gets the events; `diff` is the
 * data layer's (diffOfficeSnapshots), fed with snapshots whose times are
 * written one way, and with the channel's transitions already counted as
 * seen.
 */
export function createLiveOffice(diff: (prev: OfficeSnapshot | null, next: OfficeSnapshot) => OfficeEvent[], apply: (e: OfficeEvent) => void): LiveOffice {
  let prev: OfficeSnapshot | null = null;
  const key = (x: Transition) => `${x.ts}|${x.byAgent}|${x.position.legacyId}|${x.from ?? ""}|${x.to ?? ""}`;
  // The channel's transitions already walked, apart from the last read: a
  // read that left before the INSERT does not bring them, and must not make
  // the read after it walk them again. Taken out of what the diff sees as
  // new (not added to `prev`, whose oldest transition is the diff's
  // threshold); kept until a read brings them.
  const walked = new Set<string>();
  return {
    snapshot(next) {
      const n = normalise(next);
      const fresh = walked.size > 0 ? { ...n, transitions: n.transitions.filter((x) => !walked.has(key(x))) } : n;
      for (const e of diff(prev, fresh)) apply(e);
      for (const x of n.transitions) walked.delete(key(x));
      prev = n;
    },
    transition(raw) {
      const t = { ...raw, ts: iso(raw.ts) };
      // before the first read the office is not seated yet; an agent not in it enters with the next read
      if (!prev || t.to === null || !(prev.roster ?? []).some((a) => a.uid === t.byAgent)) return;
      if (walked.has(key(t)) || prev.transitions.some((x) => key(x) === key(t))) return;
      apply({ type: "pipeline", uid: t.byAgent, toState: t.to, position: t.position, ts: t.ts });
      walked.add(key(t));
      if (walked.size > WALKED_MAX) walked.delete(walked.values().next().value!);
    },
    pending: () => walked.size,
  };
}

/**
 * The channel: positions and team_state (published since 058 and 021) and
 * position_transitions (published by migration 090), the user's rows only.
 * `onStatus(true)` when it is up, `(false)` when it falls or is refused.
 * Any failure is a channel that is not up: the reads fall back to the gap.
 */
let mounts = 0;

export function subscribeOffice(
  client: Pick<SupabaseClient, "auth" | "channel" | "removeChannel" | "realtime">,
  handlers: { onChange: () => void; onTransition: (t: Transition) => void; onStatus: (up: boolean) => void },
): () => void {
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;
  let gone = false;
  void (async () => {
    try {
      const { data } = await client.auth.getSession();
      const session = data.session;
      if (gone || !session) return handlers.onStatus(false);
      await client.realtime?.setAuth?.(session.access_token);
      // unmounted while waiting: no channel, or it would outlive the page
      if (gone) return;
      const filter = `user_id=eq.${session.user.id}`;
      const on = (table: string, event: "*" | "INSERT", cb: (payload: { new: unknown }) => void) =>
        channel!.on("postgres_changes" as never, { event, schema: "public", table, filter } as never, cb as never);
      // a topic of its own for each mount: the client keeps one channel per topic
      channel = client.channel(`office:${session.user.id}:${++mounts}`);
      on("positions", "*", () => handlers.onChange());
      on("team_state", "*", () => handlers.onChange());
      on("position_transitions", "INSERT", (payload) => {
        const t = transitionFromRow(payload.new);
        if (t) handlers.onTransition(t);
        handlers.onChange();
      });
      channel.subscribe((status: string) => {
        if (gone) return;
        handlers.onStatus(status === "SUBSCRIBED");
      });
    } catch {
      if (!gone) handlers.onStatus(false);
    }
  })();
  return () => {
    gone = true;
    if (channel) void client.removeChannel(channel);
  };
}
