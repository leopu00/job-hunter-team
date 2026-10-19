import type { SupabaseClient } from "@supabase/supabase-js";
import type { PositionWithScore } from "@/lib/types";
import type { DesktopVpsRead } from "@/lib/desktop-vps-positions";
import { createFreshFilter, type FoundPosition } from "./fresh";

/** The VPS is read again this often while the read-only view is open, and no faster. */
export const VPS_EVERY_MS = 5 * 60 * 1000;
/** After errors the wait doubles up to this. */
export const VPS_MAX_EVERY_MS = 60 * 60 * 1000;
/** Positions arriving close together are told in one go. */
export const BATCH_MS = 5000;

/**
 * Errors after which the VPS is not read again in the background: the connection's identity or
 * keys are in question, and that is for the person to look at in the foreground, never a retry,
 * a reconnection or a question about a host key behind their back.
 */
export function stopsTheWatch(code: string): boolean {
  return (
    code === "not_desktop" ||
    code === "ssh_auth_failed" ||
    code === "existing_team_target_changed" ||
    code.startsWith("host_key") ||
    code.startsWith("ssh_host_key")
  );
}

function found(row: Record<string, unknown>): FoundPosition | null {
  const id = typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : "";
  if (!id) return null;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return { id, title: text(row.title), company: text(row.company), foundAt: text(row.found_at) };
}

type Timer = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
const TIMER: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * An existing team's VPS, read again every VPS_EVERY_MS with the read-only list the pages use
 * (newest first, a few rows): the first read only learns what is there. An error makes the wait
 * longer; an error about the connection's identity stops the watch. Stopped by the caller when the
 * view closes or its connection changes.
 */
export function watchVpsPositions(opts: {
  read: () => Promise<DesktopVpsRead<PositionWithScore[]>>;
  onNew: (rows: FoundPosition[]) => void;
  now?: () => number;
  timer?: Timer;
}): () => void {
  const timer = opts.timer ?? TIMER;
  const fresh = createFreshFilter({ startedAt: (opts.now ?? Date.now)(), silentFirst: true });
  let stopped = false;
  let handle: unknown = null;
  let wait = VPS_EVERY_MS;
  const tick = async () => {
    if (stopped) return;
    const result = await opts.read().catch((): DesktopVpsRead<PositionWithScore[]> => ({ source: "unavailable", code: "desktop_transport_unavailable" }));
    if (stopped) return;
    if (result.source === "vps") {
      wait = VPS_EVERY_MS;
      const rows = result.data.map((r) => found(r as unknown as Record<string, unknown>)).filter((r): r is FoundPosition => r !== null);
      const fresh_ = fresh.take(rows);
      if (fresh_.length) opts.onNew(fresh_);
    } else {
      const code = result.source === "not_desktop" ? "not_desktop" : result.code;
      if (stopsTheWatch(code)) {
        stopped = true;
        return;
      }
      wait = Math.min(wait * 2, VPS_MAX_EVERY_MS);
    }
    handle = timer.set(() => void tick(), wait);
  };
  void tick();
  return () => {
    stopped = true;
    if (handle !== null) timer.clear(handle);
  };
}

/**
 * The person's own positions in the cloud, as they are inserted (Realtime, the user's own session
 * and rows only: user_id on the filter, the session's token on the socket). Inserts close together
 * are told in one go; rows found long before are not new (createFreshFilter).
 */
export function watchCloudPositions(opts: {
  client: Pick<SupabaseClient, "auth" | "channel" | "removeChannel" | "realtime">;
  onNew: (rows: FoundPosition[]) => void;
  now?: () => number;
  timer?: Timer;
}): () => void {
  const timer = opts.timer ?? TIMER;
  const fresh = createFreshFilter({ startedAt: (opts.now ?? Date.now)(), silentFirst: false });
  let gone = false;
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;
  let batch: FoundPosition[] = [];
  let flush: unknown = null;
  void (async () => {
    try {
      const { data } = await opts.client.auth.getSession();
      const session = data.session;
      if (gone || !session) return;
      await opts.client.realtime?.setAuth?.(session.access_token);
      if (gone) return;
      channel = opts.client.channel(`notify:${session.user.id}`);
      channel.on(
        "postgres_changes" as never,
        { event: "INSERT", schema: "public", table: "positions", filter: `user_id=eq.${session.user.id}` } as never,
        ((payload: { new: unknown }) => {
          const row = payload.new && typeof payload.new === "object" ? found(payload.new as Record<string, unknown>) : null;
          const taken = row ? fresh.take([row]) : [];
          if (!taken.length || gone) return;
          batch.push(...taken);
          flush ??= timer.set(() => {
            flush = null;
            const rows = batch;
            batch = [];
            if (!gone && rows.length) opts.onNew(rows);
          }, BATCH_MS);
        }) as never,
      );
      channel.subscribe();
    } catch {
      // no session, no socket: no notifications, nothing else breaks
    }
  })();
  return () => {
    gone = true;
    if (flush !== null) timer.clear(flush);
    if (channel) void opts.client.removeChannel(channel);
  };
}
