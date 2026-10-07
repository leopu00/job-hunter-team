// Shared by the four cloud-daemon-heartbeat-*.test.ts files. They were one
// file of nine tests run in series, 100 s on its own, the tail of the vitest
// job (the other 215 files were done ~45 s earlier): split by subject so that
// vitest runs them side by side. Each test still owns its daemon, its fake
// cloud on port 0 and its JHT_HOME.

import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

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

/** Each test file registers it: `afterEach(cleanup)`. */
export function cleanup() {
  for (const server of servers.splice(0)) server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export type Beat = { at: number; body: Record<string, unknown> };

export async function fakeCloud(isRunning = false, refuse: (body: Record<string, unknown>) => number | null = () => null) {
  const beats: Beat[] = [];
  const reads: number[] = [];
  // Every PATCH the route received, accepted or not: a Vercel invocation each.
  const patches: Beat[] = [];
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
        patches.push({ at: Date.now(), body });
        const refused = refuse(body);
        if (refused) {
          res.statusCode = refused;
          res.end(JSON.stringify({ error: "refused" }));
          return;
        }
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
  return { beats, reads, patches, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** A JHT_HOME with cloud.json (no Realtime credentials: the polling loop) and a fake tmux. */
export function sandbox(baseUrl: string, tmuxScript: string) {
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

/** The PATCHes but the periodic push's outcome (cloud_push_status). */
export function ownPatches(cloud: { patches: Beat[] }) {
  return cloud.patches.filter((p) => !("cloud_push_status" in p.body));
}

/** A JHT API executor's logs with one agent whose run completed just now: idle. */
export function apiTraces(home: string) {
  const dir = path.join(home, "api-logs", "scout-1");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString();
  writeFileSync(
    path.join(dir, `${ts.replace(/[:.]/g, "-")}.jsonl`),
    `${JSON.stringify({ type: "run_started", ts })}\n${JSON.stringify({ type: "run_finished", reason: "completed", ts })}\n`,
  );
  return path.dirname(dir);
}

export function runDaemon(home: string, bin: string, forMs: number, extraEnv: Record<string, string> = {}, interval = "5") {
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
