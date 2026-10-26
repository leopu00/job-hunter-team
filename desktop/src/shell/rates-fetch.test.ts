import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installApiBridge } from "./api-bridge";
import { isRatesRequest, ratesFetch, resetRatesKept } from "./rates-fetch";

// The exchange rates of the pages: kept for a day, a new request cut after 3 s, the last answer
// when the network does not answer. Synthetic rates only.
const URL_RATES = "https://api.frankfurter.dev/v1/latest?base=EUR";
const TABLE = JSON.stringify({ base: "EUR", rates: { USD: 1.1, CHF: 0.95 } });
const answer = (body: string, status = 200) => new Response(body, { status });

beforeEach(() => resetRatesKept());
afterEach(() => vi.useRealTimers());

describe("the exchange rates", () => {
  it("asks the network once a day, whoever asks", async () => {
    const real = vi.fn(async () => answer(TABLE));
    let now = 1_000_000;
    const first = await (await ratesFetch(real as unknown as typeof fetch, URL_RATES, undefined, () => now)).json();
    now += 23 * 3_600_000;
    const second = await (await ratesFetch(real as unknown as typeof fetch, URL_RATES, undefined, () => now)).json();
    expect(first).toEqual(second);
    expect(real).toHaveBeenCalledTimes(1);
    now += 2 * 3_600_000;
    await ratesFetch(real as unknown as typeof fetch, URL_RATES, undefined, () => now);
    expect(real).toHaveBeenCalledTimes(2);
  });

  it("gives the last answer, however old, when the network does not answer, or answers with an error", async () => {
    let now = 0;
    const good = vi.fn(async () => answer(TABLE));
    await ratesFetch(good as unknown as typeof fetch, URL_RATES, undefined, () => now);
    now += 3 * 24 * 3_600_000;
    for (const broken of [vi.fn(async () => { throw new TypeError("offline"); }), vi.fn(async () => answer("nope", 503)), vi.fn(async () => answer("<html>", 200))]) {
      const kept = await ratesFetch(broken as unknown as typeof fetch, URL_RATES, undefined, () => now);
      expect(await kept.json()).toEqual(JSON.parse(TABLE));
    }
  });

  it("with nothing kept and no answer it fails, for the caller's own fallback, and keeps no error page", async () => {
    await expect(ratesFetch((async () => answer("nope", 500)) as unknown as typeof fetch, URL_RATES)).rejects.toThrow("rates_unavailable");
    await expect(ratesFetch((async () => answer("{}", 200)) as unknown as typeof fetch, URL_RATES)).rejects.toThrow("rates_unavailable");
    expect(globalThis.localStorage.getItem("jht.rates.eur.v1")).toBeNull();
  });

  it("cuts a request that does not answer after 3 s", async () => {
    vi.useFakeTimers();
    const hung = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const outcome = ratesFetch(hung as unknown as typeof fetch, URL_RATES).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(hung).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(await outcome).toBe("rates_unavailable");
  });

  it("works without storage, and the bridge sends only this address through it", async () => {
    const storage = vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    const real = vi.fn(async () => answer(TABLE));
    await ratesFetch(real as unknown as typeof fetch, URL_RATES);
    await ratesFetch(real as unknown as typeof fetch, URL_RATES);
    expect(real).toHaveBeenCalledTimes(1);
    storage.mockRestore();

    expect(isRatesRequest(URL_RATES)).toBe(true);
    expect(isRatesRequest(new URL(URL_RATES))).toBe(true);
    expect(isRatesRequest(URL_RATES, { method: "POST" })).toBe(false);
    expect(isRatesRequest("https://api.frankfurter.dev.example.invalid/v1/latest")).toBe(false);
    expect(isRatesRequest("https://example.invalid/?u=https://api.frankfurter.dev/")).toBe(false);

    resetRatesKept();
    const network = vi.fn(async (_url: RequestInfo | URL) => answer(TABLE));
    const fake = { fetch: network } as unknown as typeof globalThis;
    const restore = installApiBridge(async () => answer("{}"), fake);
    await fake.fetch(URL_RATES);
    await fake.fetch(URL_RATES);
    await fake.fetch("https://example.invalid/other");
    restore();
    // the rates once for the two asks, and the other address straight to the network
    expect(network.mock.calls.map(([url]) => url)).toEqual([URL_RATES, "https://example.invalid/other"]);
  });
});
