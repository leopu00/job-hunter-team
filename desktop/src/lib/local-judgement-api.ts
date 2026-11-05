import { invoke, isTauri } from "@tauri-apps/api/core";
import { apiPath, json, type ApiFetch } from "../shell/api-bridge";
import { localPositionToken, localPositionTokenIsDeck } from "./local-swipe";
import { localTeamData, localTeamShowsSavedData } from "./local-team-data";

/**
 * What the person does on a position, when the profile shows the team of this computer (no cloud account):
 * the routes of the position page and of the Swipe's card are answered by a native command, which writes in
 * the team's database through the team's own script (src-tauri/src/local_swipe.rs). The Swipe's three routes
 * (verdict, exclude, put back) go to `local_team_position_judge` when the position was read in the deck; every
 * route goes to `local_team_position_act` with the token of the position's own detail read.
 *
 *   POST   /api/positions/<n>/feedback        like, dislike, hide, star, clear (score, direction, reason, note)
 *   POST   /api/positions/<n>/user-exclude    exclude with a reason (and a note); DELETE puts it back
 *   POST   /api/positions/<n>/user-note       the private note; DELETE clears it
 *   POST   /api/positions/<n>/mark-applied    «I applied myself»; DELETE takes it back
 *   POST   /api/positions/<n>/outcome         interview / rejected (+ why); DELETE takes it back
 *   POST   /api/positions/<n>/recheck-request, geocode-request   ask the team; DELETE withdraws
 *   POST   /api/positions/<n>/write-request   the CV or the cover letter (`kind`); DELETE withdraws
 *   POST   /api/positions/<n>/ticket          a rescore (`kind: "rescore"`) or a free request (`request_text`)
 *
 *   POST   /api/positions/<n>/apply-request  no body: the preview of an authorisation (summary, destination, digest);
 *                                              {confirmId, destination}: the authorisation, on the person's click, carrying
 *                                              back the digest and the destination the preview showed
 *   DELETE /api/positions/<n>/apply-request  withdraws the authorisation
 *
 * It never falls through to the cloud: in this mode a call of these routes is answered here, with the code
 * of its refusal, whatever the native side says. Every other route stays refused by the bridge.
 */
const JUDGE = "local_team_position_judge";
const ACT = "local_team_position_act";

type Body = Record<string, unknown>;
type Op =
  | "feedback" | "exclude" | "restore" | "user_note" | "mark_applied" | "outcome"
  | "recheck" | "geocode" | "write_request" | "ticket" | "outcome_undo" | "apply_preview" | "apply_request";
type NativeRequest = { op: Op; id: string } & Body;
type Build = (id: string, body: Body) => NativeRequest | Response;
/** What the page reads back from the route, from the closed answer of the native side. */
type Shape = (request: NativeRequest, reply: Body) => Body;

const invalid = (error: string) => json({ error }, 400);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const FEEDBACK_ACTIONS = new Set(["like", "dislike", "hide", "star", "clear"]);
const DIRECTIONS = new Set(["more_like_this", "less_like_this"]);

const WRITE_KINDS = new Set(["cv", "cover_letter"]);
/** The ops the Swipe's command knows. */
const JUDGE_OPS = new Set<Op>(["feedback", "exclude", "restore"]);
const DECLARABLE = new Set(["interview", "rejected"]);

const ROUTES: Array<{ method: string; path: RegExp; build: Build; shape?: Shape }> = [
  {
    method: "POST",
    path: /^\/api\/positions\/(\d+)\/feedback$/,
    build: (id, body) => {
      const action = body.action;
      if (typeof action !== "string" || !FEEDBACK_ACTIONS.has(action)) return invalid("action_invalid");
      const request: NativeRequest = { op: "feedback", id, value: action };
      if (body.score !== undefined && body.score !== null) {
        if (typeof body.score !== "number" || !Number.isInteger(body.score) || body.score < 1 || body.score > 5) return invalid("score_invalid");
        request.score = body.score;
      }
      if (body.direction !== undefined && body.direction !== null) {
        if (typeof body.direction !== "string" || !DIRECTIONS.has(body.direction)) return invalid("direction_invalid");
        request.direction = body.direction;
      }
      const reason = text(body.reason);
      if (reason) request.reason = reason;
      const note = text(body.note ?? body.comment);
      if (note) request.note = note;
      return request;
    },
  },
  {
    method: "POST",
    path: /^\/api\/positions\/(\d+)\/user-exclude$/,
    build: (id, body) => {
      const reason = text(body.reason);
      if (!reason) return invalid("reason_required");
      const note = text(body.note);
      return { op: "exclude", id, reason, ...(note ? { note } : {}) };
    },
  },
  { method: "DELETE", path: /^\/api\/positions\/(\d+)\/user-exclude$/, build: (id) => ({ op: "restore", id }) },
];

const toggle = (method: string) => method === "POST";
const ownStamp = (reply: Body, key: string) => (typeof reply[key] === "string" ? (reply[key] as string) : null);

const both = (path: RegExp, build: (id: string, body: Body, on: boolean) => NativeRequest | Response, shape?: Shape) =>
  (["POST", "DELETE"] as const).map((method) => ({
    method: method as string,
    path,
    build: (id: string, body: Body) => build(id, body, toggle(method)),
    shape,
  }));

const DIGEST = /^[0-9a-f]{64}$/;
const DESTINATION = /^((web|email):[a-z0-9.-]{3,253}|portal:[a-z]{2,20})$/;

const MORE_ROUTES: Array<{ method: string; path: RegExp; build: Build; shape?: Shape }> = [
  {
    method: "POST",
    path: /^\/api\/positions\/(\d+)\/user-note$/,
    build: (id, body) => {
      const note = typeof body.note === "string" ? body.note.trim() : "";
      return note ? { op: "user_note", id, body: note } : invalid("note_empty");
    },
    shape: (request) => ({ id: request.id, note: request.body, source: "local" }),
  },
  {
    method: "DELETE",
    path: /^\/api\/positions\/(\d+)\/user-note$/,
    build: (id) => ({ op: "user_note", id, body: null }),
    shape: (request) => ({ id: request.id, note: null, source: "local" }),
  },
  ...both(
    /^\/api\/positions\/(\d+)\/mark-applied$/,
    (id, _body, on) => ({ op: "mark_applied", id, on }),
    // The database of the team on this computer is the only copy: there is no cloud mirror to wait for.
    (request, reply) => ({ ok: true, id: request.id, applied_at: request.on === true ? ownStamp(reply, "applied_at") : null, source: "local", cloud_synced: null }),
  ),
  {
    method: "POST",
    path: /^\/api\/positions\/(\d+)\/outcome$/,
    build: (id, body) => {
      const value = body.outcome;
      if (typeof value !== "string" || !DECLARABLE.has(value)) return invalid("outcome_invalid");
      const request: NativeRequest = { op: "outcome", id, value };
      if (value === "rejected") {
        const reason = text(body.rejection_reason);
        const note = text(body.rejection_note);
        if (reason) request.rejection_reason = reason;
        if (note) request.rejection_note = note;
      }
      return request;
    },
    shape: (request, reply) => ({ ok: true, id: request.id, response: typeof reply.response === "string" ? reply.response : request.value, source: "local", cloud_synced: null }),
  },
  {
    method: "DELETE",
    path: /^\/api\/positions\/(\d+)\/outcome$/,
    build: (id) => ({ op: "outcome_undo", id }),
    shape: (request) => ({ ok: true, id: request.id, response: null, source: "local", cloud_synced: null }),
  },
  ...both(/^\/api\/positions\/(\d+)\/recheck-request$/, (id, _body, on) => ({ op: "recheck", id, on }), (request) => ({
    id: request.id,
    recheck_requested: request.on === true,
    source: "local",
  })),
  ...both(/^\/api\/positions\/(\d+)\/geocode-request$/, (id, _body, on) => ({ op: "geocode", id, on }), (request) => ({
    position: { id: request.id, geocode_requested: request.on === true },
    source: "local",
  })),
  ...both(
    /^\/api\/positions\/(\d+)\/write-request$/,
    (id, body, on) => {
      const kind = body.kind ?? "cv";
      return typeof kind === "string" && WRITE_KINDS.has(kind) ? { op: "write_request", id, on, kind } : invalid("request_kind_invalid");
    },
    (request) => ({
      position: { id: request.id, write_requested: request.on === true, write_request_kind: request.on === true ? request.kind : null },
      source: "local",
    }),
  ),
  {
    // No body = the first step (nothing is authorised); a confirmation = the second, which carries the digest AND the
    // destination of the preview back, so the host knows the person saw where it goes.
    method: "POST",
    path: /^\/api\/positions\/(\d+)\/apply-request$/,
    build: (id, body) => {
      if (body.confirmId === undefined && body.destination === undefined) return { op: "apply_preview", id };
      const { confirmId, destination } = body;
      if (typeof confirmId !== "string" || !DIGEST.test(confirmId) || typeof destination !== "string" || !DESTINATION.test(destination)) {
        return invalid("confirmation_required");
      }
      return { op: "apply_request", id, on: true, confirmed: true, confirm: confirmId, destination };
    },
    shape: (request, reply) =>
      request.op === "apply_preview"
        ? {
            ok: true,
            state: "awaiting_confirm",
            id: reply.confirm,
            summary: reply.summary,
            destination: reply.destination,
            expiresAt: null,
            source: "local",
          }
        : // only what the host confirmed counts: a reply without the flag is not an authorisation
          { ok: true, state: reply.apply_requested === true ? "queued" : "not_authorised", apply_requested: reply.apply_requested === true, source: "local" },
  },
  {
    method: "DELETE",
    path: /^\/api\/positions\/(\d+)\/apply-request$/,
    build: (id) => ({ op: "apply_request", id, on: false }),
    shape: (_request, reply) => ({ ok: true, state: reply.apply_requested === false ? "done" : "not_withdrawn", apply_requested: reply.apply_requested !== false, source: "local" }),
  },
  {
    method: "POST",
    path: /^\/api\/positions\/(\d+)\/ticket$/,
    build: (id, body) => {
      const requestText = text(body.request_text);
      if (!requestText) return invalid("request_text_required");
      if (body.attachment !== undefined && body.attachment !== null) return invalid("attachment_not_supported");
      return { op: "ticket", id, kind: body.kind === "rescore" ? "rescore" : "free", text: requestText };
    },
    shape: (request, reply) => ({
      id: reply.ticket_id ?? null,
      status: typeof reply.ticket_status === "string" ? reply.ticket_status : "open",
      ...(reply.deduplicated === true ? { deduplicated: true } : {}),
      kind: request.kind,
      source: "local",
    }),
  },
];
ROUTES.push(...MORE_ROUTES);

function statusOf(code: string): number {
  if (code === "position_not_found") return 404;
  if (["position_write_read_only", "position_write_window_refused", "account_scope_unavailable", "account_scope_changed"].includes(code)) return 403;
  if (
    [
      "position_write_request_invalid", "position_write_not_confirmed", "reason_invalid", "note_too_long", "note_invalid", "note_empty",
      "outcome_invalid", "request_kind_invalid", "request_text_required", "attachment_not_supported", "confirmation_required",
    ].includes(code)
  ) {
    return 400;
  }
  if (["existing_team_unavailable", "existing_team_runtime_outdated", "local_team_not_running"].includes(code)) return 503;
  return 409;
}

function safeCode(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "existing_team_unavailable";
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<Body | null> {
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
  if (raw === null || raw === undefined || raw === "") return {};
  // A free request is sent as a form (its text and an optional file): only the text is kept, a file is flagged.
  if (typeof FormData !== "undefined" && raw instanceof FormData) {
    const form: Body = {};
    for (const [key, value] of raw.entries()) form[key] = typeof value === "string" ? value : "[file]";
    return form;
  }
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Body) : null;
  } catch {
    return null;
  }
}

export interface LocalJudgementNative {
  /** The Swipe's command, with the token of the deck. */
  write(request: NativeRequest & { token: string }): Promise<unknown>;
  /** The position page's command, with the token of the position's own read (or the deck's). */
  act?(request: NativeRequest & { token: string }): Promise<unknown>;
}

export const localJudgementNative: LocalJudgementNative = {
  write: (request) => invoke<unknown>(JUDGE, { request }),
  act: (request) => invoke<unknown>(ACT, { request }),
};

export function localJudgementApi(
  next: ApiFetch,
  native: LocalJudgementNative = localJudgementNative,
  inDesktop: () => boolean = isTauri,
): ApiFetch {
  return async (input, init) => {
    if (!localTeamData()) return next(input, init);
    const path = apiPath(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const route = path ? ROUTES.find((r) => r.method === method && r.path.test(path)) : undefined;
    if (!route || !path) return next(input, init);
    // From here a call of one of these routes is answered here and nowhere else: not the cloud, not the VPS.
    if (!inDesktop()) return json({ error: "position_write_read_only" }, 403);
    const body = await readBody(input, init);
    if (body === null) return invalid("invalid_json");
    const built = route.build(route.path.exec(path)![1]!, body);
    if (built instanceof Response) return built;
    // The pages show what the team saved while it is off: nothing is written to it from them, and the sentence says why.
    if (localTeamShowsSavedData()) return json({ error: "local_team_not_running" }, 503);
    const token = localPositionToken(built.id);
    if (!token) return json({ error: "deck_outdated" }, 409);
    // The Swipe's three ops on a card of the deck keep their command; everything else is the page's.
    const useJudge = JUDGE_OPS.has(built.op) && localPositionTokenIsDeck(built.id);
    let reply: Body;
    try {
      const send = useJudge || !native.act ? native.write : native.act;
      const answered = await send({ ...built, token });
      reply = answered && typeof answered === "object" && !Array.isArray(answered) ? (answered as Body) : {};
    } catch {
      return json({ error: "existing_team_unavailable" }, 503);
    }
    if (reply.ok !== true) {
      const code = safeCode(reply.error);
      return json({ error: code }, statusOf(code));
    }
    if (route.shape) return json(route.shape(built, reply));
    const id = built.id;
    if (built.op === "feedback") return json({ ok: true, legacy_id: id, action: built.value, source: "local" });
    const status = typeof reply.status === "string" ? reply.status : null;
    return json({ ok: true, id, status, source: "local" });
  };
}
