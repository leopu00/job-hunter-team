import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalystApiWorker } from "../src/analyst-worker.js";
import { MemoryAuditSink } from "../src/audit.js";
import { ScorerApiWorker } from "../src/scorer-worker.js";
import { ScoutApiWorker } from "../src/worker.js";
import { fixtureProfile, fixtureSource, loadFixture } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe.each(["analyst", "scout", "scorer"] as const)(
  "%s budget entry guard",
  (role) => {
    it.each(["zero budget", "missing pricing", "zero pricing"] as const)(
      "rejects %s before starting a run or requesting the provider",
      async (missing) => {
        const runtimeDir = await mkdtemp(
          join(tmpdir(), "synthetic-worker-budget-"),
        );
        try {
          const audit = new MemoryAuditSink();
          const fetch = vi.spyOn(globalThis, "fetch");
          const profile = {
            ...(await fixtureProfile()),
            provider: "openai",
            pricing:
              missing === "missing pricing"
                ? undefined
                : {
                    inputUsdPerMillionTokens:
                      missing === "zero pricing" ? 0 : 1,
                    outputUsdPerMillionTokens:
                      missing === "zero pricing" ? 0 : 2,
                  },
          };
          const input = (await loadFixture(`${role}-input.synthetic.json`)) as {
            limits: { maxCostUsd: number };
          };
          input.limits.maxCostUsd = missing === "zero budget" ? 0 : 0.05;
          const options = { runtimeDir, audit, liveEnabled: true, env: {} };
          const worker =
            role === "analyst"
              ? new AnalystApiWorker(profile, options)
              : role === "scorer"
                ? new ScorerApiWorker(profile, options)
                : new ScoutApiWorker(profile, {
                    ...options,
                    source: await fixtureSource(),
                  });
          const outcome = await worker.run(input);
          expect(outcome).toMatchObject({
            ok: false,
            error: {
              role,
              code: "LIVE_BUDGET_REQUIRED",
              limit: "cost_usd",
              retryable: false,
              message:
                role === "scout"
                  ? "Live provider access requires explicit pricing and a positive run budget."
                  : "Live provider access requires explicit pricing and a positive budget.",
            },
          });
          expect(audit.events.map((event) => event.event)).toEqual([
            "run_failed",
          ]);
          expect(fetch).not.toHaveBeenCalled();
          expect(await readdir(runtimeDir)).toEqual([]);
        } finally {
          await rm(runtimeDir, { recursive: true, force: true });
        }
      },
    );
  },
);
