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
