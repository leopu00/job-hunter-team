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

/**
 * A web route module (web/app/api/.../route.ts): its exports are handlers
 * named after HTTP methods, called as Next calls them, `(request, { params })`.
 */
export type WebRouteModule = Record<string, unknown>;

type WebHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("[") && a[i].endsWith("]")) params[a[i].slice(1, -1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/**
 * Runs web route handlers as they are, for an explicit list of routes whose
 * work is a Supabase read or write with the user's session (their
 * server-only imports resolve to the desktop stand-ins). Patterns use the
 * web's folder syntax: "/api/pending-messages/[id]/ack". A listed route
 * without a handler for the method answers 405, as Next does.
 */
export function webRoutes(routes: Record<string, WebRouteModule>, next: ApiFetch): ApiFetch {
  return async (input, init) => {
    const path = apiPath(input);
    if (path) {
      for (const [pattern, mod] of Object.entries(routes)) {
        const params = matchPattern(pattern, path);
        if (!params) continue;
        const request = new Request(input instanceof Request ? input : new URL(String(input), window.location.href), init);
        const handler = mod[request.method.toUpperCase()];
        if (typeof handler !== "function") return json({ error: "method_not_allowed" }, 405);
        return (handler as WebHandler)(request, { params: Promise.resolve(params) });
      }
    }
    return next(input, init);
  };
}
