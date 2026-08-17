import { describe, expect, it, vi } from "vitest";

import {
  coalesceAsyncCalls,
  readHostType,
} from "../../../cli/src/commands/pid1.js";

describe("pid1 config watcher", () => {
  it("O-95 — EACCES del file host non cade silenziosamente nel default local", async () => {
    const denied = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const log = vi.fn();

    await expect(
      readHostType({
        env: {},
        hostEnvPath: "/synthetic/host.env",
        accessFile: vi.fn().mockRejectedValue(denied),
        readHostFile: vi.fn(),
        log,
      }),
    ).rejects.toBe(denied);

    // Il rifiuto ferma il dispatch e il messaggio entra nel log di pid1: non
    // può più sembrare un boot locale riuscito quando il file è illeggibile.
    expect(log).toHaveBeenCalledWith(expect.stringContaining("EACCES"));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("/synthetic/host.env"),
    );
  });

  it("il file host assente resta il fallback locale previsto", async () => {
    const missing = Object.assign(new Error("not found"), { code: "ENOENT" });
    const log = vi.fn();

    await expect(
      readHostType({
        env: {},
        accessFile: vi.fn().mockRejectedValue(missing),
        log,
      }),
    ).resolves.toBe("local");
    expect(log).not.toHaveBeenCalled();
  });

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
