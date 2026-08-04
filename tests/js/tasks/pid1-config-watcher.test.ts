import { describe, expect, it } from "vitest";

import { coalesceAsyncCalls } from "../../../cli/src/commands/pid1.js";

describe("pid1 config watcher", () => {
  it("serializza gli eventi fs.watch sovrapposti e conserva l'ultimo", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let active = 0;
    let maxActive = 0;
    const seen: number[] = [];

    const reconcile = coalesceAsyncCalls(async (value: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(value);
      if (seen.length === 1) await firstGate;
      active -= 1;
    });

    const first = reconcile(1);
    await Promise.resolve();
    const second = reconcile(2);
    const third = reconcile(3);
    releaseFirst();
    await Promise.all([first, second, third]);

    expect(maxActive).toBe(1);
    expect(seen).toEqual([1, 3]);
  });

  it("esegue normalmente le chiamate non sovrapposte", async () => {
    const seen: string[] = [];
    const reconcile = coalesceAsyncCalls(async (value: string) => {
      seen.push(value);
    });

    await reconcile("first");
    await reconcile("second");

    expect(seen).toEqual(["first", "second"]);
  });
});
