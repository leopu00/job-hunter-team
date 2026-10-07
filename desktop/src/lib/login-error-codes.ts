import type { LoginErrorCode } from "./supabase";

/**
 * The login screen's own codes (kebab-case, lib/supabase.ts) mapped onto the
 * error catalog, so the sign-in errors read from the same table as the rest
 * of the app. A Record over LoginErrorCode: a new login code without a
 * catalog code does not compile, and error-catalog.test.ts checks that every
 * target is in the catalog.
 */
export const LOGIN_ERROR_CATALOG_CODE: Readonly<Record<LoginErrorCode, string>> = {
  "not-configured": "auth_not_configured",
  "not-desktop": "desktop_only",
  "port-busy": "port_busy",
  "browser-failed": "browser_failed",
  "browser-not-found": "browser_not_found",
  "keychain-failed": "keychain_unavailable",
  denied: "denied",
  "timed-out": "timed_out",
  cancelled: "cancelled",
  "in-progress": "login_in_progress",
  "exchange-failed": "login_exchange_failed",
  unknown: "login_failed",
};
