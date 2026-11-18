"use strict";
/**
 * Web search for the agents on the pi harness: the hosted search tool of the provider, added to the request.
 *
 * Codex gets it with `--search` (scout, analista, mentor: .launcher/spawn-lib.sh, JHT_CODEX_WEB_SEARCH_ROLES). pi does
 * not expose the provider's hosted search, but lets an extension rewrite the request, so this adds the provider's own
 * hosted tool to the `tools` of the request. The search runs on the provider's side; nothing here talks to the network
 * or runs a command, and the only file read is the profile, for the check of the queries below. No dependency: Node's
 * own modules only. Loaded for those roles with
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
 * Off switch and withdrawal: JHT_PI_WEB_SEARCH=0 adds no search for any provider (said, with that reason). And a request
 * that carried our tool and came back refused (HTTP 400, 403, 404 or 422: the organization has the search off, the model
 * does not take it, the endpoint does not know it) withdraws the search for the rest of the session: the next requests
 * go as pi built them, the withdrawal is written (`web_search_withdrawn`, with the status) in the log and as a status
 * entry, and once the agent has settled after the failed request it is asked, once, to repeat its last step without
 * the search (`pi.sendUserMessage`), so the work goes on instead of stopping on the error. A rate limit or a server
 * error (429, 5xx) is not the tool's fault and withdraws nothing.
 *
 * The person's data in a query: the agents are told never to put the person's name, email or phone in a web search. The
 * query is read from the stream (Anthropic's `input_json_delta` of the search block, OpenAI's `action.query` of the
 * search call; Z.ai's stream does not carry it) and checked, in memory, against the name, the email and the phone of
 * the profile (`$JHT_HOME/profile/candidate_profile.yml`, read once, read only, at most PROFILE_MAX_BYTES, only those
 * three fields). Only the outcome is written: a `jht-web-search-check` entry at the end of a turn that searched
 * (`{queries, person_data, kinds}`, kinds from the closed list name / email / phone) and a `web_search_person_data`
 * line with the kinds. Never the query, the value found, a piece or a hash of either. Without the profile, or when it
 * cannot be read, the check is off and says `unavailable`; the search goes on either way (the query has already run
 * on the provider's side: this finds the breach, it cannot stop it).
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
const REFUSED = new Set([400, 403, 404, 422]);
const CHECK = "jht-web-search-check";
const PROFILE_MAX_BYTES = 256 * 1024;
// The most of a search block's input kept while it streams: a query is a line, this is many; beyond it the block's
// query is not checked (and not kept).
const QUERY_INPUT_MAX_CHARS = 4096;
const KINDS = ["name", "email", "phone"];
// Where the profile keeps the three fields (the same places shared/skills/profile_email.py and profile_facts.py read).
const NAME_PATHS = ["name", "full_name", "candidate.name", "personal.name", "contacts.name"];
const SPLIT_NAME_PARENTS = ["", "contacts.", "personal.", "candidate."];
const EMAIL_PATHS = ["contacts.email", "email", "candidate.contacts.email", "personal.email", "positioning.contacts.email"];
const PHONE_PATHS = ["contacts.phone", "phone", "candidate.contacts.phone", "personal.phone", "personal.contacts.phone"];

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

/** Lower case, no accents, single spaces: how a name and a query are compared. */
function fold(text) {
  return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * The scalar values of a YAML profile by their dotted path, for the keys of mappings only (a list item is not a
 * place where the person's own name lives). Enough for the three fields; nothing of it leaves this module.
 */
function profileScalars(text) {
  const out = {};
  const stack = []; // [indent, key]
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    while (stack.length && stack[stack.length - 1][0] >= indent) stack.pop();
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:(?:\s+(.*))?$/.exec(raw);
    if (!m) {
      stack.push([indent, "[]"]); // a list item or anything else: what nests under it is not ours
      continue;
    }
    let value = (m[2] || "").replace(/\s+#.*$/, "").trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    const pathKey = [...stack.map((e) => e[1]), m[1]].join(".");
    if (value && !/^[|>&*!]/.test(value)) out[pathKey] = value;
    stack.push([indent, m[1]]);
  }
  return out;
}

/** The person's name, email and phone as the check compares them, or null when the profile is missing or unreadable. */
function loadPerson() {
  const home = process.env.JHT_HOME;
  if (!home) return null;
  let fd = null;
  try {
    fd = fs.openSync(path.join(home, "profile", "candidate_profile.yml"), fs.constants.O_RDONLY);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > PROFILE_MAX_BYTES) return null;
    const buffer = Buffer.alloc(st.size);
    const read = fs.readSync(fd, buffer, 0, st.size, 0);
    const v = profileScalars(buffer.subarray(0, read).toString("utf8"));
    const pick = (paths) => paths.map((p) => v[p]).find(Boolean) || "";
    let name = pick(NAME_PATHS);
    if (!name)
      for (const parent of SPLIT_NAME_PARENTS)
        if (v[`${parent}first_name`] && v[`${parent}last_name`]) {
          name = `${v[`${parent}first_name`]} ${v[`${parent}last_name`]}`;
          break;
        }
    const words = fold(name).split(/[^a-z]+/).filter((w) => w.length >= 3);
    const email = fold(pick(EMAIL_PATHS)).trim();
    const digits = pick(PHONE_PATHS).replace(/\D/g, "");
    return {
      words,
      email: email.includes("@") ? email : "",
      phone: digits.length >= 7 ? digits.slice(-7) : "", // the last seven: +39, 0039 and 0 in front do not hide it
    };
  } catch (_error) {
    return null; // nothing of the error is kept: it could carry the path or a piece of the file
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_error) {
        /* closed or never opened */
      }
    }
  }
}

/** Which kinds of the person's data a query carries (the closed list KINDS), never what was found. */
function personKinds(person, query) {
  const kinds = [];
  const q = fold(query);
  const words = new Set(q.split(/[^a-z]+/).filter(Boolean));
  if (person.words.length && person.words.every((w) => words.has(w))) kinds.push("name");
  if (person.email && q.includes(person.email)) kinds.push("email");
  if (person.phone && q.replace(/\D/g, "").includes(person.phone)) kinds.push("phone");
  return kinds;
}

function describe(model) {
  const m = model && typeof model === "object" ? model : {};
  return { provider: String(m.provider || ""), api: String(m.api || "") };
}

module.exports = function webSearch(pi) {
  let searches = 0;
  let announced = false;
  let current = "";
  let added = false; // our tool is in the request in flight
  let withdrawn = null; // the status that withdrew the search for this session
  let retryPending = false; // the failed step is to be asked again, without the search, when the agent settles
  // the request in flight: Anthropic's blocks and usage of the message, Z.ai's search seen in the response
  let request = { blocks: 0, usage: null, seen: false, inputs: {} };
  // the check of the queries: the person (loaded on the first query), and what the turn found
  let person; // undefined = not loaded yet, null = unavailable
  let check = { queries: 0, matches: 0, kinds: new Set() };

  function checkQuery(query) {
    try {
      if (typeof query !== "string" || !query) return;
      if (person === undefined) {
        person = loadPerson();
        if (person === null) logLine({ event: "web_search_check_unavailable" });
      }
      check.queries += 1;
      if (!person) return;
      const kinds = personKinds(person, query);
      if (!kinds.length) return;
      check.matches += 1;
      for (const k of kinds) check.kinds.add(k);
      logLine({ event: "web_search_person_data", kinds, role: String(process.env.JHT_AGENT_NAME || "") });
    } catch (_error) {
      /* the check must never break the stream, nor say what it read */
    }
  }

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
    request = { blocks: 0, usage: null, seen: false, inputs: {} };
  }

  pi.on("before_provider_request", (event, ctx) => {
    try {
      const model = ctx && ctx.model;
      const { provider, api } = describe(model);
      const payload = event && event.payload;
      const known = PROVIDERS[provider];
      closeRequest(); // a request that ended without its stop still counts what it searched
      current = "";
      added = false;
      if (withdrawn !== null) return undefined; // said once, when it happened
      if (process.env.JHT_PI_WEB_SEARCH === "0") {
        announce(false, model, "web search turned off for the agents (JHT_PI_WEB_SEARCH=0)");
        return undefined;
      }
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
      added = true;
      return { ...payload, tools: [...tools, known.tool()] };
    } catch (_error) {
      return undefined; // never break the request of the agent
    }
  });

  pi.on("after_provider_response", (event, ctx) => {
    try {
      const status = event && Number(event.status);
      if (!added || !REFUSED.has(status)) return;
      withdrawn = status;
      added = false;
      retryPending = true;
      const model = ctx && ctx.model;
      const reason = `the provider refused a request that carried the web search (HTTP ${status}): withdrawn for this session`;
      try {
        pi.appendEntry(STATUS, { enabled: false, ...describe(model), reason });
      } catch (_error) {
        /* the log below still says it */
      }
      logLine({ event: "web_search_withdrawn", status, ...describe(model), current });
    } catch (_error) {
      /* never break the agent */
    }
  });

  pi.on("agent_settled", () => {
    if (!retryPending) return;
    retryPending = false;
    try {
      pi.sendUserMessage(
        `[WEB-SEARCH-OFF] The provider refused the web search tool (HTTP ${withdrawn}): it is off for the rest of this ` +
          "session. Repeat your last step without searching the web.",
      );
      logLine({ event: "web_search_retry_asked", status: withdrawn });
    } catch (_error) {
      logLine({ event: "web_search_retry_lost", status: withdrawn });
    }
  });

  pi.on("provider_stream_event", (event) => {
    try {
      const data = event && event.data;
      if (!data || typeof data !== "object") return;
      if (current === "openai") {
        if (data.type === "response.output_item.done" && data.item && data.item.type === "web_search_call") {
          searches += 1;
          const action = data.item.action || {};
          checkQuery(action.query);
          if (Array.isArray(action.queries)) for (const q of action.queries) if (q !== action.query) checkQuery(q);
        }
      } else if (current === "anthropic") {
        const block = data.content_block;
        if (data.type === "content_block_start" && block && block.type === "server_tool_use" && block.name === "web_search") {
          request.blocks += 1;
          const ready = block.input && typeof block.input.query === "string" ? block.input.query : null;
          request.inputs[data.index] = { json: "", query: ready };
        }
        const open = request.inputs[data.index];
        if (open && data.type === "content_block_delta" && data.delta && data.delta.type === "input_json_delta")
          if (!open.over) {
            open.json += String(data.delta.partial_json || "");
            if (open.json.length > QUERY_INPUT_MAX_CHARS) {
              open.over = true;
              open.json = "";
              open.query = null;
            }
          }
        if (open && data.type === "content_block_stop") {
          delete request.inputs[data.index];
          let query = open.query;
          try {
            if (open.json) query = JSON.parse(open.json).query;
          } catch (_error) {
            /* a broken input: no query to check */
          }
          checkQuery(query);
        }
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
    if (check.queries > 0) {
      const outcome = person
        ? { queries: check.queries, person_data: check.matches, kinds: KINDS.filter((k) => check.kinds.has(k)) }
        : { queries: check.queries, check: "unavailable" };
      check = { queries: 0, matches: 0, kinds: new Set() };
      try {
        pi.appendEntry(CHECK, outcome);
      } catch (_error) {
        /* the log lines already say a breach */
      }
    }
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
