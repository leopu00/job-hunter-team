/**
 * web_search: the provider searches, the model reads a digest.
 *
 * Neither the runtime nor a plain HTTP client has a search index; OpenAI and
 * Anthropic run search on their side. The tool asks the provider in a separate
 * call, so the main conversation receives a short digest with its sources
 * instead of raw result pages. That call's tokens and the per-search fee are
 * charged to the run like any other spend.
 *
 * T19: a run searches at most `JHT_API_MAX_WEB_SEARCHES` times (T13: 34
 * searches, 82 % of a SCOUT's budget, no position saved). Past the cap, or
 * when the search's worst case no longer fits the budget, the tool answers
 * without calling the provider and tells the agent to work with what it has.
 */

import { z } from "zod";

import { HarnessError } from "../core/errors.ts";
import { SEARCH_RESERVED_INPUT_TOKENS, SEARCHES_BOOKED_PER_CALL, type ProviderPort } from "../core/provider/port.ts";
import { worstCase } from "../core/usage.ts";
import type { ToolHandler } from "./registry.ts";

const SEARCH_TIMEOUT_MS = 90_000;

/** The search call's own instructions, as ai-sdk.ts sends them: under 400 characters. */
const SEARCH_SYSTEM_CHARS = 400;

const CLOSE_WITH_WHAT_YOU_HAVE = "Use the results you already have, save what you found and close the cycle.";

export const SEARCHES_EXHAUSTED = `Search budget exhausted: this run has used all its web searches. Nothing was searched. ${CLOSE_WITH_WHAT_YOU_HAVE}`;

export const BUDGET_TOO_LOW = `Budget too low for another web search: its worst case does not fit in what this run has left. Nothing was searched. ${CLOSE_WITH_WHAT_YOU_HAVE}`;

export function createWebSearchTool(provider: ProviderPort, perSearchUsd: number): ToolHandler {
  if (!provider.webSearch || !provider.profile.capabilities.webSearch) {
    throw new HarnessError("model_incapable", `${provider.profile.modelId} cannot search the web.`);
  }
  const search = provider.webSearch.bind(provider);

  return {
    spec: {
      name: "web_search",
      description:
        "Search the web. Returns a digest of what the results say, with the source URLs. " +
        "Write the query as you would type it into a search engine. Use web_fetch to read a source in full.",
      schema: z.object({ query: z.string().min(2).max(400) }).strict(),
    },

    classify(args) {
      return { risk: "network", paths: [], summary: (args as { query: string }).query };
    },

    async execute(args, context) {
      const { query } = args as { query: string };
      const budget = context.budget;
      if (budget && budget.webSearchesLeft() <= 0) {
        return { ok: false, content: SEARCHES_EXHAUSTED, details: { webSearchesLeft: 0 } };
      }
      // Reserved before the call: the query and the results of every search
      // the call may run read as input, a full answer, and their fees.
      const worst = {
        ...worstCase(SEARCHES_BOOKED_PER_CALL * SEARCH_RESERVED_INPUT_TOKENS + Math.ceil((SEARCH_SYSTEM_CHARS + query.length) / 3)),
        outputTokens: provider.profile.defaultMaxOutputTokens,
      };
      if (budget && !budget.fits(worst, SEARCHES_BOOKED_PER_CALL * perSearchUsd)) {
        return { ok: false, content: BUDGET_TOO_LOW, details: { webSearchesLeft: budget.webSearchesLeft() } };
      }
      const result = await search({ query, timeoutMs: Math.min(SEARCH_TIMEOUT_MS, context.remainingMs()) });
      const sources =
        result.sources.length > 0
          ? `\n\nSources:\n${result.sources.map((s) => `- ${s.title ? `${s.title} — ` : ""}${s.url}`).join("\n")}`
          : "";
      return {
        ok: true,
        content: `${result.text.trim() || "The search returned nothing usable."}${sources}`,
        usage: result.usage,
        chargeUsd: result.searches * perSearchUsd,
        webSearches: result.searches,
        details: { webSearches: result.searches },
      };
    },
  };
}
