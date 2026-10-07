import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { observeTeamRunning } from "../../../cli/src/lib/team-observed.js";
import {
  cleanup,
  fakeCloud,
  runDaemon,
  sandbox,
} from "./cloud-daemon-heartbeat.harness";

// The polling daemon's heartbeat: what it observes, and its exit.
// Story and harness: cloud-daemon-heartbeat.harness.ts.
afterEach(cleanup);

describe("cloud daemon — the heartbeat of the polling loop", () => {
  it(
    "on a box with no tmux, reads is_running from the JHT API team's traces",
    async () => {
      // The test box: a cloud-only daemon, the API team at work, no tmux.
      // The TUI rule cannot tell there, is_running stayed false, and the
      // office said «team off».
      const cloud = await fakeCloud();
      const { home, bin } = sandbox(cloud.baseUrl, "exit 127");
      const dir = path.join(home, "api-logs", "scout-1");
      mkdirSync(dir, { recursive: true });
      const ts = new Date().toISOString();
      writeFileSync(
        path.join(dir, `${ts.replace(/[:.]/g, "-")}.jsonl`),
        `${JSON.stringify({ type: "run_started", ts })}\n${JSON.stringify({ type: "turn_started", turn: 1, ts })}\n`,
      );
      await runDaemon(home, bin, 3_000, { JHT_API_TRACES_DIR: path.dirname(dir) });
      expect(cloud.beats.length).toBeGreaterThanOrEqual(1);
      expect(cloud.beats[0]!.body.is_running).toBe(true);
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
