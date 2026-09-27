import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { observeTeamRunning } from "../../../cli/src/lib/team-observed.js";

// leone, 27/09: the polling daemon (a pairing without Realtime credentials)
// looked hung — no heartbeat for 10+ minutes, a silent log, no connection
// open. It was not hung: the cloud row said is_running = false (nobody wrote
// it any more), the fast rounds backed off to 60 s as for a stopped team, and
// the heartbeat came every 12 of them, ~12 minutes apart, past the 5 minutes
// after which the dashboard shows the box offline. Then SIGTERM printed
// «Daemon stopped.» and the process stayed alive until a SIGKILL.
//
// Here the real daemon runs against a fake /api/team-state that keeps saying
// is_running = false, with a fake tmux on the PATH (IS_CONTAINER=1: tmux is
// run locally, never through docker), so no real tmux, container or cloud is
// touched. --interval 5 is the daemon's floor.
const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");
const roots: string[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Beat = { at: number; body: Record<string, unknown> };

async function fakeCloud(isRunning = false) {
  const beats: Beat[] = [];
  const reads: number[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url?.startsWith("/api/team-state") && req.method === "GET") {
        reads.push(Date.now());
        res.end(JSON.stringify({ state: { is_running: isRunning, should_run: true } }));
        return;
      }
      if (req.url?.startsWith("/api/team-state") && req.method === "PATCH") {
        const body = JSON.parse(raw || "{}") as Record<string, unknown>;
        if (body.last_heartbeat_at) beats.push({ at: Date.now(), body });
        res.end(JSON.stringify({ state: {} }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { beats, reads, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** A JHT_HOME with cloud.json (no Realtime credentials: the polling loop) and a fake tmux. */
function sandbox(baseUrl: string, tmuxScript: string) {
  const home = mkdtempSync(path.join(tmpdir(), "jht-daemon-heartbeat-"));
  roots.push(home);
  writeFileSync(
    path.join(home, "cloud.json"),
    JSON.stringify({ enabled: true, token: "jht_sync_synthetic_heartbeat_test", base_url: baseUrl }),
  );
  const bin = path.join(home, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "tmux"), `#!/bin/sh\n${tmuxScript}\n`);
  chmodSync(path.join(bin, "tmux"), 0o755);
  return { home, bin };
}

function runDaemon(home: string, bin: string, forMs: number, extraEnv: Record<string, string> = {}, interval = "5") {
  return new Promise<{ exitedAfterTermMs: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [JHT_BIN, "cloud", "daemon", "--interval", interval], {
      env: {
        ...process.env,
        JHT_HOME: home,
        JHT_DB: path.join(home, "jobs.db"),
        JHT_REALTIME_SYNC: "0",
        JHT_SYNC_CHECK_SEC: "1",
        IS_CONTAINER: "1",
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        NO_COLOR: "1",
        ...extraEnv,
      },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.resume();
    let termAt = 0;
    const kill = setTimeout(() => {
      termAt = Date.now();
      child.kill("SIGTERM");
    }, forMs);
    // A process that ignores SIGTERM for 8 s is the defect; the test ends it.
    const hard = setTimeout(() => {
      child.kill("SIGKILL");
    }, forMs + 8_000);
    child.on("close", (_code, signal) => {
      clearTimeout(kill);
      clearTimeout(hard);
      resolve({ exitedAfterTermMs: signal === "SIGKILL" ? null : Date.now() - termAt, stderr });
    });
  });
}

describe("cloud daemon — the heartbeat of the polling loop", () => {
  it(
    "beats every interval by the clock even when the cloud says the team is stopped, and says the team runs",
    async () => {
      const cloud = await fakeCloud();
      const { home, bin } = sandbox(cloud.baseUrl, 'printf "CAPITANO\\nSCOUT-1\\njob-hunter-team__charles\\n"');
      const run = await runDaemon(home, bin, 23_000, {}, "10");

      const gaps = cloud.beats.slice(1).map((b, i) => b.at - cloud.beats[i]!.at);
      // Every 10 s by the clock: 3 in 23 s. Counting 10 backed-off fast rounds
      // (1+2+4+8+16+32… s) gave 1.
      expect(cloud.beats.length).toBeGreaterThanOrEqual(3);
      expect(Math.max(...gaps)).toBeLessThan(11_500);
      // ...and without a burst: the heavy round is due by the clock, not after a
      // count of fast rounds run back to back to catch up with it.
      const burst = Math.max(...cloud.reads.map((t) => cloud.reads.filter((u) => u >= t && u - t < 500).length));
      expect(burst).toBeLessThanOrEqual(2);
      // The observed state the cloud had lost: agent sessions in tmux → running.
      for (const beat of cloud.beats) expect(beat.body.is_running).toBe(true);
      expect(run.exitedAfterTermMs).not.toBeNull();
    },
    40_000,
  );

  it(
    "reads through Vercel at most once a minute even when the team runs",
    async () => {
      // No Supabase session: every read is a Vercel invocation. With
      // is_running true (the heartbeat writes it now) the fast round went back
      // to 5 s: ~17,000 invocations a day for one box. The defaults of a box:
      // --interval 60, a 5 s fast round.
      const cloud = await fakeCloud(true);
      const { home, bin } = sandbox(cloud.baseUrl, 'printf "CAPITANO\\nSCOUT-1\\n"');
      await runDaemon(home, bin, 16_000, { JHT_SYNC_CHECK_SEC: "5" }, "60");

      expect(cloud.beats.length).toBe(1);
      expect(cloud.beats[0]!.body.is_running).toBe(true);
      // One round at start, the next one a minute later: at 5 s it was 4 by now.
      expect(cloud.reads.length).toBe(1);
    },
    40_000,
  );

  it(
    "writes no is_running when tmux cannot be read, and false when no tmux server runs",
    async () => {
      const unknown = await fakeCloud();
      const a = sandbox(unknown.baseUrl, "exit 127");
      await runDaemon(a.home, a.bin, 3_000);
      expect(unknown.beats.length).toBeGreaterThanOrEqual(1);
      for (const beat of unknown.beats) expect(beat.body).not.toHaveProperty("is_running");

      const stopped = await fakeCloud();
      const b = sandbox(stopped.baseUrl, 'echo "no server running on /tmp/tmux-0/default" >&2; exit 1');
      await runDaemon(b.home, b.bin, 3_000);
      expect(stopped.beats.length).toBeGreaterThanOrEqual(1);
      for (const beat of stopped.beats) expect(beat.body.is_running).toBe(false);
    },
    40_000,
  );

  it(
    "exits after «Daemon stopped.» even when a handle is left open",
    async () => {
      const cloud = await fakeCloud();
      const { home, bin } = sandbox(cloud.baseUrl, 'printf "CAPITANO\\n"');
      // A module that leaves an interval behind, as something did on leone.
      const preload = path.join(home, "lingering-handle.cjs");
      writeFileSync(preload, "setInterval(() => {}, 1000);\n");
      const run = await runDaemon(home, bin, 3_000, { NODE_OPTIONS: `--require ${preload}` });
      expect(run.exitedAfterTermMs).not.toBeNull();
      expect(run.exitedAfterTermMs!).toBeLessThan(6_000);
    },
    30_000,
  );
});

describe("observeTeamRunning", () => {
  const read = (result: unknown) => () => result as ReturnType<typeof import("../../../cli/src/lib/api/tmux-read.js").readTmuxSessions>;

  it("is jht team status's rule: a session of a team agent", () => {
    expect(observeTeamRunning({ read: read({ tmux: "ok", sessions: ["SCOUT-2"] }) })).toBe(true);
    expect(observeTeamRunning({ read: read({ tmux: "ok", sessions: ["JHT-CAPITANO"] }) })).toBe(true);
    expect(observeTeamRunning({ read: read({ tmux: "ok", sessions: ["job-hunter-team__charles", "main"] }) })).toBe(false);
    expect(observeTeamRunning({ read: read({ tmux: "no-server", sessions: [] }) })).toBe(false);
  });

  it("says nothing when it cannot tell", () => {
    expect(observeTeamRunning({ read: read({ tmux: "absent", sessions: [] }) })).toBeNull();
    expect(observeTeamRunning({ read: () => { throw new Error("boom"); } })).toBeNull();
  });
});
