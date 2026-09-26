import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The shell's client router. Routes live in the URL hash (`#/positions/42`):
 * the app is a static page served by Tauri, with nothing to answer a deep
 * path like `/positions/42` on reload, while the hash always comes back to
 * the same page. Web code keeps writing web paths (`/positions/42`): the
 * next/link and next/navigation stand-ins bring them here.
 */
export type Location = { path: string; search: string };

export const REFRESH_EVENT = "jht:refresh";

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#/, "");
  const [pathPart, ...rest] = raw.split("?");
  const path = "/" + pathPart.replace(/^\/+/, "").replace(/\/+$/, "");
  return { path, search: rest.length ? "?" + rest.join("?") : "" };
}

let current: Location = parseHash(typeof window === "undefined" ? "" : window.location.hash);
const listeners = new Set<() => void>();

function sync() {
  const next = parseHash(window.location.hash);
  if (next.path === current.path && next.search === current.search) return;
  current = next;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") window.addEventListener("hashchange", sync);

export function currentLocation(): Location {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocation(): Location {
  return useSyncExternalStore(subscribe, currentLocation, currentLocation);
}

/** Whether an href belongs to the app (a web path) rather than to the outside world. */
export function isAppHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/** Goes to a web path (`/positions/42?tab=cv`) inside the app. */
export function navigate(href: string, { replace = false }: { replace?: boolean } = {}): void {
  const target = "#" + (href.startsWith("#") ? href.slice(1) : href);
  if (replace) window.history.replaceState(window.history.state, "", target);
  else window.history.pushState(window.history.state, "", target);
  // pushState/replaceState do not fire hashchange.
  sync();
  window.scrollTo?.(0, 0);
}

/**
 * Asks the current page to read its data again: what router.refresh() means
 * on the web, where it re-runs the server components.
 */
export function refresh(): void {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
}

/** Runs `onRefresh` whenever something asks the page for fresh data (refresh(), router.refresh()). */
export function useRefresh(onRefresh: () => void): void {
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  useEffect(() => {
    const handler = () => latest.current();
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, []);
}

export type RouteMatch<T> = { route: T; params: Record<string, string> };

/** Matches `/positions/:id` style patterns; the first route that fits wins. */
export function matchRoute<T extends { path: string }>(routes: T[], path: string): RouteMatch<T> | null {
  const parts = path.split("/").filter(Boolean);
  for (const route of routes) {
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((seg, i) => {
      if (seg.startsWith(":")) {
        params[seg.slice(1)] = decodeURIComponent(parts[i]);
        return true;
      }
      return seg === parts[i];
    });
    if (ok) return { route, params };
  }
  return null;
}
