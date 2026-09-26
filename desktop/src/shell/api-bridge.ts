import { locales } from "@/i18n/config";
import { readLocaleCookie } from "@/lib/use-locale";

/**
 * The web components call the web's Next routes (`fetch("/api/…")`), which do
 * not exist in the desktop. The bridge answers them inside the webview: only
 * same-origin calls under /api/ go to `answer`, a function with fetch's
 * signature that does the route's work with the user's session (the ported
 * routes live in desktop/src/lib/web-api.ts). Everything else (Supabase,
 * exchange rates, Tauri IPC) goes to the real fetch. So a web component that
 * calls a ported route runs unchanged.
 */
export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function apiPath(input: RequestInfo | URL): string | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.href);
  if (url.origin !== window.location.origin) return null;
  return url.pathname.startsWith("/api/") ? url.pathname : null;
}

/** A route that is not ported: a JSON error, never Tauri's HTML 404 that a component would choke on. */
export const notInDesktop: ApiFetch = async (input) => json({ error: "not_in_desktop", path: apiPath(input) }, 404);

/**
 * Routes the shell itself answers before handing over to `next`.
 * web/app/api/i18n/route.ts GET: the locale the web pages render in
 * (NavLinks and DashboardI18nProvider ask for it).
 */
export function shellApi(next: ApiFetch): ApiFetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (apiPath(input) === "/api/i18n" && method === "GET") {
      return json({ current: readLocaleCookie(), locales });
    }
    return next(input, init);
  };
}

/** Wraps fetch once; returns the function that puts the real one back (for tests). */
export function installApiBridge(answer: ApiFetch, target: typeof globalThis = globalThis): () => void {
  const realFetch = target.fetch.bind(target);
  target.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiPath(input) ? answer(input, init) : realFetch(input, init);
  return () => {
    target.fetch = realFetch;
  };
}
