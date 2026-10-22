// The codes of the contract of request_action and the HTTP answer of each one, apart from the library
// (which reads the request and the session) so that the desktop, which has no browser in front of its own
// client, can read the database's refusals without importing it.

/** I codici del contratto e la risposta HTTP di ciascuno. Qualsiasi altro codice è un errore del server. */
export const DATABASE_REFUSALS: Record<string, number> = {
  unauthenticated: 401,
  reauth_required: 401,
  rate_limited: 429,
  unknown_action: 400,
  invalid_params: 400,
  not_found: 404,
  confirm_not_found: 404,
  confirm_expired: 410,
  confirm_used: 409,
  confirm_session_mismatch: 409,
  confirm_action_mismatch: 409,
  level_mismatch: 500,
  position_not_ready: 409,
  already_submitted: 409,
};
