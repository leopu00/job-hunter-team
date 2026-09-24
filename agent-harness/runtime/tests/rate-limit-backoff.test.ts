/**
 * T27-b: the wait for an upstream 429 is reported, and never counted as work.
 *
 * The VPS's third budget rehearsal (23/09) ended on this wall for the third
 * time, and not on money: 13 of 59 requests came back 429 and five agents of
 * six died `provider_failed`, the CAPITANO among them, while the team had spent
 * less than a third of its cap
 * (`agents-hq/piani/collaudo-budget-squadra-vps-res.txt`). The backoff itself
 * is measured in `ai-sdk-adapter.test.ts`, where the AI SDK may be imported;
 * what is held here is the other half of the MASTER's order — **the time spent
 * waiting must not pass for work in the trace** — because a round whose
 * duration swallowed a 6-second wait reads as a slow model, and a slow model is
 * diagnosed in the wrong place. Twice now.
 */

import { describe, expect, it } from "vitest";

import { runRound, TurnAccount, type AgentEvent } from "../src/core/agent-loop.ts";
import { MemoryAuditLog } from "../src/core/audit.ts";
import { DEFAULT_LIMITS, Guardrails } from "../src/core/guardrails.ts";
import { modelProfile } from "../src/core/provider/catalog.ts";
import type { GenerateResult, ProviderPort } from "../src/core/provider/port.ts";

const PROFILE = modelProfile({ providerId: "openai", modelId: "gpt-5.6-luna" });
const USAGE = { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 };

/**
 * A provider whose call takes `spentMs` of wall time, of which `waitedMs` were
 * spent waiting for a 429 to clear. The clock is the round's own, handed in, so
 * the test measures the subtraction and not the machine's speed.
 */
function provider(clock: { ms: number }, spentMs: number, backoff?: { attempts: number; waitedMs: number }): ProviderPort {
  return {
    profile: PROFILE,
    async generate(): Promise<GenerateResult> {
      clock.ms += spentMs;
      return { text: "done", toolCalls: [], finishReason: "stop", usage: USAGE, ...(backoff ? { backoff } : {}) };
    },
  };
}

async function round(spentMs: number, backoff?: { attempts: number; waitedMs: number }) {
  const clock = { ms: 1_000 };
  const now = () => clock.ms;
  const events: AgentEvent[] = [];
  const audit = new MemoryAuditLog();
  const guardrails = new Guardrails({ limits: DEFAULT_LIMITS, pricing: PROFILE.pricing!, now });
  await runRound(
    { provider: provider(clock, spentMs, backoff), guardrails, audit, emit: (e: AgentEvent) => void events.push(e), now },
    { system: "s", messages: [{ role: "user", content: "x" }], tools: [], account: new TurnAccount(now) },
  );
  const finished = events.find((e) => e.type === "round_finished") as Extract<AgentEvent, { type: "round_finished" }>;
  const step = audit.events.find((e) => e.type === "step_finished") as Extract<(typeof audit.events)[number], { type: "step_finished" }>;
  return { finished, step };
}

describe("a round that waited on a 429", () => {
  it("counts the work and not the waiting: 8s of call, 6s of it asleep, is a 2s round", async () => {
    const { finished, step } = await round(8_000, { attempts: 3, waitedMs: 6_000 });
    expect(finished.durationMs).toBe(2_000);
    expect(step.durationMs).toBe(2_000);
  });

  it("says how long it waited and how many attempts it took, beside the duration", async () => {
    const { finished, step } = await round(8_000, { attempts: 3, waitedMs: 6_000 });
    expect(finished.backoff).toEqual({ attempts: 3, waitedMs: 6_000 });
    // The audit trail is sanitised — numbers, never words — so it carries the milliseconds.
    expect(step.backoffMs).toBe(6_000);
  });

  it("leaves a round that was never refused exactly as it was", async () => {
    const { finished, step } = await round(2_000);
    expect(finished.durationMs).toBe(2_000);
    expect(finished.backoff).toBeUndefined();
    expect(step.backoffMs).toBeUndefined();
  });
});
