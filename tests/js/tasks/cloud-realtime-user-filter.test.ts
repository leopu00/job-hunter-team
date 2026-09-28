import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The daemon's Realtime channels (team_state, position_tickets) carried no
// user_id filter: only the RLS kept another user's rows out, and the
// emergency STOP is read from the team_state payload. Every channel now names
// the session's user, and a payload of another user never reaches a handler.

const SESSION_USER = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";

type Channel = {
  topic: string;
  opts: any;
  deliver: (payload: unknown) => void;
};
const channels: Channel[] = [];

function fakeCreateClient() {
  return {
    auth: {
      refreshSession: async () => ({
        data: {
          session: {
            access_token: "synthetic-access",
            refresh_token: "synthetic-refresh-2",
            user: { id: SESSION_USER },
          },
        },
        error: null,
      }),
      onAuthStateChange: () => {},
    },
    realtime: {
      setAuth: async () => {},
      isConnected: () => true,
      disconnect: async () => {},
    },
    channel(topic: string) {
      const entry: Channel = { topic, opts: null, deliver: () => {} };
      const ch = {
        on(_kind: string, opts: any, handler: (payload: unknown) => void) {
          entry.opts = opts;
          entry.deliver = handler;
          return ch;
        },
        subscribe() {
          channels.push(entry);
          return ch;
        },
      };
      return ch;
    },
    removeChannel: async () => {},
  };
}

let home: string;
let previousHome: string | undefined;
beforeAll(() => {
  // cloud-realtime persists the rotated refresh token under JHT_HOME.
  previousHome = process.env.JHT_HOME;
  home = mkdtempSync(path.join(tmpdir(), "jht-realtime-"));
  process.env.JHT_HOME = home;
});
afterAll(() => {
  if (previousHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

async function connect() {
  const { createRealtimeSync } = await import(
    "../../../cli/src/lib/cloud-realtime.js"
  );
  return createRealtimeSync({
    config: {
      supabase_url: "https://example.invalid",
      supabase_refresh_token: "synthetic-refresh",
      // cloud.json may name a stale user: the session's user is the one the
      // RLS sees and the one the filters must name.
      user_id: OTHER_USER,
    },
    createClient: fakeCreateClient,
  });
}

describe("the daemon's Realtime channels", () => {
  it("each channel is filtered on the session's user", async () => {
    channels.length = 0;
    const rt = await connect();
    expect(rt.userId).toBe(SESSION_USER);
    rt.subscribe("team-state", { table: "team_state", event: "UPDATE" }, () => {});
    rt.subscribe("tickets", { table: "position_tickets", event: "*" }, () => {});
    expect(channels.map((ch) => ch.opts.filter)).toEqual([
      `user_id=eq.${SESSION_USER}`,
      `user_id=eq.${SESSION_USER}`,
    ]);
  });

  it("a payload of another user never reaches the handler, the user's own does", async () => {
    channels.length = 0;
    const rt = await connect();
    const seen: unknown[] = [];
    rt.subscribe("team-state", { table: "team_state", event: "UPDATE" }, (p) =>
      seen.push(p),
    );
    const [channel] = channels;
    channel!.deliver({ new: { user_id: OTHER_USER, emergency_stop_requested_at: "now" } });
    channel!.deliver({ new: { user_id: SESSION_USER }, old: { user_id: OTHER_USER } });
    channel!.deliver({ old: { user_id: OTHER_USER } });
    expect(seen).toEqual([]);
    channel!.deliver({ new: { user_id: SESSION_USER, sync_requested_at: "now" } });
    expect(seen).toHaveLength(1);
  });

  it("the daemon's subscriptions pass no filter of their own that would widen it", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      path.resolve(__dirname, "../../../cli/src/commands/cloud.js"),
      "utf-8",
    );
    const subscriptions = source.match(/rt\.subscribe\([^\n]*/g) ?? [];
    expect(subscriptions.length).toBeGreaterThanOrEqual(2);
    for (const line of subscriptions) expect(line).not.toContain("filter");
  });
});
