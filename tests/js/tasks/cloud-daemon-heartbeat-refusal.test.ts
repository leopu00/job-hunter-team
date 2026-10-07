import { afterEach, describe, expect, it } from "vitest";

import {
  apiTraces,
  cleanup,
  fakeCloud,
  ownPatches,
  runDaemon,
  sandbox,
} from "./cloud-daemon-heartbeat.harness";

// The polling daemon's heartbeat: a refused body.
// Story and harness: cloud-daemon-heartbeat.harness.ts.
afterEach(cleanup);

describe("cloud daemon — the heartbeat of the polling loop", () => {
  it(
    "a refusal of the statuses does not take the heartbeat with it",
    async () => {
      // A web route older than the field answers 403 to the whole body.
      const cloud = await fakeCloud(true, (body) => (body.agents_status ? 403 : null));
      const { home, bin } = sandbox(cloud.baseUrl, 'printf "CAPITANO\\n"');
      await runDaemon(home, bin, 23_000, { JHT_API_TRACES_DIR: apiTraces(home) }, "10");

      expect(cloud.beats.length).toBeGreaterThanOrEqual(3);
      for (const beat of cloud.beats) expect(beat.body).not.toHaveProperty("agents_status");
      // One refused body, the same heartbeat again alone, then the statuses
      // wait: no second refusal a minute later.
      expect(cloud.patches.filter((p) => p.body.agents_status).length).toBe(1);
      expect(ownPatches(cloud).length).toBe(cloud.beats.length + 1);
    },
    40_000,
  );
});
