"use strict";
/**
 * Web search for the agents on the pi harness: the hosted search tool of the provider, added to the request.
 *
 * Codex gets it with `--search` (scout, analista, mentor: .launcher/spawn-lib.sh, JHT_CODEX_WEB_SEARCH_ROLES). pi does
 * not expose the provider's hosted search, but lets an extension rewrite the request, so this adds the provider's own
 * hosted tool to the `tools` of the request. The search runs on the provider's side; nothing here talks to the network,
 * reads a file of the agent or runs a command. No dependency: Node's own modules only. Loaded for those roles with
 * `-e <this file>`.
 *
 * The providers (the table PROVIDERS below):
 *   - openai on the Responses API: `{"type": "web_search"}`, each finished `web_search_call` of the stream counted;
 *   - anthropic on the Messages API: the server tool `web_search_20250305` (every current Claude model, Haiku included),
 *     with `max_uses` per turn (ROLE_MAX_USES by the agent's role, JHT_PI_WEB_SEARCH_MAX_USES over it); the searches
 *     are the `usage.server_tool_use.web_search_requests` of the message (a failed search is not billed nor counted),
 *     or, when the usage does not say it, the `server_tool_use` blocks named web_search;
 *   - zai (GLM) on the chat completions: `{"type": "web_search", "web_search": {...}}`, one search per response that
 *     carries a `web_search` list. Not verified on the coding endpoint pi uses for GLM: on only with
 *     JHT_PI_WEB_SEARCH_ZAI=1, said as unavailable (with the reason) otherwise;
 *   - moonshotai (Kimi) and any other provider or API: no hosted search tool here.
 * Wherever the search is not added the request is left exactly as pi built it (it must not break) and the missing
 * search is SAID, once per session: a `jht-web-search-status` entry in the session (what pi_sessions.py reads) and a
 * line in `$JHT_HOME/logs/pi-web-search.log`.
 *
 * pi 1.5.0 drops the provider's own search blocks from what it keeps of a reply (`server_tool_use`,
 * `web_search_tool_result`, Z.ai's `web_search`): the agent reads the model's text written after the search, and the
 * next request does not carry the raw results again. A turn the server pauses (`pause_turn`) ends as a stop: max_uses
 * keeps the server loop short.
 *
 * Counting: pi prices the tokens of a call but not the fee of a search call. The searches of a turn are written at its
 * end as a `jht-web-search` entry (`{searches: n, provider}`); pi_sessions.py adds the provider's fee, so the meter and
 * the spending brake see it.
 */
const fs = require("node:fs");
const path = require("node:path");

const STATUS = "jht-web-search-status";
const COUNT = "jht-web-search";
// The cap of searches in one turn, by role (the agent's name without its number: analista-2 -> analista): a Scout and an
// Analista look for one thing at a time (a company's site, an office), the Mentor reads around a question. Where the
// provider takes a per-turn cap (Anthropic's max_uses); the fee of every search goes to the spending brake anyway.
const ROLE_MAX_USES = { scout: 3, analista: 3, mentor: 5 };
const DEFAULT_MAX_USES = 3;

function maxUses() {
  const n = Number.parseInt(process.env.JHT_PI_WEB_SEARCH_MAX_USES || "", 10);
  if (Number.isInteger(n) && n >= 1 && n <= 20) return n;
  const role = String(process.env.JHT_AGENT_NAME || "").trim().toLowerCase().replace(/-s?\d+$/, "");
  return ROLE_MAX_USES[role] || DEFAULT_MAX_USES;
}

/** Each provider whose hosted search we add: the API it must come on, the tool, and how a request already has it. */
const PROVIDERS = {
  openai: {
    api: "openai-responses",
    tool: () => ({ type: "web_search" }),
    present: (tool) => tool && tool.type === "web_search",
  },
  anthropic: {
    api: "anthropic-messages",
    tool: () => ({ type: "web_search_20250305", name: "web_search", max_uses: maxUses() }),
    present: (tool) => tool && tool.name === "web_search",
  },
  zai: {
    api: "openai-completions",
    gate: "JHT_PI_WEB_SEARCH_ZAI",
    gateReason:
      "the web search of Z.ai is not verified yet on the coding endpoint pi uses for GLM: JHT_PI_WEB_SEARCH_ZAI=1 turns it on",
    tool: () => ({
      type: "web_search",
      web_search: { enable: true, search_engine: "search-prime", search_result: true, count: 5 },
    }),
    present: (tool) => tool && tool.type === "web_search",
  },
};

/** Why a provider gets no search, for the status entry and the log line. */
function missingReason(provider, api) {
  const known = PROVIDERS[provider];
  if (known && known.api !== api) return `the hosted search of ${provider} is added only on its ${known.api} API, not on ${api || "an unknown API"}`;
  if (provider === "moonshotai")
    return "Kimi has no hosted search tool to add to the request: its $web_search was retired and its search is a separate endpoint";
  return `no hosted web search tool is known for provider ${provider || "unknown"}`;
}

function logLine(entry) {
  try {
    const home = process.env.JHT_HOME;
    const dir = home
      ? path.join(home, "logs")
      : process.env.PI_CODING_AGENT_DIR;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "pi-web-search.log"),
      JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n",
    );
  } catch (_error) {
    /* a log that cannot be written is not a reason to touch the request */
  }
}

function describe(model) {
  const m = model && typeof model === "object" ? model : {};
  return { provider: String(m.provider || ""), api: String(m.api || "") };
}

module.exports = function webSearch(pi) {
  let searches = 0;
  let announced = false;
  let current = "";
  // the request in flight: Anthropic's blocks and usage of the message, Z.ai's search seen in the response
  let request = { blocks: 0, usage: null, seen: false };

  function announce(enabled, model, reason) {
    if (announced) return;
    announced = true;
    const status = {
      enabled,
      ...describe(model),
      ...(reason ? { reason } : {}),
    };
    try {
      pi.appendEntry(STATUS, status);
    } catch (_error) {
      /* the log below still says it */
    }
    logLine({
      event: enabled ? "web_search_on" : "web_search_unavailable",
      ...status,
    });
  }

  function closeRequest() {
    if (current === "anthropic") searches += request.usage !== null ? request.usage : request.blocks;
    request = { blocks: 0, usage: null, seen: false };
  }

  pi.on("before_provider_request", (event, ctx) => {
    try {
      const model = ctx && ctx.model;
      const { provider, api } = describe(model);
      const payload = event && event.payload;
      const known = PROVIDERS[provider];
      closeRequest(); // a request that ended without its stop still counts what it searched
      current = "";
      if (!known || known.api !== api || !payload || typeof payload !== "object") {
        announce(false, model, missingReason(provider, api));
        return undefined;
      }
      if (known.gate && process.env[known.gate] !== "1") {
        announce(false, model, known.gateReason);
        return undefined;
      }
      announce(true, model);
      current = provider;
      const tools = Array.isArray(payload.tools) ? payload.tools : [];
      if (tools.some(known.present)) return undefined;
      return { ...payload, tools: [...tools, known.tool()] };
    } catch (_error) {
      return undefined; // never break the request of the agent
    }
  });

  pi.on("provider_stream_event", (event) => {
    try {
      const data = event && event.data;
      if (!data || typeof data !== "object") return;
      if (current === "openai") {
        if (data.type === "response.output_item.done" && data.item && data.item.type === "web_search_call") searches += 1;
      } else if (current === "anthropic") {
        const block = data.content_block;
        if (data.type === "content_block_start" && block && block.type === "server_tool_use" && block.name === "web_search")
          request.blocks += 1;
        const used = data.usage && data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests;
        if (data.type === "message_delta" && Number.isInteger(used)) request.usage = used;
        if (data.type === "message_stop") closeRequest();
      } else if (current === "zai") {
        if (!request.seen && Array.isArray(data.web_search) && data.web_search.length > 0) {
          request.seen = true;
          searches += 1;
        }
      }
    } catch (_error) {
      /* counting must never break the stream */
    }
  });

  pi.on("turn_end", () => {
    closeRequest();
    if (searches === 0) return;
    const n = searches;
    searches = 0;
    try {
      pi.appendEntry(COUNT, { searches: n, provider: current });
    } catch (_error) {
      logLine({ event: "web_search_count_lost", searches: n, provider: current });
    }
  });
};
