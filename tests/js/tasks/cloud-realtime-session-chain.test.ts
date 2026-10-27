import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The daemon authenticates with the refresh token in cloud.json, and Supabase rotates it at every use:
// a token presented again after its reuse window ends the whole session ("Already Used"), and only a new
// pairing brings it back. Three things keep that from happening by our own hand, and one says so when it
// has happened anyway (cli/src/lib/cloud-realtime.js, cloud-sync-notice.js):
//  - the rotated token is written to cloud.json one write after the other, said when it fails, and
//    waited for when the daemon stops;
//  - a token the server refuses is not the end if cloud.json already holds a different one (another
//    process rotated it since this one read its config): that one is tried, once;
//  - a session that is really gone is a distinct error, and the user is told once per sync token.
// Synthetic tokens only.

const USER = "00000000-0000-4000-8000-000000000001";
const SYNC_TOKEN = "jht_sync_AbCdsynthetic-not-a-real-token";

type Refresh = { data: any; error: any };
const ok = (refresh: string): Refresh => ({
  data: { session: { access_token: "synthetic-access", refresh_token: refresh, user: { id: USER } } },
  error: null,
});
const alreadyUsed = (): Refresh => ({
  data: { session: null },
  error: Object.assign(new Error("Invalid Refresh Token: Already Used"), { code: "refresh_token_already_used", status: 400 }),
});
const network = (): Refresh => ({
  data: { session: null },
  error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }),
});

function fakeClient(answer: (token: string) => Refresh) {
  const tried: string[] = [];
  const events: Array<(event: string, session: any) => void> = [];
  const stops: string[] = [];
  const client = {
    auth: {
      refreshSession: async ({ refresh_token }: { refresh_token: string }) => {
        tried.push(refresh_token);
        return answer(refresh_token);
      },
      onAuthStateChange: (cb: (event: string, session: any) => void) => { events.push(cb); },
      stopAutoRefresh: async () => { stops.push("stopAutoRefresh"); },
    },
    realtime: { setAuth: async () => {}, isConnected: () => true, disconnect: async () => { stops.push("disconnect"); } },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => {},
  };
  return { client, tried, events, stops };
}

let home: string;
let previousHome: string | undefined;
const cloudFile = () => path.join(home, "cloud.json");
const stored = () => JSON.parse(readFileSync(cloudFile(), "utf8")).supabase_refresh_token;

beforeEach(() => {
  previousHome = process.env.JHT_HOME;
  home = mkdtempSync(path.join(tmpdir(), "jht-session-chain-"));
  process.env.JHT_HOME = home;
  writeFileSync(cloudFile(), JSON.stringify({ enabled: true, token: SYNC_TOKEN, supabase_refresh_token: "synthetic-on-disk" }));
  vi.resetModules();
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

async function connect(fake: ReturnType<typeof fakeClient>, refresh = "synthetic-in-config", log: (l: string, m: string) => void = () => {}) {
  const { createRealtimeSync } = await import("../../../cli/src/lib/cloud-realtime.js");
  return createRealtimeSync({
    config: { supabase_url: "https://example.invalid", supabase_refresh_token: refresh, user_id: USER },
    createClient: () => fake.client,
    log,
  });
}

describe("the rotated refresh token reaches cloud.json", () => {
  it("is saved at boot and at every rotation, the last rotation winning", async () => {
    const fake = fakeClient(() => ok("synthetic-boot"));
    const rt = await connect(fake);
    expect(stored()).toBe("synthetic-boot");
    // a burst of rotations: the file ends with the last, whatever the order the reads and writes interleave in
    for (const n of [1, 2, 3, 4, 5]) fake.events[0]!("TOKEN_REFRESHED", { access_token: "a", refresh_token: `synthetic-rotation-${n}` });
    await rt.close();
    expect(stored()).toBe("synthetic-rotation-5");
  });

  it("close() waits for a write still pending and stops the auto-refresh before anything else", async () => {
    const fake = fakeClient(() => ok("synthetic-boot"));
    const rt = await connect(fake);
    fake.events[0]!("TOKEN_REFRESHED", { access_token: "a", refresh_token: "synthetic-last" });
    await rt.close();
    expect(stored()).toBe("synthetic-last");
    expect(fake.stops[0]).toBe("stopAutoRefresh");
  });

  it("says when the token could not be saved, instead of swallowing it", async () => {
    const fake = fakeClient(() => ok("synthetic-boot"));
    const lines: string[] = [];
    const rt = await connect(fake, "synthetic-in-config", (level, msg) => lines.push(`${level}: ${msg}`));
    rmSync(cloudFile());
    fake.events[0]!("TOKEN_REFRESHED", { access_token: "a", refresh_token: "synthetic-lost" });
    await rt.close();
    expect(lines.join("\n")).toMatch(/warn: could not save the rotated refresh token/);
    expect(lines.join("\n")).not.toContain("synthetic-lost");
  });
});

describe("a refresh token the server refuses", () => {
  it("is not the end when cloud.json holds a different one: that one is tried, once", async () => {
    const fake = fakeClient((token) => (token === "synthetic-on-disk" ? ok("synthetic-next") : alreadyUsed()));
    const rt = await connect(fake, "synthetic-in-config");
    expect(fake.tried).toEqual(["synthetic-in-config", "synthetic-on-disk"]);
    expect(rt.userId).toBe(USER);
    await rt.close();
    expect(stored()).toBe("synthetic-next");
  });

  it("is not tried twice when cloud.json holds the same one", async () => {
    const fake = fakeClient(() => alreadyUsed());
    await expect(connect(fake, "synthetic-on-disk")).rejects.toMatchObject({ code: "session_lost" });
    expect(fake.tried).toEqual(["synthetic-on-disk"]);
  });

  it("is a lost session when both are refused, and the message keeps the server's words", async () => {
    const fake = fakeClient(() => alreadyUsed());
    await expect(connect(fake, "synthetic-in-config")).rejects.toMatchObject({
      code: "session_lost",
      message: expect.stringContaining("cloud-realtime auth: Invalid Refresh Token: Already Used"),
    });
    expect(fake.tried).toEqual(["synthetic-in-config", "synthetic-on-disk"]);
  });

  it("is told apart from the network: a hiccup is not a lost session and is not retried", async () => {
    const fake = fakeClient(() => network());
    const failure = await connect(fake).catch((e) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.code).toBeUndefined();
    expect(failure.message).toContain("cloud-realtime auth: fetch failed");
    expect(fake.tried).toEqual(["synthetic-in-config"]);
  });
});

describe("a session that ends while the daemon runs", () => {
  it("is told once through onSessionLost, and writes nothing to cloud.json", async () => {
    const fake = fakeClient(() => ok("synthetic-boot"));
    const lost = vi.fn();
    const { createRealtimeSync } = await import("../../../cli/src/lib/cloud-realtime.js");
    const rt = await createRealtimeSync({
      config: { supabase_url: "https://example.invalid", supabase_refresh_token: "synthetic-in-config", user_id: USER },
      createClient: () => fake.client,
      onSessionLost: lost,
    });
    expect(lost).not.toHaveBeenCalled();
    fake.events[0]!("SIGNED_OUT", null);
    fake.events[0]!("SIGNED_OUT", null);
    expect(lost).toHaveBeenCalledTimes(1);
    await rt.close();
    expect(stored()).toBe("synthetic-boot");
  });

  it("a callback that throws does not reach the client", async () => {
    const fake = fakeClient(() => ok("synthetic-boot"));
    const { createRealtimeSync } = await import("../../../cli/src/lib/cloud-realtime.js");
    await createRealtimeSync({
      config: { supabase_url: "https://example.invalid", supabase_refresh_token: "synthetic-in-config", user_id: USER },
      createClient: () => fake.client,
      onSessionLost: () => { throw new Error("boom"); },
    });
    expect(() => fake.events[0]!("SIGNED_OUT", null)).not.toThrow();
  });
});

describe("the notice of a lost session", () => {
  it("tells the user once per sync token, by its public prefix, and only for a lost session", async () => {
    const { noticeLostSession } = await import("../../../cli/src/lib/cloud-sync-notice.js");
    const run = vi.fn(async () => ({ notified: true, code: "session_lost", row_id: 9 }));
    const memo = new Set<string>();
    const lost = Object.assign(new Error("x"), { code: "session_lost" });

    expect(await noticeLostSession(new Error("fetch failed"), SYNC_TOKEN, { run, memo })).toMatchObject({ reason: "not_lost" });
    expect(await noticeLostSession(null, SYNC_TOKEN, { run, memo })).toMatchObject({ reason: "not_lost" });
    expect(await noticeLostSession(lost, "not-a-sync-token", { run, memo })).toMatchObject({ reason: "token_unreadable" });
    expect(run).not.toHaveBeenCalled();

    expect(await noticeLostSession(lost, SYNC_TOKEN, { run, memo })).toMatchObject({ notified: true });
    expect(run).toHaveBeenCalledWith(["session_lost", "jht_sync_AbCd"]);
    expect(await noticeLostSession(lost, SYNC_TOKEN, { run, memo })).toMatchObject({ reason: "already_told" });
    expect(run).toHaveBeenCalledTimes(1);
    // the whole token never goes in the command
    expect(JSON.stringify(run.mock.calls)).not.toContain("synthetic");
  });

  it("is not marked as told when the notice could not go out, and never throws", async () => {
    const { noticeLostSession } = await import("../../../cli/src/lib/cloud-sync-notice.js");
    const lost = Object.assign(new Error("x"), { code: "session_lost" });
    const memo = new Set<string>();
    const lines: string[] = [];
    const boom = vi.fn(async () => { throw new Error("no python"); });
    expect(await noticeLostSession(lost, SYNC_TOKEN, { run: boom, memo, log: (m) => lines.push(m) }))
      .toMatchObject({ reason: "notice_script_failed" });
    expect(memo.size).toBe(0);
    expect(lines).toHaveLength(1);
  });
});

describe("the daemon", () => {
  it("tells the user from the Realtime setup's catch, without waiting for the script", () => {
    const source = readFileSync(path.join(__dirname, "../../../cli/src/commands/cloud.js"), "utf8")
      .replace(/\r\n/g, "\n");
    // boot: the setup's catch; later: the session ending while the daemon runs
    const catchBlock = source.slice(source.indexOf("cloud-realtime failed setup"));
    expect(catchBlock.slice(0, 300)).toMatch(/if \(e\?\.code === 'session_lost'\) sessionLost\(e\);/);
    expect(source).toMatch(/const sessionLost = \(e\) => \{[\s\S]*?void noticeLostSession\(e, config\?\.token/);
    expect(source).toMatch(/createRealtimeSync\(\{\s*config,\s*log,\s*onSessionLost: \(\) => sessionLost\(\{ code: 'session_lost' \}\),/);
  });

  it("the direct reader writes the token through the same queue as the Realtime client", () => {
    const direct = readFileSync(path.join(__dirname, "../../../cli/src/lib/cloud-direct.js"), "utf8");
    expect(direct).toMatch(/import \{ persistRefreshToken \} from '\.\/cloud-realtime\.js'/);
    expect(direct).not.toMatch(/writePrivateJson|c\.supabase_refresh_token\s*=/);
  });
});
