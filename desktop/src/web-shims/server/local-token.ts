/**
 * Stand-in for web/lib/local-token.ts (a token file on the user's box, for
 * the CLI). The desktop has no such token: a request is never local-token
 * authenticated, and the web's routes take their session branch.
 */
export const LOCAL_TOKEN_COOKIE = "jht_local_token";

export function isLocalTokenAuthenticated(
  _authorization: string | null | undefined,
  _cookie?: string | null,
): boolean {
  return false;
}
