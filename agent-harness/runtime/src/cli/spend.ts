/**
 * `npm run spend` — what the runs cost, priced as OpenAI bills them, and
 * checked against what OpenAI billed (JHT-API-TEST A2, A3).
 *
 *   npm run spend -- reprice <requests.jsonl|openai-spesa.tsv>
 *       the spend per day at the catalog's prices: the key proxy's log
 *       request by request (web searches from the items it saw), or the
 *       team's ledger run by run (tokens only: it has no search count)
 *   npm run spend -- reconcile <requests.jsonl|openai-spesa.tsv> [--days=7] [--project=<id>] [--threshold=0.10]
 *       the same days against OpenAI's Costs API; exit 1 when a day is off
 *       by more than the threshold. Needs OPENAI_ADMIN_KEY (an admin key,
 *       which the operator creates); without it, says so and exits 0.
 *
 * Read-only: it reads the file it is given and, for reconcile, one OpenAI
 * endpoint. A price here is the runtime's own (catalog.ts, usage.ts), so a
 * reconcile that fails is a catalog that went stale, or a count gone wrong.
 */

import { readFileSync } from "node:fs";

import { billedSearches } from "../core/provider/ai-sdk.ts";
import { modelProfile } from "../core/provider/catalog.ts";
import { costUsd, type Pricing, type Usage } from "../core/usage.ts";

/** One billed request, or one run of the ledger, reduced to what prices it. */
export interface SpendRow {
  /** UTC day, YYYY-MM-DD: OpenAI's buckets are UTC days. */
  day: string;
  model: string;
  usage: Usage;
  /** Web searches billed; null when the source does not say. */
  searches: number | null;
  /** Whether `usage` is one request (long-context rates apply) or a whole run. */
  perRequest: boolean;
}

export interface DaySpend {
  day: string;
  tokensUsd: number;
  searchesUsd: number;
  usd: number;
  searches: number;
  /** Rows whose model the catalog does not price: their cost is unknown, not zero. */
  unpriced: number;
  /** Rows whose search count is unknown (the ledger's). */
  searchesUnknown: number;
}

const bareModel = (model: string) => model.replace(/^openai\//, "").trim();

function pricingOf(model: string): Pricing | null {
  return modelProfile({ providerId: "openai", modelId: bareModel(model) }).pricing;
}

/**
 * The key proxy's log (requests.jsonl), one line per request it settled.
 * The searches are the items OpenAI returned, through the runtime's own
 * rule (billedSearches); the oldest lines, written before the proxy kept the
 * actions, give only the item count, and are read under the same cap.
 */
export function parseProxyLog(text: string): SpendRow[] {
  const rows: SpendRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Record<string, unknown>;
    if (typeof r["in"] !== "number" || typeof r["model"] !== "string" || typeof r["ts"] !== "string") continue;
    const actions = Array.isArray(r["web_search_actions"]) ? (r["web_search_actions"] as unknown[]).map(String) : null;
    const calls = typeof r["web_search_calls"] === "number" ? r["web_search_calls"] : null;
    const searches =
      actions !== null
        ? billedSearches("openai", actions.map((type) => ({ type: "tool-result", output: { action: { type } } })))
        : calls !== null
          ? billedSearches("openai", Array.from({ length: calls }, () => ({ type: "tool-result", output: { action: { type: "search" } } })))
          : 0;
    rows.push({
      day: r["ts"].slice(0, 10),
      model: r["model"],
      usage: {
        inputTokens: r["in"],
        cachedInputTokens: typeof r["cached"] === "number" ? r["cached"] : 0,
        cacheWriteTokens: typeof r["cache_write"] === "number" ? r["cache_write"] : 0,
        outputTokens: typeof r["out"] === "number" ? r["out"] : 0,
      },
      searches,
      perRequest: true,
    });
  }
  return rows;
}

/**
 * The team's ledger (openai-spesa.tsv), one line per run. Cache writes are in
 * the note (`cache_write_tokens=N`, or `cache_write=N` from the proxy's sum).
 * A run is many requests, each far under the long-context threshold, so it is
 * priced at short rates; it records no search count.
 */
export function parseLedger(text: string): SpendRow[] {
  const [header, ...lines] = text.split("\n").filter((l) => l.trim());
  const cols = (header ?? "").split("\t");
  const at = (name: string) => cols.indexOf(name);
  const rows: SpendRow[] = [];
  for (const line of lines) {
    const f = line.split("\t");
    const num = (name: string) => Number(f[at(name)] ?? 0) || 0;
    const day = (f[at("data")] ?? "").slice(0, 10);
    // A line that is not a dated run (a heading, a comment) prices nothing.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const note = f[at("note")] ?? "";
    const write = /cache_write(?:_tokens)?=(\d+)/.exec(note);
    rows.push({
      day,
      model: f[at("modello")] ?? "",
      usage: {
        inputTokens: num("token_in"),
        cachedInputTokens: num("token_cached"),
        cacheWriteTokens: write ? Number(write[1]) : 0,
        outputTokens: num("token_out"),
      },
      searches: null,
      perRequest: false,
    });
  }
  return rows;
}

export function readSpendRows(path: string): SpendRow[] {
  const text = readFileSync(path, "utf8");
  return path.endsWith(".jsonl") ? parseProxyLog(text) : parseLedger(text);
}

/** The spend per UTC day, at the catalog's prices. */
export function spendByDay(rows: SpendRow[]): DaySpend[] {
  const days = new Map<string, DaySpend>();
  for (const row of rows) {
    const day =
      days.get(row.day) ??
      { day: row.day, tokensUsd: 0, searchesUsd: 0, usd: 0, searches: 0, unpriced: 0, searchesUnknown: 0 };
    days.set(row.day, day);
    const pricing = pricingOf(row.model);
    if (!pricing) {
      day.unpriced += 1;
      continue;
    }
    // A ledger row sums a run's requests: long-context rates are per request.
    const { longContext: _perRequestOnly, ...shortRates } = pricing;
    const tokens = costUsd(row.usage, row.perRequest ? pricing : shortRates);
    const searches = row.searches ?? 0;
    if (row.searches === null) day.searchesUnknown += 1;
    day.tokensUsd += tokens;
    day.searches += searches;
    day.searchesUsd += searches * (pricing.webSearchPerCallUsd ?? 0);
    day.usd = day.tokensUsd + day.searchesUsd;
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** One UTC day of OpenAI's Costs API, summed over its line items. */
export interface BilledDay {
  day: string;
  usd: number;
}

/**
 * Days billed by OpenAI's Costs API (GET /v1/organization/costs, admin key),
 * optionally for one project: the key may share an organization with other
 * work, and without a project the day is the whole organization's.
 */
export async function fetchBilledDays(options: {
  adminKey: string;
  startDay: string;
  endDay: string;
  projectId?: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<BilledDay[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const toUnix = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  const days = new Map<string, number>();
  let page: string | undefined;
  do {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(toUnix(options.startDay)));
    url.searchParams.set("end_time", String(toUnix(options.endDay) + 86_400));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "31");
    if (options.projectId) url.searchParams.append("project_ids[]", options.projectId);
    if (page) url.searchParams.set("page", page);
    const res = await doFetch(url, { headers: { Authorization: `Bearer ${options.adminKey}` } });
    if (!res.ok) throw new Error(`OpenAI Costs API answered ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{ start_time: number; results?: Array<{ amount?: { value?: number; currency?: string } }> }>;
      has_more?: boolean;
      next_page?: string | null;
    };
    for (const bucket of body.data ?? []) {
      const day = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
      let usd = days.get(day) ?? 0;
      for (const result of bucket.results ?? []) {
        const currency = result.amount?.currency ?? "usd";
        if (currency.toLowerCase() !== "usd") throw new Error(`OpenAI Costs API billed in ${currency}, not USD`);
        usd += result.amount?.value ?? 0;
      }
      days.set(day, usd);
    }
    page = body.has_more && body.next_page ? body.next_page : undefined;
  } while (page);
  return [...days.entries()].map(([day, usd]) => ({ day, usd })).sort((a, b) => a.day.localeCompare(b.day));
}

export interface ReconciledDay {
  day: string;
  oursUsd: number;
  billedUsd: number;
  /** (ours − billed) / billed; null when nothing was billed. */
  gap: number | null;
  alarm: boolean;
}

/**
 * Each day ours against OpenAI's. A day is an alarm when the gap passes the
 * threshold either way, or when one side spent and the other says nothing:
 * a count that is too low is as wrong as one too high.
 */
export function reconcile(ours: DaySpend[], billed: BilledDay[], threshold = 0.1): ReconciledDay[] {
  const all = new Set([...ours.map((d) => d.day), ...billed.map((d) => d.day)]);
  return [...all].sort().map((day) => {
    const oursUsd = ours.find((d) => d.day === day)?.usd ?? 0;
    const billedUsd = billed.find((d) => d.day === day)?.usd ?? 0;
    const gap = billedUsd > 0 ? (oursUsd - billedUsd) / billedUsd : null;
    const alarm = gap === null ? oursUsd > 0.005 : Math.abs(gap) > threshold;
    return { day, oursUsd, billedUsd, gap, alarm };
  });
}

const usd4 = (n: number) => n.toFixed(4);

function option(args: string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, out: (line: string) => void): Promise<number> {
  const [command, path, ...rest] = argv;
  if ((command !== "reprice" && command !== "reconcile") || !path) {
    out("usage: npm run spend -- reprice|reconcile <requests.jsonl|openai-spesa.tsv> [--days=N] [--project=<id>] [--threshold=0.10]");
    return 2;
  }
  const days = spendByDay(readSpendRows(path));
  if (command === "reprice") {
    out("day\ttokens_usd\tsearches\tsearches_usd\tusd");
    for (const d of days) {
      out(`${d.day}\t${usd4(d.tokensUsd)}\t${d.searchesUnknown ? "?" : d.searches}\t${usd4(d.searchesUsd)}\t${usd4(d.usd)}`);
    }
    const total = days.reduce((a, d) => a + d.usd, 0);
    out(`total\t\t\t\t${usd4(total)}`);
    if (days.some((d) => d.searchesUnknown)) out("note: the ledger has no search count; its searches are not in these totals.");
    if (days.some((d) => d.unpriced)) out("note: some rows name a model the catalog does not price; they are not in these totals.");
    return 0;
  }

  const adminKey = env["OPENAI_ADMIN_KEY"]?.trim();
  if (!adminKey) {
    out("skipped: OPENAI_ADMIN_KEY is not set (an admin key, created by the operator): nothing was compared.");
    return 0;
  }
  const lastDays = Number(option(rest, "days") ?? 7);
  const threshold = Number(option(rest, "threshold") ?? 0.1);
  const recent = days.slice(-lastDays);
  if (recent.length === 0) {
    out("nothing to compare: the file has no priced day.");
    return 1;
  }
  const project = option(rest, "project");
  const billed = await fetchBilledDays({ adminKey, startDay: recent[0]!.day, endDay: recent.at(-1)!.day, projectId: project });
  const result = reconcile(recent, billed, threshold);
  out(`day\tours_usd\tbilled_usd\tgap${project ? "" : "\t(whole organization: pass --project to compare one project)"}`);
  for (const r of result) {
    out(`${r.day}\t${usd4(r.oursUsd)}\t${usd4(r.billedUsd)}\t${r.gap === null ? "-" : `${(r.gap * 100).toFixed(1)}%`}${r.alarm ? "\tALARM" : ""}`);
  }
  return result.some((r) => r.alarm) ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2), process.env, (line) => console.log(line)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
