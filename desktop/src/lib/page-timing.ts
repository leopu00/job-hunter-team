import { invoke, isTauri } from "@tauri-apps/api/core";
import { PAGE_ROUTES, type PageKey } from "../shell/route-paths";
import { matchRoute } from "../shell/router";

/** Local, closed metrics from route commit to visible data and the last observed activity.
 * Completion means 800 ms of quiet after data is shown, with no native read in flight.
 * A route left without data, or a load still waiting at 60 seconds, records a null first data.
 */
const IDLE_MS = 800;
const GIVE_UP_MS = 60_000;
const DATA_SOURCES = ["memory", "stream", "native", "cloud"] as const;
export type PageDataSource = typeof DATA_SOURCES[number];
type Call = { label: string; ms: number };
type Session = {
  page: PageKey;
  begun: number;
  firstData: number | null;
  firstDataSource: PageDataSource | null;
  last: number;
  inFlight: number;
  reads: number;
  readMs: number;
  cloud: Call[];
  idle: ReturnType<typeof setTimeout> | null;
  deadline: ReturnType<typeof setTimeout> | null;
  observer: PerformanceObserver | null;
};

let session: Session | null = null;
let clock: () => number = () => performance.now();

/** A test's monotonic clock. */
export function setPageTimingClock(next: (() => number) | null): void {
  clock = next ?? (() => performance.now());
}

export function pageOfPath(path: string): PageKey | null {
  try {
    return matchRoute(PAGE_ROUTES, path)?.route.key ?? null;
  } catch {
    return null;
  }
}

/** Only the table name or rates is retained; addresses and filters never leave the observer. */
export function cloudLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://localhost/");
  } catch {
    return "other";
  }
  if (parsed.hostname.endsWith("frankfurter.dev")) return "rates";
  const table = /\/rest\/v1\/([a-z][a-z0-9_]{0,31})$/.exec(parsed.pathname);
  return table ? table[1] : "other";
}

function finish(): void {
  const done = session;
  session = null;
  if (!done) return;
  if (done.idle !== null) clearTimeout(done.idle);
  if (done.deadline !== null) clearTimeout(done.deadline);
  done.observer?.disconnect();
  const ms = (at: number) => Math.max(0, Math.round(at - done.begun));
  const last = done.firstData === null || done.inFlight > 0 ? Math.max(done.last, clock()) : done.last;
  void invoke("page_load_metric", {
    metric: {
      page: done.page,
      firstDataMs: done.firstData === null ? null : ms(done.firstData),
      firstDataSource: done.firstDataSource,
      completeMs: ms(last),
      nativeReads: done.reads,
      nativeMs: Math.round(done.readMs),
      cloud: done.cloud.slice(0, 24),
    },
  }).catch(() => undefined);
}

function settle(now: Session): void {
  if (now.idle !== null) clearTimeout(now.idle);
  now.idle = null;
  if (now.firstData === null || now.inFlight > 0) return;
  now.idle = setTimeout(() => {
    if (session === now) finish();
  }, IDLE_MS);
}

function observeCloud(now: Session): void {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    now.observer = new PerformanceObserver((list) => {
      if (session !== now) return;
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if (entry.initiatorType !== "fetch" && entry.initiatorType !== "xmlhttprequest") continue;
        if (entry.startTime < now.begun) continue;
        now.cloud.push({ label: cloudLabel(entry.name), ms: Math.round(entry.duration) });
        now.last = Math.max(now.last, entry.responseEnd);
      }
      settle(now);
    });
    now.observer.observe({ type: "resource", buffered: false });
  } catch {
    now.observer?.disconnect();
    now.observer = null;
  }
}

/** All registered routes, including local teams. Cleanup only closes the session it opened. */
export function beginPageLoad(path: string): () => void {
  finish();
  const page = pageOfPath(path);
  if (!page || !isTauri()) return () => undefined;
  const begun = clock();
  const now: Session = {
    page, begun, firstData: null, firstDataSource: null, last: begun,
    inFlight: 0, reads: 0, readMs: 0, cloud: [], idle: null, deadline: null, observer: null,
  };
  session = now;
  now.deadline = setTimeout(() => { if (session === now) finish(); }, GIVE_UP_MS);
  observeCloud(now);
  return () => { if (session === now) finish(); };
}

/** Call after committed data is visible (including a successful empty result), never on a skeleton/error. */
export function dataShown(source: PageDataSource): void {
  const now = session;
  if (!now || !DATA_SOURCES.includes(source)) return;
  const shown = clock();
  if (now.firstData === null) {
    now.firstData = shown;
    now.firstDataSource = source;
  }
  now.last = Math.max(now.last, shown);
  settle(now);
}

/** Counts completed reads, whether they worked or failed. Visible data is reported separately. */
export function nativeReadStarted(): (worked: boolean) => void {
  const now = session;
  if (!now) return () => undefined;
  const started = clock();
  let completed = false;
  now.inFlight += 1;
  settle(now);
  return (_worked) => {
    if (completed || session !== now) return;
    completed = true;
    now.inFlight -= 1;
    const ended = clock();
    now.reads += 1;
    now.readMs += ended - started;
    now.last = Math.max(now.last, ended);
    settle(now);
  };
}
