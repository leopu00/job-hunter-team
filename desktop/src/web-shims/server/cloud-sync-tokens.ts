/**
 * Stand-in for web/lib/cloud-sync/tokens.ts, which mints and hashes the
 * `jht_sync_…` tokens of a user's box with node:crypto. That is server work:
 * in the webview node:crypto does not exist, and importing the real module
 * broke the app at start (Vite: "Cannot access node:crypto.randomBytes").
 * The desktop never issues nor checks a sync token, so asking for either is
 * refused. bundle/build-boundary.test.ts proves the real module stays out of the
 * bundle.
 */
export interface GeneratedSyncToken {
  token: string;
  hash: string;
  prefix: string;
}

export function generateSyncToken(): GeneratedSyncToken {
  throw new Error("sync tokens are not issued in the desktop");
}

export function hashSyncToken(_token: string): string {
  throw new Error("sync tokens are not checked in the desktop");
}
