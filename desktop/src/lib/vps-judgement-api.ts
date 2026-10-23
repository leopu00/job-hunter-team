import { invoke, isTauri } from "@tauri-apps/api/core";
import { apiPath, json, type ApiFetch } from "../shell/api-bridge";

/**
 * The person's judgement on a position, when the team is an existing one on a VPS connected in
 * full («Conferma e collega» in this run of the app): the six routes of the position page are
 * answered by the native command, which writes on the VPS through the fixed script in the pinned
 * container (src-tauri/src/existing_team_judgement.rs). Without this link they went on to the web
 * routes, which write the cloud: the team on the VPS never saw them.
 *
 *   POST   feedback          like, dislike, hide, star (score, direction), clear; reason and note
 *   POST   user-exclude      exclude with a reason (and a note); DELETE puts it back
 *   POST   user-note         the private note; DELETE clears it
 *   POST   write-request     ask for the CV or the cover letter (`kind`); DELETE withdraws it
 *   POST   apply-request     authorise the application in two steps, as the website's door does:
 *                            `{}` asks the team for the preview («title @ company · host») and its
 *                            digest; `{confirmId}` carries that digest back and authorises exactly
 *                            what was shown (the native side then records it in the team's broker,
 *                            which the CLOSER checks before it sends). DELETE withdraws.
 *   POST   recheck-request   ask for a new analysis; DELETE withdraws it
 *
 * Before each write the native side is asked which team this is (`..._target`, local files only):
 * the key it gives is the one the write must carry, and a team the page no longer shows is
 * refused by the native gate. With no existing team on this profile (a team on this computer, or
 * the VPS the app set up) the call goes on as before. Any other refusal is answered here, with its
 * code: a page of an existing team never falls back to writing the cloud.
 */

const TARGET = "existing_team_position_write_target";
const WRITE = "existing_team_position_write";

/** The native target says there is no existing team here: the page writes as it always did. */
const NOT_AN_EXISTING_TEAM = new Set(["existing_team_runtime_required", "existing_team_runtime_selection_required"]);

type Op = "feedback" | "exclude" | "restore" | "note" | "write_request" | "apply_request" | "apply_preview" | "recheck";
type NativeRequest = { op: Op; id: string } & Record<string, unknown>;
type Body = Record<string, unknown>;
type Build = (id: string, body: Body) => NativeRequest | Response;
type Shape = (id: string, request: NativeRequest, reply: Body) => Body;

interface Route {
  method: string;
  path: RegExp;
  build: Build;
  shape: Shape;
}

const invalid = (error: string) => json({ error }, 400);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const FEEDBACK_ACTIONS = new Set(["like", "dislike", "hide", "star", "clear"]);
const DIRECTIONS = new Set(["more_like_this", "less_like_this"]);
const WRITE_KINDS = new Set(["cv", "cover_letter"]);
/** The preview's digest (sha-256, lowercase hex), the only thing a confirmation carries. */
const DIGEST = /^[0-9a-f]{64}$/;

const ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/positions\/(\d+)\/feedback$/,
    build: (id, body) => {
      const action = body.action;
      if (typeof action !== "string" || !FEEDBACK_ACTIONS.has(action)) return invalid("action_invalid");
      const request: NativeRequest = { op: "feedback", id, value: action };
      if (body.score !== undefined && body.score !== null) {
        if (typeof body.score !== "number" || !Number.isInteger(body.score) || body.score < 1 || body.score > 5) {
          return invalid("score_invalid");
        }
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
    shape: (id, request, reply) => ({ ok: true, legacy_id: id, action: request.value, source: "vps", ...pick(reply, ["cloud_synced"]) }),
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
    shape: (id, _request, reply) => ({ ok: true, id, source: "vps", ...pick(reply, ["status", "previous_status", "reason"]) }),
  },
  {
    method: "DELETE",
    path: /^\/api\/positions\/(\d+)\/user-exclude$/,
    build: (id) => ({ op: "restore", id }),
    shape: (id, _request, reply) => ({ ok: true, id, source: "vps", ...pick(reply, ["status", "previous_status"]) }),
  },
  {
    method: "POST",
    path: /^\/api\/positions\/(\d+)\/user-note$/,
    build: (id, body) => {
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!note) return invalid("note_empty");
      return { op: "note", id, text: note };
    },
    shape: (id, request) => ({ id, note: request.text, source: "vps" }),
  },
  {
    method: "DELETE",
    path: /^\/api\/positions\/(\d+)\/user-note$/,
    build: (id) => ({ op: "note", id, text: "" }),
    shape: (id) => ({ id, note: null, source: "vps" }),
  },
  ...(["POST", "DELETE"] as const).map((method): Route => ({
    method,
    path: /^\/api\/positions\/(\d+)\/write-request$/,
    build: (id, body) => {
      const kind = body.kind ?? "cv";
      if (typeof kind !== "string" || !WRITE_KINDS.has(kind)) return invalid("request_kind_invalid");
      return { op: "write_request", id, on: method === "POST", kind };
    },
    shape: (id, request, reply) => {
      const on = reply.write_requested === true;
      return {
        position: {
          id,
          write_requested: on,
          write_request_kind: on ? (typeof reply.write_request_kind === "string" ? reply.write_request_kind : request.kind) : null,
        },
        source: "vps",
      };
    },
  })),
  ...(["POST", "DELETE"] as const).map((method): Route => ({
    method,
    path: /^\/api\/positions\/(\d+)\/apply-request$/,
    // The click that authorises is the authorisation to send. The page's dialog shows the preview
    // the team composed, and its confirmation carries the preview's digest back: an authorisation
    // without one (the old `confirmed: true`) is not asked of the VPS.
    build: (id, body) => {
      if (method === "DELETE") return { op: "apply_request", id, on: false, confirmed: false };
      if (body.confirmId === undefined && body.confirmed === undefined) return { op: "apply_preview", id };
      if (typeof body.confirmId === "string" && DIGEST.test(body.confirmId)) {
        return { op: "apply_request", id, on: true, confirmed: true, confirm: body.confirmId };
      }
      return json({ error: "position_write_not_confirmed" }, 400);
    },
    shape: (id, request, reply) => {
      if (request.op === "apply_preview") {
        const preview = typeof reply.summary === "string" && reply.summary.trim() && typeof reply.confirm === "string" && DIGEST.test(reply.confirm);
        // A preview that cannot be shown is no state the dialog reads: it says the refusal.
        return preview ? { ok: true, state: "awaiting_confirm", id: reply.confirm, summary: reply.summary, expiresAt: null, source: "vps" } : { ok: false, source: "vps" };
      }
      return { ok: true, state: "queued", id, apply_requested: request.on === true, source: "vps" };
    },
  })),
  ...(["POST", "DELETE"] as const).map((method): Route => ({
    method,
    path: /^\/api\/positions\/(\d+)\/recheck-request$/,
    build: (id) => ({ op: "recheck", id, on: method === "POST" }),
    shape: (id, request) => ({ id, recheck_requested: request.on === true, source: "vps" }),
  })),
];

function pick(reply: Body, keys: string[]): Body {
  const out: Body = {};
  for (const key of keys) if (key in reply) out[key] = reply[key];
  return out;
}

/** The status a refused judgement answers with, as the web routes would. */
function statusOf(code: string): number {
  if (code === "position_not_found") return 404;
  if (["position_write_read_only", "position_write_window_refused", "account_scope_unavailable", "account_scope_changed"].includes(code)) return 403;
  if (
    ["position_write_request_invalid", "position_write_not_confirmed", "reason_invalid", "note_too_long", "note_invalid", "request_kind_invalid", "confirmation_required"].includes(code)
  ) {
    return 400;
  }
  if (["ssh_unavailable", "existing_team_unavailable", "existing_team_runtime_outdated", "existing_team_runtime_changed"].includes(code)) return 503;
  if (code === "existing_team_runtime_target_changed") return 409;
  // The script's refusals of the position itself: its state (already sent, not ready, …).
  return 409;
}

function safeCode(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "existing_team_unavailable";
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<Body | null> {
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
  if (raw === null || raw === undefined || raw === "") return {};
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Body) : null;
  } catch {
    return null;
  }
}

export interface VpsJudgementNative {
  target(): Promise<unknown>;
  write(request: NativeRequest & { connectionKey: string }): Promise<unknown>;
}

export const vpsJudgementNative: VpsJudgementNative = {
  target: () => invoke<unknown>(TARGET),
  write: (request) => invoke<unknown>(WRITE, { request }),
};

function asRecord(value: unknown): Body {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Body) : {};
}

export function vpsJudgementApi(next: ApiFetch, native: VpsJudgementNative = vpsJudgementNative, inDesktop: () => boolean = isTauri): ApiFetch {
  return async (input, init) => {
    const path = apiPath(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const route = path ? ROUTES.find((r) => r.method === method && r.path.test(path)) : undefined;
    if (!route || !path || !inDesktop()) return next(input, init);

    let target: Body;
    try {
      target = asRecord(await native.target());
    } catch {
      return json({ error: "existing_team_unavailable" }, 503);
    }
    if (target.ok !== true) {
      const code = safeCode(target.error);
      if (NOT_AN_EXISTING_TEAM.has(code)) return next(input, init);
      return json({ error: code }, statusOf(code));
    }
    if (typeof target.connectionKey !== "string" || !target.connectionKey) {
      return json({ error: "existing_team_unavailable" }, 503);
    }

    const body = await readBody(input, init);
    if (body === null) return invalid("invalid_json");
    const id = route.path.exec(path)![1]!;
    const built = route.build(id, body);
    if (built instanceof Response) return built;

    let reply: Body;
    try {
      reply = asRecord(await native.write({ ...built, connectionKey: target.connectionKey }));
    } catch {
      return json({ error: "existing_team_unavailable" }, 503);
    }
    if (reply.ok !== true) {
      const code = safeCode(reply.error);
      return json({ error: code }, statusOf(code));
    }
    return json(route.shape(id, built, reply));
  };
}
