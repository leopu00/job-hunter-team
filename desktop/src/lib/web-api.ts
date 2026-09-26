import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCloud } from "@/lib/positions/user-exclude-cloud";
import { json, notInDesktop, type ApiFetch } from "../shell/api-bridge";

/**
 * Le rotte /api del web che la desktop sa servire da sola, con la sessione
 * dell'utente (anon key + JWT, RLS): i componenti del web chiamano
 * `fetch("/api/...")` e il ponte del guscio (shell/api-bridge.ts) passa qui
 * le chiamate same-origin. Una sola tabella, `ROUTES`; tutto il resto
 * risponde 404 `not_in_desktop` (`notInDesktop` del guscio; le rotte non portabili sono in
 * banda/piani/D02-azioni-da-decidere.md).
 *
 * Ogni voce riproduce il ramo di SESSIONE della rotta del web, con gli
 * stessi controlli e la stessa forma di risposta. Niente service_role: se
 * una rotta ne ha bisogno, qui non entra.
 */

interface Call {
  client: SupabaseClient;
  method: string;
  params: string[];
  body: () => Promise<Record<string, unknown> | null>;
  userId: () => Promise<string | null>;
}

interface Route {
  method: string;
  path: RegExp;
  handle: (call: Call) => Promise<Response>;
}

/** Come `sanitizedError` del web: il dettaglio in console, fuori un codice. */
function internal(scope: string, error: { message?: string } | null) {
  console.error(`[${scope}] 500 ${error?.message ?? ""}`);
  return json({ error: "internal" }, 500);
}

const unauthorized = () => json({ error: "unauthorized" }, 401);

// ── /api/positions/[legacyId]/feedback ─────────────────────────────────
// web/app/api/positions/[legacyId]/feedback/route.ts, ramo sessione.
const FEEDBACK_ACTIONS = ["like", "dislike", "hide", "star", "clear"];
const FEEDBACK_DIRECTIONS = ["more_like_this", "less_like_this"];

async function postFeedback({ client, params, body, userId }: Call): Promise<Response> {
  const user = await userId();
  if (!user) return unauthorized();
  const [legacyId] = params;
  const payload = await body();
  if (!payload) return json({ error: "invalid_json" }, 400);

  const action = typeof payload.action === "string" ? payload.action : null;
  if (!action || !FEEDBACK_ACTIONS.includes(action)) {
    return json(
      { error: `action invalida (deve essere uno di: ${FEEDBACK_ACTIONS.join(", ")})` },
      400,
    );
  }
  const reason =
    typeof payload.reason === "string" && payload.reason.length <= 500 ? payload.reason : null;
  const comment =
    typeof payload.comment === "string" && payload.comment.length <= 2000 ? payload.comment : null;
  let score: number | null = null;
  if (typeof payload.score === "number" && Number.isInteger(payload.score)) {
    if (payload.score < 1 || payload.score > 5) {
      return json({ error: "score deve essere intero 1-5" }, 400);
    }
    score = payload.score;
  }
  let direction: string | null = null;
  if (typeof payload.direction === "string") {
    if (!FEEDBACK_DIRECTIONS.includes(payload.direction)) {
      return json({ error: `direction invalida (${FEEDBACK_DIRECTIONS.join(", ")})` }, 400);
    }
    direction = payload.direction;
  }

  const { data, error } = await client
    .from("position_feedback")
    .insert({
      user_id: user,
      position_legacy_id: legacyId,
      action,
      reason,
      comment,
      score,
      direction,
    })
    .select()
    .single();
  if (error) return internal("positions/[legacyId]/feedback", error);
  return json({ feedback: data });
}

async function getFeedback({ client, params, userId }: Call): Promise<Response> {
  const user = await userId();
  if (!user) return unauthorized();
  const { data, error } = await client
    .from("position_feedback")
    .select("*")
    .eq("user_id", user)
    .eq("position_legacy_id", params[0])
    .order("created_at", { ascending: false });
  if (error) return internal("positions/[legacyId]/feedback", error);
  return json({ feedback: data ?? [] });
}

// ── /api/positions/[legacyId]/summary ──────────────────────────────────
// web/app/api/positions/[legacyId]/summary/route.ts: RLS, niente filtro a mano.
async function getSummary({ client, params }: Call): Promise<Response> {
  const id = Number(params[0]);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "legacyId invalido" }, 400);
  const { data, error } = await client
    .from("positions")
    .select("jd_summary, jd_text")
    .eq("legacy_id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return internal("positions/[legacyId]/summary", error);
  const row = data as { jd_summary: string | null; jd_text: string | null } | null;
  const summary =
    row?.jd_summary ??
    (row?.jd_text ? row.jd_text.replace(/\r\n/g, "\n").trim().slice(0, 1500) : null);
  return json({ summary });
}

// ── /api/positions/[legacyId]/user-exclude ─────────────────────────────
// web/app/api/positions/[legacyId]/user-exclude/route.ts: il ramo cloud
// (box spento, Supabase unica sorgente), che è anche l'unico della desktop.
// Le cause sono quelle di VALID_REASONS della rotta (un test le confronta).
export const EXCLUDE_REASONS = [
  "closed",
  "not_interested",
  "mismatch",
  "already_applied",
  "company",
  "conditions",
  "other",
];

async function userExclude(call: Call): Promise<Response> {
  const legacyId = Number.parseInt(call.params[0], 10);
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return json({ error: "legacyId non valido" }, 400);
  }
  const action = call.method === "DELETE" ? "unexclude" : "exclude";
  let reason: string | undefined;
  let note: string | undefined;
  if (action === "exclude") {
    const payload = (await call.body()) ?? {};
    reason = typeof payload.reason === "string" ? payload.reason : undefined;
    note = typeof payload.note === "string" ? payload.note.trim().slice(0, 500) : undefined;
    if (!reason || !EXCLUDE_REASONS.includes(reason)) {
      return json({ error: `Causa non valida: '${reason ?? ""}'` }, 400);
    }
    if (reason === "other" && !note) {
      return json({ error: "Per 'Altro' serve un testo che spieghi la causa" }, 400);
    }
  }
  const user = await call.userId();
  if (!user) return unauthorized();
  const result = await applyCloud(call.client, user, legacyId, action, reason, note);
  if (!result.ok) return json(result.body, result.status);
  return json({ ...result.outcome, source: "cloud", cloud_synced: true });
}

const ROUTES: Route[] = [
  { method: "GET", path: /^\/api\/positions\/(\d+)\/summary$/, handle: getSummary },
  { method: "GET", path: /^\/api\/positions\/(\d+)\/feedback$/, handle: getFeedback },
  { method: "POST", path: /^\/api\/positions\/(\d+)\/feedback$/, handle: postFeedback },
  { method: "POST", path: /^\/api\/positions\/(\d+)\/user-exclude$/, handle: userExclude },
  { method: "DELETE", path: /^\/api\/positions\/(\d+)\/user-exclude$/, handle: userExclude },
];

function requestParts(input: RequestInfo | URL, init?: RequestInit) {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), "http://desktop.invalid");
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const rawBody = async (): Promise<string | null> => {
    if (typeof init?.body === "string") return init.body;
    if (request) return request.text();
    return null;
  };
  return { url, method, rawBody };
}

export function createWebApiFetch(client: SupabaseClient): ApiFetch {
  return async (input, init) => {
    const { url, method, rawBody } = requestParts(input, init);
    for (const route of ROUTES) {
      if (route.method !== method) continue;
      const match = route.path.exec(url.pathname);
      if (!match) continue;
      const call: Call = {
        client,
        method,
        params: match.slice(1),
        body: async () => {
          const raw = await rawBody();
          if (raw == null || raw === "") return null;
          try {
            const parsed: unknown = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : null;
          } catch {
            return null;
          }
        },
        // La sessione salvata basta: l'identità vera la verifica la RLS.
        userId: async () => (await client.auth.getSession()).data.session?.user.id ?? null,
      };
      try {
        return await route.handle(call);
      } catch (error) {
        return internal(url.pathname, error as { message?: string });
      }
    }
    return notInDesktop(input, init);
  };
}
