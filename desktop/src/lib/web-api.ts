import type { SupabaseClient } from "@supabase/supabase-js";
import { NOTE_MAX, acceptReason, cleanNote, isProposableReason } from "@/lib/feedback-reasons";
import { applyCloud } from "@/lib/positions/user-exclude-cloud";
import { json, notInDesktop, type ApiFetch } from "../shell/api-bridge";

/**
 * Le rotte /api del web che la desktop sa servire da sola, con la sessione
 * dell'utente (anon key + JWT, RLS): i componenti del web chiamano
 * `fetch("/api/...")` e il ponte del guscio (shell/api-bridge.ts) passa qui
 * le chiamate same-origin. Una sola tabella, `ROUTES`; tutto il resto
 * risponde 404 `not_in_desktop` (`notInDesktop` del guscio).
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
  // JHT-T05, come la rotta del web: il motivo è un codice del vocabolario
  // chiuso (un testo libero è rifiutato) e il testo dell'utente è la nota,
  // max 200 caratteri, che nessun agente legge.
  let reason: string | null = null;
  if (payload.reason !== undefined && payload.reason !== null && payload.reason !== "") {
    reason = acceptReason(payload.reason);
    if (!reason) return json({ error: "reason_invalid" }, 400);
  }
  const noteText = cleanNote(payload.note ?? payload.comment);
  if (noteText.length > NOTE_MAX) return json({ error: "note_too_long" }, 400);
  const note = noteText || null;
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
      note,
      score,
      direction,
    })
    .select("id, position_legacy_id, action, reason, score, direction, created_at")
    .single();
  if (error) return internal("positions/[legacyId]/feedback", error);
  return json({ feedback: data });
}

// ── /api/positions/feedback (in blocco) ────────────────────────────────
// web/app/api/positions/feedback/route.ts, ramo sessione: il giudizio
// dell'utente su tutte le posizioni, senza la nota (JHT-T05). RLS, più il
// filtro su user_id come la rotta.
async function getFeedbackBulk({ client, userId }: Call): Promise<Response> {
  const user = await userId();
  if (!user) return unauthorized();
  const { data, error } = await client
    .from("position_feedback")
    .select("position_legacy_id, action, reason, score, direction, created_at")
    .eq("user_id", user)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return internal("positions/feedback", error);
  return json({ feedback: data ?? [] });
}

// ── /api/profile-exclusions ────────────────────────────────────────────
// web/app/api/profile-exclusions/route.ts: la preferenza dell'utente sulle
// proposte di esclusione del profilo (mig 094). Codice, stato, data.
const PROFILE_EXCLUSION_COLUMNS = "reason, status, positions_at_decision, decided_at";

async function getProfileExclusions({ client, userId }: Call): Promise<Response> {
  const user = await userId();
  if (!user) return unauthorized();
  const { data, error } = await client
    .from("profile_exclusions")
    .select(PROFILE_EXCLUSION_COLUMNS)
    .eq("user_id", user);
  if (error) return internal("profile-exclusions", error);
  return json({ exclusions: data ?? [] });
}

async function postProfileExclusion({ client, body, userId }: Call): Promise<Response> {
  const user = await userId();
  if (!user) return unauthorized();
  const payload = await body();
  if (!payload) return json({ error: "invalid_json" }, 400);
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  if (!isProposableReason(reason)) return json({ error: "reason_invalid" }, 400);
  if (payload.status !== "accepted" && payload.status !== "dismissed") {
    return json({ error: "status_invalid" }, 400);
  }
  const positions =
    typeof payload.positions === "number" &&
    Number.isInteger(payload.positions) &&
    payload.positions >= 0 &&
    payload.positions <= 100_000
      ? payload.positions
      : 0;
  const { data, error } = await client
    .from("profile_exclusions")
    .upsert(
      {
        user_id: user,
        reason,
        status: payload.status,
        positions_at_decision: positions,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "user_id,reason" },
    )
    .select(PROFILE_EXCLUSION_COLUMNS)
    .single();
  if (error) return internal("profile-exclusions", error);
  return json({ exclusion: data });
}

async function getFeedback({ client, params, userId }: Call): Promise<Response> {
  const user = await userId();
  if (!user) return unauthorized();
  const { data, error } = await client
    .from("position_feedback")
    .select("id, position_legacy_id, action, reason, score, direction, created_at")
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
// Le cause sono il vocabolario chiuso `shared/feedback-reasons.json`, lo stesso
// della rotta (JHT-T05): una sola fonte, un codice del vecchio elenco vale `other`.
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
    const accepted = acceptReason(payload.reason);
    if (!accepted) return json({ error: "reason_invalid" }, 400);
    reason = accepted;
    const text = cleanNote(payload.note);
    if (text.length > NOTE_MAX) return json({ error: "note_too_long" }, 400);
    note = text || undefined;
  }
  const user = await call.userId();
  if (!user) return unauthorized();
  const result = await applyCloud(call.client, user, legacyId, action, reason, note);
  if (!result.ok) return json(result.body, result.status);
  return json({ ...result.outcome, source: "cloud", cloud_synced: true });
}

const ROUTES: Route[] = [
  { method: "GET", path: /^\/api\/positions\/(\d+)\/summary$/, handle: getSummary },
  { method: "GET", path: /^\/api\/positions\/feedback$/, handle: getFeedbackBulk },
  { method: "GET", path: /^\/api\/profile-exclusions$/, handle: getProfileExclusions },
  { method: "POST", path: /^\/api\/profile-exclusions$/, handle: postProfileExclusion },
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
