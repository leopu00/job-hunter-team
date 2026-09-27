/**
 * The runtime's cost must be what OpenAI bills (JHT-API-TEST A1, A4, A5).
 *
 * Until 2026-09-27 the tokens were right and the price was not: cached input
 * at the full input price, luna's long-context rates on every request, cache
 * writes added on top, and every web_search_call item billed as a search.
 * The key proxy counted the same way, so the two agreed and were both wrong:
 * a test that checks our count against our count proves nothing. These tests
 * check it against OpenAI's published price list, typed here by hand from
 * each model's page (developers.openai.com/api/docs/models/<model>, read
 * 2026-09-27) and NOT imported from the catalog. Synthetic token counts only.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS, Guardrails } from "../src/core/guardrails.ts";
import { billedSearches } from "../src/core/provider/ai-sdk.ts";
import { modelProfile } from "../src/core/provider/catalog.ts";
import { costUsd, worstCase, type Usage } from "../src/core/usage.ts";

/** USD per million tokens, standard tier, as each model's page states it. */
const OFFICIAL = {
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2, cacheWrite: 0.25, long: true },
  "gpt-5-mini": { input: 0.25, cached: 0.025, output: 2, cacheWrite: 0.25, long: false },
  "gpt-5": { input: 1.25, cached: 0.125, output: 10, cacheWrite: 1.25, long: false },
  "gpt-5.6-terra": { input: 2, cached: 0.2, output: 12, cacheWrite: 2.5, long: true },
  "gpt-5.6-sol": { input: 4, cached: 0.4, output: 20, cacheWrite: 5, long: true },
} as const;
type Model = keyof typeof OFFICIAL;

/** «Prompts with >272K input tokens are priced at 2x input and 1.5x output for the full request.» */
const LONG_ABOVE = 272_000;

/** The invoice for one request, from the page's rules alone. */
function invoice(model: Model, u: Required<Pick<Usage, "inputTokens" | "outputTokens">> & Usage): number {
  const p = OFFICIAL[model];
  const long = p.long && u.inputTokens > LONG_ABOVE;
  const cached = u.cachedInputTokens ?? 0;
  const written = u.cacheWriteTokens ?? 0;
  const fresh = u.inputTokens - cached - written;
  const inputUsd = (fresh * p.input + cached * p.cached + written * p.cacheWrite) * (long ? 2 : 1);
  return (inputUsd + u.outputTokens * p.output * (long ? 1.5 : 1)) / 1_000_000;
}

const pricing = (model: Model) => modelProfile({ providerId: "openai", modelId: model }).pricing!;

// A hundredth of a cent: A1's threshold.
const CENT_OF_A_CENT = 0.0001;

describe("A1 — one response, against the published price list", () => {
  it.each(Object.keys(OFFICIAL) as Model[])("%s: fresh, cached, written and output tokens at their own prices", (model) => {
    const u = { inputTokens: 20_000, cachedInputTokens: 17_000, cacheWriteTokens: 2_000, outputTokens: 300 };
    expect(Math.abs(costUsd(u, pricing(model)) - invoice(model, u))).toBeLessThan(CENT_OF_A_CENT / 1000);
  });

  it("a luna response with most of its input cached costs what the page says, to the hundredth of a cent", () => {
    // 1,000 fresh × 0.20 + 17,000 cached × 0.02 + 2,000 written × 0.25 + 300 out × 1.20, per million.
    const u = { inputTokens: 20_000, cachedInputTokens: 17_000, cacheWriteTokens: 2_000, outputTokens: 300 };
    expect(costUsd(u, pricing("gpt-5.6-luna"))).toBeCloseTo(0.0014, 12);
    // Cached input at the full input price was the old count: four times the tokens' real price here.
    expect(costUsd(u, pricing("gpt-5.6-luna"))).toBeLessThan((20_000 * 0.2 + 300 * 1.2) / 1_000_000);
  });

  it("uses luna's long-context rates only above 272K input tokens in the request", () => {
    const at = { inputTokens: 272_000, outputTokens: 1_000 };
    const above = { inputTokens: 272_001, outputTokens: 1_000 };
    expect(costUsd(at, pricing("gpt-5.6-luna"))).toBeCloseTo(invoice("gpt-5.6-luna", at), 12);
    expect(costUsd(above, pricing("gpt-5.6-luna"))).toBeCloseTo(invoice("gpt-5.6-luna", above), 12);
    expect(costUsd(above, pricing("gpt-5.6-luna"))).toBeGreaterThan(1.9 * costUsd(at, pricing("gpt-5.6-luna")));
    // mini has no long-context price: a long request costs its short rates.
    expect(costUsd(above, pricing("gpt-5-mini"))).toBeCloseTo(invoice("gpt-5-mini", above), 12);
  });

  it("prices a run request by request: two requests of 200K are not one of 400K", () => {
    const request = { inputTokens: 200_000, cachedInputTokens: 150_000, outputTokens: 2_000 };
    const g = new Guardrails({ limits: { ...DEFAULT_LIMITS, budgetUsd: 10, maxTotalTokens: 10_000_000 }, pricing: pricing("gpt-5.6-luna") });
    g.recordUsage(request);
    g.recordUsage(request);
    expect(g.state.costUsd).toBeCloseTo(2 * invoice("gpt-5.6-luna", request), 12);
    expect(g.state.usage.inputTokens).toBe(400_000);
  });

  it("never bills a token twice when a report claims more cached and written tokens than input", () => {
    const u = { inputTokens: 1_000, cachedInputTokens: 900, cacheWriteTokens: 900, outputTokens: 0 };
    // 900 cached × 0.02 + the 100 left, written, × 0.25.
    expect(costUsd(u, pricing("gpt-5.6-luna"))).toBeCloseTo((900 * 0.02 + 100 * 0.25) / 1_000_000, 12);
  });

  it("books the worst case at the dearest input price: all of it written to the cache", () => {
    const worst = costUsd({ ...worstCase(10_000), outputTokens: 0 }, pricing("gpt-5.6-luna"));
    expect(worst).toBeCloseTo((10_000 * 0.25) / 1_000_000, 12);
    expect(worst).toBeGreaterThanOrEqual(invoice("gpt-5.6-luna", { inputTokens: 10_000, outputTokens: 0 }));
  });
});

/** Content parts as `generateText` returns an OpenAI web search: one tool call and one result per item, the action on `output`. */
function openAiSearchItems(actions: string[]) {
  return actions.flatMap((action, i) => [
    { type: "tool-call", providerExecuted: true },
    {
      type: "tool-result",
      output: { action: { type: action === "open_page" ? "openPage" : action === "find_in_page" ? "findInPage" : action } },
      id: i,
    },
  ]);
}

describe("A4 — web searches, from the items OpenAI returned", () => {
  it("bills one search for a response with two search items under max_tool_calls 1", () => {
    // What OpenAI returned for most requests of the A2 week, and billed as one.
    expect(billedSearches("openai", openAiSearchItems(["search", "search"]))).toBe(1);
  });

  it("does not bill opening a page or finding in it", () => {
    expect(billedSearches("openai", openAiSearchItems(["search", "open_page"]))).toBe(1);
    expect(billedSearches("openai", openAiSearchItems(["open_page", "find_in_page"]))).toBe(0);
  });

  it("bills nothing when the response searched nothing", () => {
    expect(billedSearches("openai", [{ type: "text" }])).toBe(0);
    // An item whose action is missing is not a search the page says is billed.
    expect(billedSearches("openai", [{ type: "tool-call", providerExecuted: true }, { type: "tool-result", output: {} }])).toBe(0);
  });

  it("counts Anthropic's server tool calls, one per search it ran", () => {
    const calls = [{ type: "tool-call", providerExecuted: true }, { type: "tool-call", providerExecuted: true }, { type: "tool-call" }];
    expect(billedSearches("anthropic", calls)).toBe(2);
  });
});

describe("A5 — the budget stops a run when the REAL spend reaches it", () => {
  /**
   * A SCOUT-like run on luna: the context grows by a result per round, most
   * of it served from the cache, a little written to it, a short answer, and
   * a web search every fourth round. The rounds are booked as agent-loop
   * books them: the whole context at the cache-write price, a full answer.
   */
  function runUntilStopped(budgetUsd: number) {
    const luna = pricing("gpt-5.6-luna");
    const g = new Guardrails({
      limits: { ...DEFAULT_LIMITS, budgetUsd, maxSteps: 10_000, maxTotalTokens: 1e12 },
      pricing: luna,
    });
    let realUsd = 0;
    for (let round = 0; round < 10_000; round++) {
      const inputTokens = 12_000 + 1_500 * (round % 25);
      const usage = {
        inputTokens,
        cachedInputTokens: Math.floor(inputTokens * 0.88),
        cacheWriteTokens: Math.floor(inputTokens * 0.08),
        outputTokens: 320,
      };
      try {
        g.beginStep();
        g.reserve({ ...worstCase(Math.ceil(inputTokens * 1.1)), outputTokens: 4_096 });
        realUsd += invoice("gpt-5.6-luna", usage);
        g.recordUsage(usage);
        // The search tool's own check (web-search.ts): four searches booked, as the proxy books them.
        if (round % 4 === 3 && g.fits({ ...worstCase(4 * 25_000), outputTokens: 4_096 }, 4 * luna.webSearchPerCallUsd!)) {
          const search = { inputTokens: 9_000, cacheWriteTokens: 4_000, outputTokens: 200 };
          realUsd += invoice("gpt-5.6-luna", search) + 0.01;
          g.recordUsage(search);
          g.recordCharge(luna.webSearchPerCallUsd!);
        }
      } catch (error) {
        return { code: (error as { code?: string }).code, realUsd, rounds: round };
      }
    }
    throw new Error("the run never stopped");
  }

  it.each([0.5, 0.25, 1])("with a %s USD cap, budget_exhausted comes only past 80 %% of it in real spend", (cap) => {
    const stopped = runUntilStopped(cap);
    expect(stopped.code).toBe("budget_exhausted");
    expect(stopped.realUsd / cap).toBeGreaterThanOrEqual(0.8);
    expect(stopped.realUsd).toBeLessThanOrEqual(cap);
  });
});
