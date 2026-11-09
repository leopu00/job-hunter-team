"use strict";
/**
 * Web search for the agents on the pi harness: the `web_search` tool of OpenAI's Responses API.
 *
 * Codex gets it with `--search` (scout, analista, mentor: .launcher/spawn-lib.sh, JHT_CODEX_WEB_SEARCH_ROLES). pi does
 * not expose the provider's hosted search, but lets an extension rewrite the request, so this adds the same hosted
 * tool to the `tools` of the request. The search runs on OpenAI's side; nothing here talks to the network, reads a
 * file of the agent or runs a command. No dependency: Node's own modules only. Loaded for those roles with
 * `-e <this file>`.
 *
 * Only the Responses API of OpenAI itself has that tool. With any other provider or API the request is left exactly as
 * pi built it (it must not break) and the missing search is SAID, once per session: a `jht-web-search-status` entry in
 * the session (what pi_sessions.py reads) and a line in `$JHT_HOME/logs/pi-web-search.log`.
 *
 * Counting: pi prices the tokens of a call but not the fee of a search call (10 USD per 1000 on OpenAI's pricing page,
 * read 09/11). Every finished `web_search_call` of the stream is counted and written at the end of the turn as a
 * `jht-web-search` entry (`{searches: n}`); pi_sessions.py adds the fee, so the meter and the spending brake see it.
 */
const fs = require("node:fs");
const path = require("node:path");

const SEARCH_TOOL = { type: "web_search" };
const SUPPORTED = { provider: "openai", api: "openai-responses" };
const STATUS = "jht-web-search-status";
const COUNT = "jht-web-search";

function logLine(entry) {
  try {
    const home = process.env.JHT_HOME;
    const dir = home ? path.join(home, "logs") : process.env.PI_CODING_AGENT_DIR;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "pi-web-search.log"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
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

  function announce(enabled, model, reason) {
    if (announced) return;
    announced = true;
    const status = { enabled, ...describe(model), ...(reason ? { reason } : {}) };
    try {
      pi.appendEntry(STATUS, status);
    } catch (_error) {
      /* the log below still says it */
    }
    logLine({ event: enabled ? "web_search_on" : "web_search_unavailable", ...status });
  }

  pi.on("before_provider_request", (event, ctx) => {
    try {
      const model = ctx && ctx.model;
      const { provider, api } = describe(model);
      const payload = event && event.payload;
      if (provider !== SUPPORTED.provider || api !== SUPPORTED.api || !payload || typeof payload !== "object") {
        announce(false, model, "the hosted web_search tool exists only on the Responses API of OpenAI");
        return undefined;
      }
      announce(true, model);
      const tools = Array.isArray(payload.tools) ? payload.tools : [];
      if (tools.some((tool) => tool && tool.type === SEARCH_TOOL.type)) return undefined;
      return { ...payload, tools: [...tools, { ...SEARCH_TOOL }] };
    } catch (_error) {
      return undefined; // never break the request of the agent
    }
  });

  pi.on("provider_stream_event", (event) => {
    const data = event && event.data;
    if (data && data.type === "response.output_item.done" && data.item && data.item.type === "web_search_call") {
      searches += 1;
    }
  });

  pi.on("turn_end", () => {
    if (searches === 0) return;
    const n = searches;
    searches = 0;
    try {
      pi.appendEntry(COUNT, { searches: n });
    } catch (_error) {
      logLine({ event: "web_search_count_lost", searches: n });
    }
  });
};
