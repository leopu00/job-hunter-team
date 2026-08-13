export type DirectiveAction = "created" | "edited" | "archived";

export type PendingDirectiveRequest = {
  fingerprint: string;
  requestId: string;
};

export type DirectiveErrorTranslationKey =
  "errGeneric" | "errMismatch" | "errNotFound";

export function directiveErrorTranslationKey(
  value: unknown,
): DirectiveErrorTranslationKey {
  if (!value || typeof value !== "object") return "errGeneric";
  const code = (value as { error?: unknown }).error;
  if (code === "request_id_mismatch") return "errMismatch";
  if (code === "directive_not_found") return "errNotFound";
  return "errGeneric";
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
