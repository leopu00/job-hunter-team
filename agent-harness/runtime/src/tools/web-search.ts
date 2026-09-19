/**
 * web_search: the provider searches, the model reads a digest.
 *
 * Neither the runtime nor a plain HTTP client has a search index; OpenAI and
 * Anthropic run search on their side. The tool asks the provider in a separate
 * call, so the main conversation receives a short digest with its sources
 * instead of raw result pages. That call's tokens and the per-search fee are
 * charged to the run like any other spend.
 */

import { z } from "zod";

import { HarnessError } from "../core/errors.ts";
import type { ProviderPort } from "../core/provider/port.ts";
import type { ToolHandler } from "./registry.ts";

const SEARCH_TIMEOUT_MS = 90_000;

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
      };
    },
  };
}
