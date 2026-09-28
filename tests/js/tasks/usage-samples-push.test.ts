import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  pushUsageSamples,
  readUsageSamples,
  usageSampleKey,
  USAGE_FIRST_LOOKBACK_MS,
  USAGE_PUSH_EVERY_MS,
} from "../../../cli/src/lib/usage-samples-push.js";

// The TUI team's usage window has not reached the cloud since 21/05: the
// daemon stopped sending the sentinel bridge's samples (91ebfb6f2, for their
// volume) and nothing took over. The desktop's Budget page says «—».

const REPO = path.resolve(__dirname, "../../..");
const roots: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-28T01:00:00.000Z");
const sample = (minutesAgo: number, extra: object = {}) => ({
  ts: new Date(NOW - minutesAgo * 60_000).toISOString(),
  provider: "openai",
  usage: 23,
  weekly_usage: 23,
  status: "OK",
  throttle: 0,
  source: "bridge",
  ...extra,
});
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

function box(rows: object[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "jht-usage-"));
  roots.push(dir);
  const samplesPath = path.join(dir, "sentinel-data.jsonl");
  writeFileSync(samplesPath, jsonl(rows));
  return { dir, samplesPath, statePath: path.join(dir, "cursor.json") };
}

/** A /api/cloud-sync/push that answers as the route does: how many ticks it wrote. */
function route(written: (rows: unknown[]) => number = (rows) => rows.length, status = 200) {
  const bodies: any[] = [];
  const fetchFn = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return new Response(JSON.stringify({ ok: status === 200, sentinel_ticks: { upserted: written(body.sentinel_ticks) } }), { status });
  });
  return { fetchFn, bodies };
}
const config = { enabled: true, base_url: "https://cloud.example", token: "jht_sync_synthetic_usage" };

describe("which samples go", () => {
  it("the new ones after the cursor, oldest first, at most the limit; a broken or unusable line is skipped", () => {
    const raw =
      jsonl([sample(30), sample(10), sample(20), sample(5, { usage: null }), sample(4, { provider: "" })]) + "{cut in half\n";
    const since = new Date(NOW - 25 * 60_000).toISOString();
    expect(readUsageSamples(raw, { since, now: NOW }).map((s) => s.ts)).toEqual([sample(20).ts, sample(10).ts]);
    expect(readUsageSamples(raw, { since, now: NOW, limit: 1 }).map((s) => s.ts)).toEqual([sample(20).ts]);
  });

  it("two lines with the route's key are one row: the later line goes, the request is never refused for it", () => {
    // The route upserts ON CONFLICT (user_id, sample_key): the same key twice in
    // one request is Postgres 21000, a 500 on every round, the cursor still.
    const raw = jsonl([
      sample(10, { usage: 20 }),
      sample(10, { usage: 21 }), // same instant, provider, source, no session: same key
      sample(8, { sample_key: "k-1", usage: 30 }),
      sample(6, { sample_key: "k-1", usage: 31 }), // same explicit key, later time
      sample(10, { source: "other" }), // same instant, another source: another key
    ]);
    const rows = readUsageSamples(raw, { now: NOW });
    const keys = rows.map(usageSampleKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows).toHaveLength(3);
    expect(rows.find((r: any) => r.source === "bridge" && !r.sample_key)!.usage).toBe(21);
    expect(rows.find((r: any) => r.sample_key === "k-1")!.usage).toBe(31);
  });

  it("the lane's key is the route's key", () => {
    const src = readFileSync(path.join(REPO, "web/app/api/cloud-sync/push/route.ts"), "utf8");
    expect(src).toMatch(/cleanText\(t\.sample_key\) \?\?\s*`\$\{isoTs\}\|\$\{provider\}\|\$\{source \?\? ""\}\|\$\{sessionId \?\? ""\}`/);
    expect(src).toContain('onConflict: "user_id,sample_key"');
    expect(usageSampleKey(sample(0, { provider: " openai ", session_id: "s1" }))).toBe(`${sample(0).ts}|openai|bridge|s1`);
  });

  it("the first time, only the last day: not the whole history of the box", () => {
    const old = sample(USAGE_FIRST_LOOKBACK_MS / 60_000 + 60);
    expect(readUsageSamples(jsonl([old, sample(10)]), { now: NOW }).map((s) => s.ts)).toEqual([sample(10).ts]);
  });
});

describe("the lane (pushUsageSamples)", () => {
  it("sends the new samples in one request, and moves the cursor when the route wrote them all", async () => {
    const b = box([sample(30), sample(10)]);
    const r = route();
    const headers = { Authorization: "Bearer jht_sync_synthetic_usage", "Content-Type": "application/json" };
    const first = await pushUsageSamples({ config, ...b, now: NOW, fetchFn: r.fetchFn, headers });
    expect(first).toEqual({ sent: 2, advanced: true, reason: "written" });
    expect(r.fetchFn).toHaveBeenCalledTimes(1);
    expect(r.fetchFn.mock.calls[0]![0]).toBe("https://cloud.example/api/cloud-sync/push");
    expect(r.fetchFn.mock.calls[0]![1].headers).toEqual(headers);
    expect(Object.keys(r.bodies[0])).toEqual(["sentinel_ticks"]);
    expect(JSON.parse(readFileSync(b.statePath, "utf8")).last_ts).toBe(sample(10).ts);

    // A new sample: not before a quarter hour, then only that one.
    writeFileSync(b.samplesPath, jsonl([sample(30), sample(10), sample(1)]));
    expect(await pushUsageSamples({ config, ...b, now: NOW + 60_000, fetchFn: r.fetchFn })).toMatchObject({ reason: "not_due" });
    expect(r.fetchFn).toHaveBeenCalledTimes(1);
    await pushUsageSamples({ config, ...b, now: NOW + USAGE_PUSH_EVERY_MS, fetchFn: r.fetchFn });
    expect(r.bodies[1].sentinel_ticks.map((s: any) => s.ts)).toEqual([sample(1).ts]);
  });

  it("nothing new, no request", async () => {
    const b = box([sample(30)]);
    writeFileSync(b.statePath, JSON.stringify({ last_ts: sample(30).ts }));
    const r = route();
    expect(await pushUsageSamples({ config, ...b, now: NOW, fetchFn: r.fetchFn })).toMatchObject({ reason: "nothing_new" });
    expect(r.fetchFn).not.toHaveBeenCalled();
  });

  it("a refusal or a short count keeps the cursor, says so once, and tries again a quarter hour later", async () => {
    const b = box([sample(30), sample(10)]);
    const log = vi.fn();
    const refused = route(() => 0, 500);
    expect(await pushUsageSamples({ config, ...b, now: NOW, fetchFn: refused.fetchFn, log })).toMatchObject({ advanced: false, reason: "refused" });
    expect(await pushUsageSamples({ config, ...b, now: NOW + USAGE_PUSH_EVERY_MS, fetchFn: refused.fetchFn, log })).toMatchObject({ advanced: false });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(b.statePath, "utf8")).last_ts).toBeUndefined();

    const short = route(() => 1);
    expect(await pushUsageSamples({ config, ...b, now: NOW + 2 * USAGE_PUSH_EVERY_MS, fetchFn: short.fetchFn, log })).toMatchObject({ reason: "count_mismatch" });
    expect(JSON.parse(readFileSync(b.statePath, "utf8")).last_ts).toBeUndefined();

    const ok = route();
    expect(await pushUsageSamples({ config, ...b, now: NOW + 3 * USAGE_PUSH_EVERY_MS, fetchFn: ok.fetchFn, log })).toMatchObject({ advanced: true });
    expect(ok.bodies[0].sentinel_ticks).toHaveLength(2);
  });

  it("the route's rule for a sample it keeps is the lane's: time, usage, provider", () => {
    const src = readFileSync(path.join(REPO, "web/app/api/cloud-sync/push/route.ts"), "utf8");
    expect(src).toContain("if (!Number.isFinite(tsMs) || usage === null || !provider) return null;");
    expect(src).toContain("sentinel_ticks: { upserted: sentinelTicksUpserted }");
  });
});

describe("the daemon", () => {
  // The poll loop and the event-driven loop (JHT_REALTIME_SYNC=1, here without
  // Realtime credentials: the parachute ticks) both carry the lane.
  it.each(["0", "1"])("sends the TUI team's usage samples to the cloud, once, in its own request (JHT_REALTIME_SYNC=%s)", async (realtime) => {
    const posts: any[] = [];
    const auth: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.method === "POST" && req.url?.startsWith("/api/cloud-sync/push")) {
          const body = JSON.parse(raw || "{}");
          posts.push(body);
          if (body.sentinel_ticks) auth.push(req.headers.authorization);
          res.end(JSON.stringify({ ok: true, sentinel_ticks: { upserted: body.sentinel_ticks?.length ?? 0 }, receipts: {} }));
          return;
        }
        if (req.url?.startsWith("/api/team-state") && req.method === "GET") {
          res.end(JSON.stringify({ state: { is_running: true } }));
          return;
        }
        res.end("{}");
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const home = mkdtempSync(path.join(tmpdir(), "jht-usage-daemon-"));
    roots.push(home);
    writeFileSync(
      path.join(home, "cloud.json"),
      JSON.stringify({ enabled: true, token: "jht_sync_synthetic_usage", base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    );
    mkdirSync(path.join(home, "logs"));
    const fresh = (m: number) => ({ ...sample(0), ts: new Date(Date.now() - m * 60_000).toISOString() });
    writeFileSync(path.join(home, "logs", "sentinel-data.jsonl"), jsonl([fresh(20), fresh(10)]));

    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [path.join(REPO, "cli", "bin", "jht.js"), "cloud", "daemon", "--interval", "5"], {
        env: { ...process.env, JHT_HOME: home, JHT_DB: path.join(home, "jobs.db"), JHT_REALTIME_SYNC: realtime, JHT_SYNC_CHECK_SEC: "1", JHT_AGENTS_STATUS: "0", IS_CONTAINER: "1", NO_COLOR: "1" },
      });
      child.stdout.resume();
      child.stderr.resume();
      setTimeout(() => child.kill("SIGTERM"), 12_000);
      child.on("close", () => resolve());
    });

    const usage = posts.filter((p) => p.sentinel_ticks);
    // In 12 s: two heavy rounds at least (poll) or the first tick (event-driven), one request.
    expect(usage).toHaveLength(1);
    expect(Object.keys(usage[0])).toEqual(["sentinel_ticks"]);
    expect(usage[0].sentinel_ticks).toHaveLength(2);
    expect(auth).toEqual(["Bearer jht_sync_synthetic_usage"]);
  }, 40_000);
});
