import { afterEach, describe, expect, it } from "vitest";

import {
  apiTraces,
  cleanup,
  fakeCloud,
  ownPatches,
  runDaemon,
  sandbox,
} from "./cloud-daemon-heartbeat.harness";

// The polling daemon's heartbeat: Vercel invocations.
// Story and harness: cloud-daemon-heartbeat.harness.ts.
afterEach(cleanup);

describe("cloud daemon — the heartbeat of the polling loop", () => {
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
    "carries the agents' statuses in the heartbeat's PATCH, with no PATCH of their own",
    async () => {
      // No Supabase session: the statuses went through the web route on
      // their own, every 20-60 s, 1,440-4,320 Vercel invocations a day for
      // one box. Now one PATCH a minute carries both.
      const cloud = await fakeCloud(true);
      const { home, bin } = sandbox(cloud.baseUrl, 'printf "CAPITANO\\n"');
      const traces = apiTraces(home);
      await runDaemon(home, bin, 23_000, { JHT_API_TRACES_DIR: traces }, "10");

      expect(cloud.beats.length).toBeGreaterThanOrEqual(3);
      // Every request is a heartbeat: the statuses never travel alone. (The
      // periodic push reports its outcome in a PATCH of its own, every 15
      // minutes: not counted here.)
      expect(ownPatches(cloud).length).toBe(cloud.beats.length);
      const carried = cloud.beats.filter((b) => b.body.agents_status);
      expect(carried.length).toBeGreaterThanOrEqual(1);
      expect(carried[0]!.body.agents_status).toEqual({
        api: { agents: { "scout-1": { status: "idle", since: expect.any(String) } } },
      });
    },
    40_000,
  );
});
