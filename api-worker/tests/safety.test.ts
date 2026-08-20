import { readFile, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  JobCatalogSchema,
  ScoutApiWorker,
  WorkerFault,
  type ProviderExecutionContext,
  type ScoutProviderAdapter,
} from "../src/index.js";
import {
  cloneInput,
  fixtureInput,
  fixtureProfile,
  fixtureSource,
  loadFixture,
} from "./helpers.js";

describe("worker safety boundaries", () => {
  it("blocks a second concurrent run through the shared exclusive lock", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "jht-scout-lock-"));
    let release!: () => void;
    let markStarted!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const adapter: ScoutProviderAdapter = {
      async run(context: ProviderExecutionContext) {
        const reservation = context.guard.beforeProviderStep(context.prompt);
        markStarted();
        await released;
        await context.recordStep({
          reservation,
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          finishReason: "stop",
        });
        return {
          output: {
            proposals: [],
            exhausted: true,
            notes: ["No fixture work."],
          },
          rawStopReason: "stop",
        };
      },
    };
    const profile = await fixtureProfile();
    const input = await fixtureInput();
    const firstWorker = new ScoutApiWorker(profile, {
      runtimeDir,
      source: await fixtureSource(),
      adapter,
    });
    const secondWorker = new ScoutApiWorker(profile, {
      runtimeDir,
      source: await fixtureSource(),
      adapter,
    });

    const firstRun = firstWorker.run(input);
    await started;
    const second = await secondWorker.run(input);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("CONCURRENT_RUN");

    release();
    expect((await firstRun).ok).toBe(true);
  });

  it("sanitizes logs even when input and a provider error contain secrets", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "jht-scout-redact-"));
    const marker = "sk-test-DO-NOT-LOG-123456";
    const input = cloneInput(await fixtureInput(), {
      search: { targetRoles: [`Platform ${marker}`] },
    });
    const adapter: ScoutProviderAdapter = {
      async run() {
        throw new Error(`provider rejected ${marker}`);
      },
    };
    const worker = new ScoutApiWorker(await fixtureProfile(), {
      runtimeDir,
      source: await fixtureSource(),
      adapter,
    });

    const outcome = await worker.run(input);
    expect(outcome.ok).toBe(false);
    const log = await readFile(join(runtimeDir, "scout-runs.jsonl"), "utf8");
    expect(log).not.toContain(marker);
    expect(log).not.toContain("targetRoles");
    expect(log).not.toContain("provider rejected");
    expect(log).toContain("run_failed");
  });

  it("does not touch a jobs.db file placed beside its local runtime", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "jht-scout-db-"));
    const dbPath = join(runtimeDir, "jobs.db");
    const original = Buffer.from("synthetic sqlite sentinel bytes\n");
    await writeFile(dbPath, original);
    const before = await stat(dbPath);

    const worker = new ScoutApiWorker(await fixtureProfile(), {
      runtimeDir,
      source: await fixtureSource(),
    });
    expect((await worker.run(await fixtureInput())).ok).toBe(true);

    const after = await stat(dbPath);
    expect(await readFile(dbPath)).toEqual(original);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("rejects a structurally valid proposal that did not come from the tools", async () => {
    const [job] = JobCatalogSchema.parse(
      await loadFixture("jobs.synthetic.json"),
    );
    const adapter: ScoutProviderAdapter = {
      async run(context) {
        const reservation = context.guard.beforeProviderStep(context.prompt);
        await context.recordStep({
          reservation,
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          finishReason: "stop",
        });
        return {
          output: {
            proposals: [
              {
                ...job,
                matchedCriteria: [],
                disposition: "proposed",
                persistence: "none",
              },
            ],
            exhausted: false,
            notes: [],
          },
          rawStopReason: "stop",
        };
      },
    };
    const worker = new ScoutApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scout-evidence-")),
      source: await fixtureSource(),
      adapter,
    });

    const outcome = await worker.run(await fixtureInput());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("OUTPUT_VALIDATION");
  });

  it("requires the live flag before checking keys or creating an adapter", async () => {
    const input = cloneInput(await fixtureInput(), {
      limits: { maxCostUsd: 0.01 },
    });
    const profile = {
      ...(await fixtureProfile()),
      provider: "anthropic",
      model: "verified-model-placeholder",
      pricing: {
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 2,
      },
    };

    const withoutFlag = new ScoutApiWorker(profile, {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scout-live-off-")),
      source: await fixtureSource(),
      env: {},
    });
    const blocked = await withoutFlag.run(input);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("LIVE_NOT_ENABLED");

    const withoutKey = new ScoutApiWorker(profile, {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scout-no-key-")),
      source: await fixtureSource(),
      liveEnabled: true,
      env: {},
    });
    const missingKey = await withoutKey.run(input);
    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) expect(missingKey.error.code).toBe("API_KEY_MISSING");
  });

  it("aborts a provider that respects the run timeout signal", async () => {
    const adapter: ScoutProviderAdapter = {
      async run(context) {
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () =>
              reject(
                new WorkerFault("TIMEOUT", {
                  retryable: true,
                  limit: "timeout_ms",
                }),
              ),
            { once: true },
          );
        });
        throw new WorkerFault("INTERNAL_ERROR");
      },
    };
    const input = cloneInput(await fixtureInput(), {
      limits: { timeoutMs: 100 },
    });
    const worker = new ScoutApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scout-timeout-")),
      source: await fixtureSource(),
      adapter,
    });

    const outcome = await worker.run(input);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("TIMEOUT");
  });
});
