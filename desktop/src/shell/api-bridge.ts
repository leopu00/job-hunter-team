import { NextRequest } from "next/server";
import { locales } from "@/i18n/config";
import { readLocaleCookie } from "@/lib/use-locale";
import { existingTeamReadOnly } from "../lib/existing-team-readonly";
import { localTeamData } from "../lib/local-team-data";
import { isRatesRequest, ratesFetch } from "./rates-fetch";

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
 * While an existing team's VPS is only being read (lib/existing-team-readonly.ts)
 * the pages ask for the locale, the sidebar's dataset and the globe's three
 * reads (answered from the VPS by pages/map/map-api.ts). Anything else is
 * refused here, before a route can write to the cloud. The controls that would
 * ask are disabled, so this answers a call nobody should make.
 */
const READ_ONLY_PATHS = new Set([
  "/api/i18n",
  "/api/positions/facets",
  "/api/positions/coords",
  "/api/positions/no-coords",
  "/api/positions/locations",
]);

/**
 * web/app/api/i18n/route.ts POST, as the web serves it: a language the app has
 * is kept in the NEXT_LOCALE cookie, anything else is a 400. It is answered
 * before the read-only gate because it writes nothing to the team, the VPS or
 * the cloud: the cookie is this webview's own, as it is on the web's open route.
 */
async function setLocale(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let body: { locale?: unknown } = {};
  try {
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (typeof raw === "string") body = JSON.parse(raw);
  } catch {
    // An unreadable body is a missing language: the 400 below.
  }
  const locale = body.locale;
  if (typeof locale !== "string" || !(locales as readonly string[]).includes(locale)) {
    return json({ error: "unsupported_locale" }, 400);
  }
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  return json({ locale });
}

/**
 * Routes the shell itself answers before handing over to `next`.
 * web/app/api/i18n/route.ts GET: the locale the web pages render in
 * (NavLinks and DashboardI18nProvider ask for it); POST: the language the
 * person picks in the settings page.
 */
export function shellApi(next: ApiFetch): ApiFetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const path = apiPath(input);
    if (path === "/api/i18n" && method === "POST") return setLocale(input, init);
    if (existingTeamReadOnly() && path && !(method === "GET" && READ_ONLY_PATHS.has(path))) {
      return json({ error: "read_only" }, 403);
    }
    // The team of this computer is only read: what the positions pages would change in it (a judgement, a note,
    // a request) is refused the same way. The other pages of a local profile keep the routes they have.
    if (localTeamData() && path?.startsWith("/api/positions/") && method !== "GET") {
      return json({ error: "read_only" }, 403);
    }
    if (path === "/api/i18n" && method === "GET") {
      return json({ current: readLocaleCookie(), locales });
    }
    return next(input, init);
  };
}

/** Wraps fetch once; returns the function that puts the real one back (for tests). */
export function installApiBridge(answer: ApiFetch, target: typeof globalThis = globalThis): () => void {
  const realFetch = target.fetch.bind(target);
  target.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiPath(input) ? answer(input, init) : isRatesRequest(input, init) ? ratesFetch(realFetch, input, init) : realFetch(input, init);
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
 * Runs web route handlers as they are, with a NextRequest (next/server
 * stand-in), for an explicit list of routes whose
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
        // A NextRequest, as Next hands the handler (some read req.nextUrl).
        const request = new NextRequest(input instanceof Request ? input : new URL(String(input), window.location.href), init);
        const handler = mod[request.method.toUpperCase()];
        if (typeof handler !== "function") return json({ error: "method_not_allowed" }, 405);
        return (handler as WebHandler)(request, { params: Promise.resolve(params) });
      }
    }
    return next(input, init);
  };
}
