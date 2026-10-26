/**
 * The exchange rates the pages convert salaries with come from a public API (Frankfurter) that the
 * web asks through Next, which keeps the answer for a day. Here nothing kept it: every page of the
 * positions, the position, the dashboard and the swipe waited for a new request to another server,
 * with no limit of time (an offline or slow network held the page until the webview gave up).
 *
 * The answer is kept for a day (in the browser's storage, and in memory when that is not there), a
 * new request is cut after 3 s, and the last kept answer, however old, is given when the network does
 * not answer. The callers keep their own fallback for the case where there is nothing at all.
 */
const RATES_PREFIX = "https://api.frankfurter.dev/";
const STORAGE_KEY = "jht.rates.eur.v1";
const KEPT_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

type Kept = { at: number; body: string };
let inMemory: Kept | null = null;

export function isRatesRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  return method === "GET" && url.startsWith(RATES_PREFIX);
}

function load(): Kept | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const kept = JSON.parse(raw) as Partial<Kept>;
      if (typeof kept.at === "number" && typeof kept.body === "string") return { at: kept.at, body: kept.body };
    }
  } catch {
    // storage unavailable or damaged: the memory copy is all there is
  }
  return inMemory;
}

function save(kept: Kept): void {
  inMemory = kept;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // not kept on disk: kept in memory for this run
  }
}

/** Only an answer that is the rates of a table is kept: a page of an error is not. */
function ratesBody(text: string): boolean {
  try {
    const data = JSON.parse(text) as { rates?: unknown };
    return typeof data.rates === "object" && data.rates !== null && !Array.isArray(data.rates);
  } catch {
    return false;
  }
}

const json = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });

/** Forgets what was kept (a test). */
export function resetRatesKept(): void {
  inMemory = null;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // nothing to forget
  }
}

export async function ratesFetch(
  realFetch: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
  now: () => number = Date.now,
): Promise<Response> {
  const kept = load();
  if (kept && now() >= kept.at && now() - kept.at < KEPT_MS) return json(kept.body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const caller = init?.signal;
  const abort = () => controller.abort();
  if (caller?.aborted) controller.abort();
  else caller?.addEventListener("abort", abort, { once: true });
  try {
    const response = await realFetch(input, { ...init, signal: controller.signal });
    if (response.ok) {
      const text = await response.text();
      if (ratesBody(text)) {
        save({ at: now(), body: text });
        return json(text);
      }
    }
  } catch {
    // the network did not answer in time: the last answer, if there is one
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", abort);
  }
  if (kept) return json(kept.body);
  // nothing kept: the callers' own fallback (the web's table, or no rates) takes over
  throw new TypeError("rates_unavailable");
}
