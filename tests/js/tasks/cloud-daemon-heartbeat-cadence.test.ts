import { afterEach, describe, expect, it } from "vitest";

import {
  cleanup,
  fakeCloud,
  runDaemon,
  sandbox,
} from "./cloud-daemon-heartbeat.harness";

// The polling daemon's heartbeat: the clock, not a count of rounds.
// Story and harness: cloud-daemon-heartbeat.harness.ts.
afterEach(cleanup);

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
});
