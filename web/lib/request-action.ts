import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/workspace";
import { requiresPublicOrigin } from "@/lib/deploy-mode";
import { shouldRejectBrowserMutation, strictMutationRefusal } from "@/lib/csrf";
import { DATABASE_REFUSALS } from "@/lib/request-action-codes";

export { DATABASE_REFUSALS };

/**
 * La porta unica delle azioni che il sito fa per conto dell'utente (JHT «web capace», fase 2-b).
 *
 * Una route L1/L2/L3 chiama SOLO questa funzione, prima di toccare corpo, database, processi o file:
 *
 *   export async function POST(req: NextRequest) {
 *     return requestAction(req, { action: "team.restart", level: "L2" });
 *   }
 *
 * Cosa fa QUI (il confine dell'ingresso):
 *   - P1: controllo d'origine stretto per L2/L3 (`strictMutationRefusal`), solo POST, corpo JSON;
 *   - la forma del corpo: un oggetto con al più `params` (prima chiamata) o `confirmId` (seconda),
 *     mai tutti e due, con tetti di dimensione e di profondità;
 *   - l'utente: la sessione dei cookie; senza, 401;
 *   - UNA chiamata a `request_action` nel database, col JWT dell'utente.
 *
 * Cosa NON fa, di proposito (è del database, `request_action`, contratto in
 * banda/piani/CONTRATTO-request-action-2a-2b): decidere chi è l'utente e la sessione, se la sessione
 * è recente, i limiti, il vocabolario delle azioni, i parametri ammessi, il testo della conferma, la
 * scadenza, l'uso unico e il legame alla sessione (la conferma a due tempi, P5/W3), il registro, e
 * l'effetto. Il client non fornisce mai utente, sessione, istante, livello, testo o stato: la
 * libreria inoltra l'azione fissata dalla route e i parametri, e mostra ciò che il database risponde.
 *
 * Non scrive tabelle (solo `rpc`): un test lo fissa sul sorgente.
 */

export type ActionLevel = "L1" | "L2" | "L3";
export interface ActionSpec {
  /** Fissata dalla route, mai dal client. Il vocabolario chiuso è nel database. */
  action: string;
  /** Il livello che la route dichiara; se il database ne risponde uno più alto, non passa niente. */
  level: ActionLevel;
  /**
   * I parametri che la ROUTE conosce dall'indirizzo (l'id della posizione): sono suoi, non del corpo.
   * Se ci sono, il corpo non può portarne altri (`params` vuoto o assente) e la prima chiamata usa
   * questi. Alla conferma non servono: il database ha quelli salvati.
   */
  params?: Record<string, unknown>;
  /**
   * Il metodo HTTP che la route accetta per questa azione; di base POST. Una route che ritira con DELETE
   * lo dice qui: il resto dei controlli d'origine vale come per un POST.
   */
  method?: "POST" | "DELETE";
  /**
   * L'azione accetta un testo libero (una nota, una direttiva): il corpo può portare `body`, una stringa
   * con questo tetto di caratteri (di base 2000), che alla prima chiamata va al database come `p_body`.
   * Senza questa voce il corpo che porta `body` è rifiutato, e `p_body` non viene mai passato. Il testo lo
   * pulisce, lo taglia e lo recinta il database: la libreria lo inoltra com'è.
   */
  body?: boolean | { max: number };
  /**
   * TEMPORARY, only for the emergency stop: what to do when the database has no door yet (the web is
   * deployed before migration 098 is applied). Called ONLY when the call fails because the function
   * does not exist (PostgREST PGRST202, PostgreSQL 42883), never on any other error. To be removed once
   * 098 is applied and verified on the cloud.
   */
  whenDoorMissing?: (ctx: {
    supabase: Awaited<ReturnType<typeof createClient>>;
    userId: string;
  }) => Promise<NextResponse>;
}

/** The call failed because request_action does not exist in the database (not applied yet). */
export function isMissingDoor(error: unknown): boolean {
  const code =
    error && typeof error === "object"
      ? (error as Record<string, unknown>).code
      : undefined;
  return code === "PGRST202" || code === "42883";
}

const LEVEL_RANK: Record<ActionLevel, number> = { L1: 1, L2: 2, L3: 3 };
const MAX_BODY_BYTES = 8 * 1024;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;
const MAX_STRING = 4000;
const MAX_SUMMARY = 400;
const DEFAULT_BODY_TEXT = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_NAME = /^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,31})?$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** I rifiuti dell'ingresso (prima del database) e la risposta HTTP di ciascuno. */
const ENTRY_REFUSALS = {
  method_not_allowed: 405,
  cross_site: 403,
  origin_required: 403,
  origin_not_allowed: 403,
  origin_not_configured: 503,
  unsupported_media_type: 415,
  payload_too_large: 413,
  invalid_request: 400,
  unavailable: 503,
  unauthenticated: 401,
  action_failed: 502,
  level_mismatch: 500,
} as const;
type EntryRefusal = keyof typeof ENTRY_REFUSALS;

function reply(
  status: number,
  body: Record<string, unknown>,
  extra?: Record<string, string>,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(extra ?? {}) },
  });
}

function refuse(code: EntryRefusal): NextResponse {
  return reply(ENTRY_REFUSALS[code], { ok: false, error: code });
}

function hostOriginOf(req: NextRequest): string | null {
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    req.nextUrl.protocol.replace(":", "");
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host")?.trim();
  return host ? `${proto}://${host}` : null;
}

/** Un valore JSON dentro i tetti: nient'altro che oggetti semplici, liste, stringhe, numeri, booleani, null. */
export function isBoundedJson(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_STRING;
  if (depth >= MAX_DEPTH) return false;
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_KEYS &&
      value.every((item) => isBoundedJson(item, depth + 1))
    );
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    if (keys.length > MAX_KEYS) return false;
    return keys.every(
      (key) =>
        !FORBIDDEN_KEYS.has(key) &&
        key.length <= 64 &&
        isBoundedJson((value as Record<string, unknown>)[key], depth + 1),
    );
  }
  return false;
}

interface ParsedBody {
  params: Record<string, unknown>;
  confirmId: string | null;
  /** Il testo libero del corpo (`body`), solo alla prima chiamata. */
  text: string | null;
}

/** La forma del corpo: `{params?, body?}` oppure `{confirmId}`, mai altro, mai la conferma con il resto. */
export function parseBody(text: string): ParsedBody | null {
  let raw: unknown;
  try {
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== "params" && key !== "confirmId" && key !== "body") return null;
  }
  const hasParams = Object.prototype.hasOwnProperty.call(body, "params");
  const hasConfirm = Object.prototype.hasOwnProperty.call(body, "confirmId");
  const hasText = Object.prototype.hasOwnProperty.call(body, "body");
  if (hasConfirm && (hasParams || hasText)) return null;
  if (hasConfirm) {
    const id = body.confirmId;
    return typeof id === "string" && UUID.test(id)
      ? { params: {}, confirmId: id.toLowerCase(), text: null }
      : null;
  }
  if (hasText && typeof body.body !== "string") return null;
  const params = hasParams ? body.params : {};
  if (params === null || typeof params !== "object" || Array.isArray(params))
    return null;
  if (!isBoundedJson(params)) return null;
  return {
    params: params as Record<string, unknown>,
    confirmId: null,
    text: hasText ? (body.body as string) : null,
  };
}

interface Success {
  state: "awaiting_confirm" | "queued" | "done";
  id: string;
  level: ActionLevel;
  summary: string;
  expires_at: string | null;
  command_id: string | null;
}

/** La risposta del database, riconosciuta o scartata: solo questi campi escono verso il client. */
function readSuccess(data: unknown, confirming: boolean): Success | null {
  if (data === null || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.ok !== true) return null;
  if (
    d.state !== "awaiting_confirm" &&
    d.state !== "queued" &&
    d.state !== "done"
  )
    return null;
  if (confirming && d.state === "awaiting_confirm") return null; // la seconda chiamata non può chiedere un'altra conferma
  if (typeof d.id !== "string" || !UUID.test(d.id)) return null;
  if (d.level !== "L1" && d.level !== "L2" && d.level !== "L3") return null;
  const summary = typeof d.summary === "string" ? d.summary : "";
  if (summary.length > MAX_SUMMARY) return null;
  if (d.state === "awaiting_confirm") {
    if (summary.trim() === "") return null;
    if (
      typeof d.expires_at !== "string" ||
      Number.isNaN(Date.parse(d.expires_at))
    )
      return null;
  }
  const expires =
    typeof d.expires_at === "string" && !Number.isNaN(Date.parse(d.expires_at))
      ? d.expires_at
      : null;
  // Lo stato del comando di squadra (pending → running → done): solo se è un uuid, altrimenti non esce.
  const commandId =
    typeof d.command_id === "string" && UUID.test(d.command_id)
      ? d.command_id.toLowerCase()
      : null;
  return {
    state: d.state,
    id: d.id.toLowerCase(),
    level: d.level,
    summary,
    expires_at: expires,
    command_id: commandId,
  };
}

export async function requestAction(
  req: NextRequest,
  spec: ActionSpec,
): Promise<NextResponse> {
  if (
    !ACTION_NAME.test(spec.action) ||
    !Object.prototype.hasOwnProperty.call(LEVEL_RANK, spec.level)
  ) {
    // Un errore di chi scrive la route, non dell'utente: non si va avanti con un nome che il database rifiuterebbe.
    return refuse("action_failed");
  }

  // 1. L'ingresso: l'origine prima di tutto, poi il resto. Niente di quanto segue vede una richiesta rifiutata.
  const contentType = req.headers.get("content-type");
  if (req.method.toUpperCase() !== (spec.method ?? "POST")) {
    return refuse("method_not_allowed");
  }
  if (spec.level === "L1") {
    const lenient = shouldRejectBrowserMutation({
      method: req.method,
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      hostOrigin: hostOriginOf(req),
    });
    if (lenient) return refuse("origin_not_allowed");
    if (
      (contentType ?? "").split(";")[0].trim().toLowerCase() !==
      "application/json"
    ) {
      return refuse("unsupported_media_type");
    }
  } else {
    const refusal = strictMutationRefusal({
      method: "POST", // la regola stretta è quella del POST, anche per la route che ritira con DELETE
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      hostOrigin: hostOriginOf(req),
      contentType,
      requirePublicOrigin: requiresPublicOrigin(),
    });
    if (refusal) return refuse(refusal);
  }

  // 2. Il corpo: tetto prima di leggerlo, forma poi.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return refuse("payload_too_large");
  let text: string;
  try {
    text = await req.text();
  } catch {
    return refuse("invalid_request");
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
    return refuse("payload_too_large");
  const body = parseBody(text);
  if (!body) return refuse("invalid_request");
  if (spec.params !== undefined) {
    if (!isBoundedJson(spec.params)) return refuse("action_failed");
    // Le chiavi della route vincono: il corpo può aggiungerne di sue, mai ripetere quelle della route.
    const repeated = Object.keys(spec.params).some((key) =>
      Object.prototype.hasOwnProperty.call(body.params, key),
    );
    if (repeated) return refuse("invalid_request");
    if (body.confirmId === null) {
      body.params = { ...body.params, ...spec.params };
    }
  }
  // Il testo libero: solo se la route lo dichiara, entro il suo tetto.
  let bodyMax: number | null = null;
  if (spec.body) {
    bodyMax = spec.body === true ? DEFAULT_BODY_TEXT : spec.body.max;
    if (!Number.isInteger(bodyMax) || bodyMax < 1 || bodyMax > MAX_BODY_BYTES) {
      return refuse("action_failed");
    }
  }
  if (body.text !== null && (bodyMax === null || body.text.length > bodyMax)) {
    return refuse("invalid_request");
  }

  // 3. L'utente: la sessione dei cookie. Chi decide se è RECENTE, e di chi è, è il database.
  if (!isSupabaseConfigured) return refuse("unavailable");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return refuse("unauthenticated");

  // 4. La chiamata. Gli unici argomenti: l'azione (della route), i parametri o l'id di conferma.
  let result: { data: unknown; error: unknown };
  try {
    result = await supabase.rpc("request_action", {
      p_action: spec.action,
      p_params: body.params,
      p_confirm_id: body.confirmId,
      // Il livello che la route dichiara: il database lo confronta col suo PRIMA di scrivere l'effetto.
      p_route_level: spec.level,
      // Il testo libero va solo alla prima chiamata, e solo se la route lo accetta: alla conferma il
      // database ha già quello salvato.
      ...(bodyMax !== null && body.confirmId === null
        ? { p_body: body.text }
        : {}),
    });
  } catch {
    return refuse("action_failed");
  }
  if (result.error) {
    if (spec.whenDoorMissing && isMissingDoor(result.error))
      return spec.whenDoorMissing({ supabase, userId: user.id });
    return refuse("action_failed"); // mai il testo dell'errore del database
  }

  const data = result.data as Record<string, unknown> | null;
  if (data && typeof data === "object" && data.ok === false) {
    const code = typeof data.error === "string" ? data.error : "";
    const status = Object.prototype.hasOwnProperty.call(DATABASE_REFUSALS, code)
      ? DATABASE_REFUSALS[code]
      : null;
    if (status === null) return refuse("action_failed");
    const retry = Number(data.retry_after_s);
    const extra =
      code === "rate_limited" &&
      Number.isInteger(retry) &&
      retry > 0 &&
      retry <= 86400
        ? { "Retry-After": String(retry) }
        : undefined;
    return reply(status, { ok: false, error: code }, extra);
  }

  const success = readSuccess(data, body.confirmId !== null);
  if (!success) return refuse("action_failed");
  if (LEVEL_RANK[success.level] > LEVEL_RANK[spec.level])
    return refuse("level_mismatch");

  return reply(200, {
    ok: true,
    state: success.state,
    id: success.id,
    level: success.level,
    summary: success.summary,
    expiresAt: success.expires_at,
    ...(success.command_id ? { commandId: success.command_id } : {}),
  });
}
