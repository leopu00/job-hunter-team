export type DirectiveAction = "created" | "edited" | "archived";

export type PendingDirectiveRequest = {
  fingerprint: string;
  requestId: string;
};

export type DirectiveErrorTranslationKey =
  | "errGeneric"
  | "errMismatch"
  | "errNotFound"
  | "errExpired"
  | "errNotYet"
  | "errRateLimited";

export function directiveErrorTranslationKey(
  value: unknown,
): DirectiveErrorTranslationKey {
  if (!value || typeof value !== "object") return "errGeneric";
  const code = (value as { error?: unknown }).error;
  if (code === "request_id_mismatch") return "errMismatch";
  if (code === "directive_not_found") return "errNotFound";
  // The confirmation in two steps of the single door (migration 101).
  if (code === "confirm_expired" || code === "confirm_used" || code === "confirm_not_found")
    return "errExpired";
  if (code === "not_available_yet") return "errNotYet";
  if (code === "rate_limited") return "errRateLimited";
  return "errGeneric";
}

/** The first call of a create or an edit through the door: the order waits for the user's confirmation. */
export function isDirectiveConfirmationRequest(
  value: unknown,
  expected: { requestId: string; action: DirectiveAction },
): value is { confirm_id: string; summary: string; expires_at: string } {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    r.ok === true &&
    r.state === "awaiting_confirm" &&
    r.request_id === expected.requestId &&
    r.action === expected.action &&
    typeof r.confirm_id === "string" &&
    /^[0-9a-f-]{36}$/i.test(r.confirm_id) &&
    typeof r.summary === "string" &&
    typeof r.expires_at === "string"
  );
}

export function retainDirectiveRequest(
  pending: Map<string, PendingDirectiveRequest>,
  key: string,
  payload: object,
  makeId: () => string = () => crypto.randomUUID(),
): PendingDirectiveRequest {
  const fingerprint = JSON.stringify(payload);
  const existing = pending.get(key);
  if (existing?.fingerprint === fingerprint) return existing;
  const next = { fingerprint, requestId: makeId() };
  pending.set(key, next);
  return next;
}

export function isDirectiveAcknowledgement(
  value: unknown,
  expected: { requestId: string; action: DirectiveAction; id?: number },
): value is {
  id: string;
  ok: true;
  request_id: string;
  action: DirectiveAction;
  captain_event: { status: "queued" };
} {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  const event = response.captain_event as Record<string, unknown> | undefined;
  const id = Number(response.id);
  return (
    response.ok === true &&
    response.request_id === expected.requestId &&
    response.action === expected.action &&
    event?.status === "queued" &&
    Number.isInteger(id) &&
    id > 0 &&
    (expected.id === undefined || id === expected.id)
  );
}
