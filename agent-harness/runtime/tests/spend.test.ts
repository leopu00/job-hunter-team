/**
 * `npm run spend` (JHT-API-TEST A2, A3): the spend repriced from the key
 * proxy's log or the team's ledger, and reconciled with OpenAI's Costs API.
 * Synthetic lines only: the real week lives outside the repo.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBilledDays, main, parseLedger, parseProxyLog, reconcile, spendByDay } from "../src/cli/spend.ts";

const proxyLine = (o: Record<string, unknown>) =>
  JSON.stringify({ ts: "2026-01-05T10:00:00.000Z", model: "gpt-5.6-luna", status: 200, in: 10_000, cached: 8_000, cache_write: 1_000, out: 200, ...o });

// 1,000 fresh × 0.20 + 8,000 cached × 0.02 + 1,000 written × 0.25 + 200 × 1.20, per million.
const ONE_REQUEST = (1_000 * 0.2 + 8_000 * 0.02 + 1_000 * 0.25 + 200 * 1.2) / 1_000_000;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jht-spend-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("repricing the key proxy's log", () => {
  it("prices each request on its own and bills one search per response that searched", () => {
    const rows = parseProxyLog(
      [
        proxyLine({ web_search_calls: 2, web_search_actions: ["search", "search"] }),
        proxyLine({ web_search_calls: 2, web_search_actions: ["search", "open_page"] }),
        proxyLine({ web_search_calls: 1, web_search_actions: ["open_page"] }),
        proxyLine({}),
        // An old line, before the proxy kept the actions: the item count, under the same cap.
        proxyLine({ web_search_calls: 2 }),
        // Not a settled request: no usage.
        JSON.stringify({ ts: "2026-01-05T10:00:00.000Z", method: "GET", status: 401 }),
        "",
      ].join("\n"),
    );
    expect(rows).toHaveLength(5);
    const [day] = spendByDay(rows);
    expect(day!.searches).toBe(3);
    expect(day!.tokensUsd).toBeCloseTo(5 * ONE_REQUEST, 12);
    expect(day!.usd).toBeCloseTo(5 * ONE_REQUEST + 0.03, 12);
  });

  it("applies luna's long-context rates to a request above 272K input tokens, and only to it", () => {
    const [day] = spendByDay(parseProxyLog(proxyLine({ in: 300_000, cached: 0, cache_write: 0, out: 1_000 })));
    expect(day!.tokensUsd).toBeCloseTo((300_000 * 0.4 + 1_000 * 1.8) / 1_000_000, 12);
  });

  it("keeps a model the catalog does not price out of the total, and says so", () => {
    const [day] = spendByDay(parseProxyLog(proxyLine({ model: "gpt-unknown" })));
    expect(day!.usd).toBe(0);
    expect(day!.unpriced).toBe(1);
  });
});

describe("repricing the ledger", () => {
  const header = "data\truolo\tmodello\ttoken_in\ttoken_cached\ttoken_out\tusd\trun_id\tnote";

  it("reads the cache writes from the note, prices a run at short rates, and knows it has no search count", () => {
    const rows = parseLedger(
      [
        header,
        "2026-01-05T10:00:00Z\tscout\topenai/gpt-5.6-luna\t10000\t8000\t200\t9.99\tr1\tcompleted; cache_write_tokens=1000",
        "2026-01-05T11:00:00Z\tscorer\tgpt-5.6-luna\t10000\t8000\t200\t9.99\tr2\tfonte=keyproxy richieste=3 cache_write=1000 exit=0",
        // A run longer than 272K in all: many requests, each far under it.
        "2026-01-06T11:00:00Z\tscout\tgpt-5.6-luna\t400000\t0\t0\t9.99\tr3\tcompleted",
        "not a run\t\t\t\t\t\t\t\t",
      ].join("\n"),
    );
    const days = spendByDay(rows);
    expect(days.map((d) => d.day)).toEqual(["2026-01-05", "2026-01-06"]);
    expect(days[0]!.tokensUsd).toBeCloseTo(2 * ONE_REQUEST, 12);
    expect(days[0]!.searchesUnknown).toBe(2);
    expect(days[1]!.tokensUsd).toBeCloseTo((400_000 * 0.2) / 1_000_000, 12);
  });
});

describe("reconciling with OpenAI's Costs API", () => {
  it("reads the daily buckets across pages, for one project when asked", async () => {
    const urls: URL[] = [];
    const pages = [
      { data: [{ start_time: Date.parse("2026-01-05T00:00:00Z") / 1000, results: [{ amount: { value: 0.1, currency: "usd" } }, { amount: { value: 0.02, currency: "usd" } }] }], has_more: true, next_page: "p2" },
      { data: [{ start_time: Date.parse("2026-01-06T00:00:00Z") / 1000, results: [{ amount: { value: 0.3, currency: "usd" } }] }], has_more: false, next_page: null },
    ];
    const fetchImpl = vi.fn(async (url: URL | string | Request) => {
      urls.push(url as URL);
      return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 });
    }) as unknown as typeof fetch;
    const billed = await fetchBilledDays({ adminKey: "admin", startDay: "2026-01-05", endDay: "2026-01-06", projectId: "proj_1", fetchImpl });
    expect(billed.map((d) => [d.day, Number(d.usd.toFixed(6))])).toEqual([
      ["2026-01-05", 0.12],
      ["2026-01-06", 0.3],
    ]);
    expect(urls[0]!.pathname).toBe("/v1/organization/costs");
    expect(urls[0]!.searchParams.get("bucket_width")).toBe("1d");
    expect(urls[0]!.searchParams.getAll("project_ids[]")).toEqual(["proj_1"]);
    expect(urls[1]!.searchParams.get("page")).toBe("p2");
    const [, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect((init as RequestInit).headers).toEqual({ Authorization: "Bearer admin" });
  });

  it("raises the alarm past the threshold either way, and on a day only one side saw", () => {
    const ours = [
      { day: "2026-01-05", usd: 0.105 },
      { day: "2026-01-06", usd: 0.5 },
      { day: "2026-01-07", usd: 0.07 },
      { day: "2026-01-08", usd: 0.2 },
    ].map((d) => ({ ...d, tokensUsd: d.usd, searchesUsd: 0, searches: 0, unpriced: 0, searchesUnknown: 0 }));
    const billed = [
      { day: "2026-01-05", usd: 0.1 },
      { day: "2026-01-06", usd: 0.1 },
      { day: "2026-01-07", usd: 0.1 },
      { day: "2026-01-09", usd: 0.1 },
    ];
    expect(reconcile(ours, billed).map((r) => [r.day, r.alarm])).toEqual([
      ["2026-01-05", false],
      ["2026-01-06", true],
      ["2026-01-07", true],
      ["2026-01-08", true],
      ["2026-01-09", true],
    ]);
  });

  it("says it compared nothing without an admin key, and does not call OpenAI", async () => {
    const path = join(dir, "requests.jsonl");
    await writeFile(path, proxyLine({}) + "\n");
    const lines: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(main(["reconcile", path], {}, (l) => lines.push(l))).resolves.toBe(0);
    expect(lines.join("\n")).toMatch(/skipped: OPENAI_ADMIN_KEY is not set/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("reprice prints the days and the total", async () => {
    const path = join(dir, "requests.jsonl");
    await writeFile(path, [proxyLine({ web_search_actions: ["search", "search"] }), proxyLine({})].join("\n"));
    const lines: string[] = [];
    await expect(main(["reprice", path], {}, (l) => lines.push(l))).resolves.toBe(0);
    expect(lines[1]).toBe(`2026-01-05\t${(2 * ONE_REQUEST).toFixed(4)}\t1\t0.0100\t${(2 * ONE_REQUEST + 0.01).toFixed(4)}`);
    expect(lines.at(-1)).toBe(`total\t\t\t\t${(2 * ONE_REQUEST + 0.01).toFixed(4)}`);
  });
});
