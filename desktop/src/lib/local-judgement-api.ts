import { invoke, isTauri } from "@tauri-apps/api/core";
import { apiPath, json, type ApiFetch } from "../shell/api-bridge";
import { localDeckToken } from "./local-swipe";
import { localTeamData } from "./local-team-data";

/**
 * The person's verdict on a position of the Swipe, when the profile shows the team of this computer (no
 * cloud account): the routes of the card are answered by the native command, which writes in the team's
 * database through the team's own script (src-tauri/src/local_swipe.rs). Three routes only:
 *
 *   POST   /api/positions/<n>/feedback      like, dislike, hide, star, clear (score, direction, reason, note)
 *   POST   /api/positions/<n>/user-exclude  exclude with a reason (and a note)
 *   DELETE /api/positions/<n>/user-exclude  put it back
 *
 * It never falls through to the cloud: in this mode a call of these routes is answered here, with the code
 * of its refusal, whatever the native side says. Every other route stays refused by the bridge.
 */
const WRITE = "local_team_position_judge";

type Body = Record<string, unknown>;
type NativeRequest = { op: "feedback" | "exclude" | "restore"; id: string } & Body;
type Build = (id: string, body: Body) => NativeRequest | Response;

const invalid = (error: string) => json({ error }, 400);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const FEEDBACK_ACTIONS = new Set(["like", "dislike", "hide", "star", "clear"]);
const DIRECTIONS = new Set(["more_like_this", "less_like_this"]);

const ROUTES: Array<{ method: string; path: RegExp; build: Build }> = [
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

function statusOf(code: string): number {
  if (code === "position_not_found") return 404;
  if (["position_write_read_only", "position_write_window_refused", "account_scope_unavailable", "account_scope_changed"].includes(code)) return 403;
  if (["position_write_request_invalid", "reason_invalid", "note_too_long", "note_invalid"].includes(code)) return 400;
  if (["existing_team_unavailable", "existing_team_runtime_outdated", "local_team_not_running"].includes(code)) return 503;
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

export interface LocalJudgementNative {
  write(request: NativeRequest & { token: string }): Promise<unknown>;
}

export const localJudgementNative: LocalJudgementNative = {
  write: (request) => invoke<unknown>(WRITE, { request }),
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
    const token = localDeckToken(built.id);
    if (!token) return json({ error: "deck_outdated" }, 409);
    let reply: Body;
    try {
      const answered = await native.write({ ...built, token });
      reply = answered && typeof answered === "object" && !Array.isArray(answered) ? (answered as Body) : {};
    } catch {
      return json({ error: "existing_team_unavailable" }, 503);
    }
    if (reply.ok !== true) {
      const code = safeCode(reply.error);
      return json({ error: code }, statusOf(code));
    }
    const id = built.id;
    if (built.op === "feedback") return json({ ok: true, legacy_id: id, action: built.value, source: "local" });
    const status = typeof reply.status === "string" ? reply.status : null;
    return json({ ok: true, id, status, source: "local" });
  };
}
