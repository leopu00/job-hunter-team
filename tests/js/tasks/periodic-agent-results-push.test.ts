import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createExclusiveRunner } from "../../../cli/src/lib/exclusive-runner.js";

const ROOT = resolve(__dirname, "../../..");
const CLOUD = readFileSync(resolve(ROOT, "cli/src/commands/cloud.js"), "utf-8");
const PID1 = readFileSync(resolve(ROOT, "cli/src/commands/pid1.js"), "utf-8");

describe("JHT-ONBOARDING-04 — ownership del push periodico", () => {
  it("serializza bootstrap e Sync now sullo stesso writer", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const calls: string[] = [];
    const run = createExclusiveRunner(async (name: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(`start:${name}`);
      await new Promise<void>((resolve) => releases.push(resolve));
      calls.push(`end:${name}`);
      active -= 1;
      return name;
    });

    const bootstrap = run("bootstrap");
    const syncNow = run("sync-now");
    await Promise.resolve();
    expect(calls).toEqual(["start:bootstrap"]);

    releases.shift()?.();
    await bootstrap;
    await Promise.resolve();
    expect(calls).toEqual([
      "start:bootstrap",
      "end:bootstrap",
      "start:sync-now",
    ]);

    releases.shift()?.();
    await expect(syncNow).resolves.toBe("sync-now");
    expect(maxActive).toBe(1);
  });

  it("un errore libera la corsia per il tentativo successivo", async () => {
    let attempt = 0;
    const run = createExclusiveRunner(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("cloud down");
      return "ok";
    });

    await expect(run()).rejects.toThrow("cloud down");
    await expect(run()).resolves.toBe("ok");
  });

  it("riusa handlePush e il daemon autorevole, senza db_to_supabase o cron", () => {
    expect(CLOUD).toContain(
      "const handlePush = createExclusiveRunner(performPush)",
    );
    expect(CLOUD).toContain("const pushFn = options.pushFn || handlePush");
    expect(
      CLOUD.match(/await maybePeriodicPush\(\{ silent: false, config \}\);/g),
    ).toHaveLength(2);
    expect(CLOUD).not.toContain("db_to_supabase");
    expect(PID1).not.toContain("db_to_supabase");
    expect(PID1).toContain("if (isVps && await isCloudConfigured())");
    expect(PID1).toContain("startDaemon();");
  });
});
