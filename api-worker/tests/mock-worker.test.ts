import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuditEventSchema,
  ScoutApiWorker,
  readAuditJsonl,
} from "../src/index.js";
import { fixtureInput, fixtureProfile, fixtureSource } from "./helpers.js";

describe("offline mock Scout provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("proposes deterministic synthetic candidates without persistence", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const runtimeDir = await mkdtemp(join(tmpdir(), "jht-scout-mock-"));
    const worker = new ScoutApiWorker(await fixtureProfile(), {
      runtimeDir,
      source: await fixtureSource(),
    });

    const outcome = await worker.run(await fixtureInput());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.provider).toBe("mock");
    expect(outcome.result.proposals).toHaveLength(2);
    expect(
      outcome.result.proposals.every((item) => item.persistence === "none"),
    ).toBe(true);
    expect(outcome.result.persistence).toBe("none");
    expect(outcome.result.metrics.steps).toBe(3);
    expect(outcome.result.metrics.toolCalls).toBeGreaterThan(2);
    expect(outcome.result.cost.amountUsd).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    const events = await readAuditJsonl(join(runtimeDir, "scout-runs.jsonl"));
    expect(
      events.every((event) => AuditEventSchema.safeParse(event).success),
    ).toBe(true);
    expect(events.some((event) => event.event === "tool")).toBe(true);
    expect(events.at(-1)?.event).toBe("run_completed");
  });
});
