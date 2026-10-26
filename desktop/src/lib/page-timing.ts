import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * How long the pages of a linked team take to show their data: the globe, the list of positions and
 * one position. From the moment the page is asked for (the route changes) to the first data, and to
 * the last, with how many reads of the team it made and how long they took, and the calls to the
 * cloud it waited for (a table's name or `rates`, and their time). It is written down on this
 * computer, in the load-times log, by a native command that takes closed fields only: no address,
 * identifier, filter or row passes through here.
 *
 * «Last» is the moment of the last read that finished before 800 ms of quiet with none in flight.
 */
const IDLE_MS = 800;
const GIVE_UP_MS = 60_000;

type Page = "map" | "positions" | "position";
type Call = { label: string; ms: number };
type Session = {
  page: Page;
  begun: number;
  firstData: number | null;
  last: number;
  inFlight: number;
  reads: number;
  readMs: number;
  cloud: Call[];
  timer: ReturnType<typeof setTimeout> | null;
  observer: PerformanceObserver | null;
};

let session: Session | null = null;
let clock: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** A test's clock. */
export function setPageTimingClock(next: (() => number) | null): void {
  clock = next ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
}

export function pageOfPath(path: string): Page | null {
  if (path === "/map") return "map";
  if (path === "/positions") return "positions";
  return /^\/positions\/[^/]+$/.test(path) ? "position" : null;
}

/** What a request to the cloud asked, as a name that says nothing about the person: a table, or the rates. */
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

function finish(emit: boolean): void {
  const done = session;
  session = null;
  if (!done) return;
  if (done.timer) clearTimeout(done.timer);
  done.observer?.disconnect();
  if (!emit || (done.reads === 0 && done.cloud.length === 0)) return;
  const firstData = done.firstData ?? done.last;
  void invoke("page_load_metric", {
    metric: {
      page: done.page,
      firstDataMs: Math.max(0, Math.round(firstData - done.begun)),
      completeMs: Math.max(0, Math.round(done.last - done.begun)),
      nativeReads: done.reads,
      nativeMs: Math.round(done.readMs),
      cloud: done.cloud.slice(0, 24),
    },
  }).catch(() => undefined);
}

function settle(now: Session): void {
  if (now.timer) clearTimeout(now.timer);
  now.timer = setTimeout(() => {
    if (session !== now) return;
    if (now.inFlight > 0 && clock() - now.begun < GIVE_UP_MS) return settle(now);
    finish(true);
  }, IDLE_MS);
}

/** The page of this route is being asked for: the clock starts. Any other route ends the one before. */
export function beginPageLoad(path: string): void {
  finish(true);
  const page = pageOfPath(path);
  if (!page || !isTauri()) return;
  const now: Session = { page, begun: clock(), firstData: null, last: clock(), inFlight: 0, reads: 0, readMs: 0, cloud: [], timer: null, observer: null };
  session = now;
  if (typeof PerformanceObserver !== "undefined") {
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
      now.observer = null;
    }
  }
  settle(now);
}

/** A read of the team starts; the function it returns is called when it ends, with whether it worked. */
export function nativeReadStarted(): (worked: boolean) => void {
  const now = session;
  if (!now) return () => undefined;
  const started = clock();
  now.inFlight += 1;
  return (worked) => {
    now.inFlight -= 1;
    if (session !== now) return;
    const ended = clock();
    now.reads += 1;
    now.readMs += ended - started;
    now.last = Math.max(now.last, ended);
    if (worked && now.firstData === null) now.firstData = ended;
    settle(now);
  };
}
