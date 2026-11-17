/**
 * The pairing session a device token is born with lives in `cloud_sync_tokens.pairing_session_id`, a column that
 * migration 105 creates. Until the migration is applied the column is not there, and an INSERT that names it fails.
 *
 * `missingPairingSessionColumn` says that THAT is why a write failed: PostgREST answers `PGRST204` (the column is not
 * in the schema cache) or Postgres `42703` (undefined column), and in both the message NAMES the column. A failure of
 * another kind, or of another column, is not this one: the caller must not go on as if it were.
 */
export function missingPairingSessionColumn(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code !== "PGRST204" && error.code !== "42703") return false;
  return String(error.message ?? "").includes("pairing_session_id");
}

/**
 * Where a cloud-sync token was born (`cloud_sync_tokens.token_origin`, migration 107): `device_register` hands a user
 * session to the box, `device_code` (`jht cloud login`) and `page` (the page of the tokens) hand none. The door of the
 * application authorisations reads it: an active token without a pairing session closes that door only when it may
 * hold a session (device_register, or an unknown origin).
 */
export type TokenOrigin = "device_register" | "device_code" | "page";

/** The INSERT failed because 107 is not applied yet: the column `token_origin` is not there. Same rule as above. */
export function missingTokenOriginColumn(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code !== "PGRST204" && error.code !== "42703") return false;
  return String(error.message ?? "").includes("token_origin");
}

/** True for an origin that hands no user session to a box: such a token, without a session, closes no door. */
export function originHoldsNoSession(origin: unknown): boolean {
  return origin === "device_code" || origin === "page";
}
