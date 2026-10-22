/**
 * The intention kept across a fresh sign-in (T63): «I was authorising this, the door asked for a recent
 * sign-in». Pure, with no Supabase and no Next, so the site and the desktop share it and a test can reach it.
 *
 * It holds NO secret: only what the person was doing and on what. Written in the tab's own `sessionStorage`
 * (gone with the tab) just before the sign-in redirect, read ONCE when the page is back and removed in the
 * same breath, valid for ten minutes, only for the very thing it names and only for the SAME account that
 * wrote it. What it buys is one thing: the FIRST step of the confirmation starts again by itself. The second step, the one that does the thing, stays
 * a click of the person, with the id the server created for the new session.
 */

export type ReauthKind = "apply-authorise" | "team-command";

export interface ReauthIntent {
  kind: ReauthKind;
  /** What it is about: a position number, a team command. Plain text, no secret. */
  target: string;
  /** The account that was signed in when it was written: a different one on the way back resumes nothing. */
  userId: string;
  /** When it was written, in milliseconds. */
  at: number;
}

export const REAUTH_INTENT_KEY = "jht.reauth.intent";
export const REAUTH_INTENT_MAX_AGE_MS = 10 * 60 * 1000;

/** The part of `Storage` this needs; `sessionStorage` fits, and a test can pass a plain object. */
export interface IntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KINDS: readonly string[] = ["apply-authorise", "team-command"];
const TARGET = /^[A-Za-z0-9_.:-]{1,64}$/;
const USER_ID = /^[A-Za-z0-9-]{1,64}$/;

export function saveReauthIntent(
  storage: IntentStorage,
  intent: ReauthIntent,
): boolean {
  if (
    !KINDS.includes(intent.kind) ||
    !TARGET.test(intent.target) ||
    !USER_ID.test(intent.userId)
  ) {
    return false;
  }
  try {
    storage.setItem(REAUTH_INTENT_KEY, JSON.stringify(intent));
    return true;
  } catch {
    return false; // private window, quota: the page goes on without the shortcut
  }
}

/**
 * What the intention of this kind is about, WITHOUT taking it: for a page that has to know which of its
 * things was asked (a team command) before it can say what it expects. Nothing in it is trusted: the caller
 * checks the answer against its own closed list, and then takes the intention, which is when it is consumed.
 */
export function peekReauthTarget(
  storage: IntentStorage,
  kind: ReauthKind,
): string | null {
  try {
    const raw = storage.getItem(REAUTH_INTENT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== "object" || value.kind !== kind) return null;
    const target = value.target;
    return typeof target === "string" && TARGET.test(target) ? target : null;
  } catch {
    return null;
  }
}

/**
 * What a page finds when it is back from the sign-in:
 *   - `resume`: it was asked to resume exactly this, as the same account: start the first step again;
 *   - `changed`: it WAS asked, but the account is not the one that asked (or cannot be told): resume
 *     nothing and say so;
 *   - `none`: nothing for this page.
 */
export type ReauthTake = "resume" | "changed" | "none";

/**
 * ALWAYS removes the intention first, so it is read once whatever the answer: a second render, a reload or a
 * second tab cannot use it again. It is for this page only when it names the same kind and target, is not
 * in the future and is at most ten minutes old; it is then `resume` only if the signed-in account is the
 * one that wrote it. `userId` is who is signed in now (`null` when it cannot be read: never `resume`).
 */
export function takeReauthIntent(
  storage: IntentStorage,
  expected: { kind: ReauthKind; target: string },
  now: number,
  userId: string | null,
): ReauthTake {
  let raw: string | null = null;
  try {
    raw = storage.getItem(REAUTH_INTENT_KEY);
    storage.removeItem(REAUTH_INTENT_KEY);
  } catch {
    return "none";
  }
  if (!raw) return "none";
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return "none";
  }
  if (!value || typeof value !== "object") return "none";
  const intent = value as Record<string, unknown>;
  if (intent.kind !== expected.kind || intent.target !== expected.target) {
    return "none";
  }
  const at = intent.at;
  if (typeof at !== "number" || !Number.isFinite(at)) return "none";
  const age = now - at;
  if (age < 0 || age > REAUTH_INTENT_MAX_AGE_MS) return "none";
  const wrote = intent.userId;
  if (typeof wrote !== "string" || !USER_ID.test(wrote)) return "none";
  return userId !== null && userId === wrote ? "resume" : "changed";
}

/** The sign-in providers the site offers: the person is sent back to the SAME one, never to a chosen one. */
export type ReauthProvider = "google" | "github";

/** The account that is signed in, if it can be told. */
export function userIdOf(user: unknown): string | null {
  const id =
    user && typeof user === "object" ? (user as { id?: unknown }).id : null;
  return typeof id === "string" && USER_ID.test(id) ? id : null;
}

export function reauthProviderOf(user: unknown): ReauthProvider | null {
  const meta =
    user && typeof user === "object"
      ? (user as { app_metadata?: unknown }).app_metadata
      : null;
  const provider =
    meta && typeof meta === "object"
      ? (meta as { provider?: unknown }).provider
      : null;
  return provider === "google" || provider === "github" ? provider : null;
}

/**
 * Where the sign-in comes back to: the callback of the site, which then goes to the page the person was
 * on. Only a path on this origin (never `//host`, never another scheme); anything else falls back to the
 * dashboard, as the callback itself does.
 */
export function reauthCallbackUrl(
  origin: string,
  location: { pathname: string; search: string },
): string {
  const callback = new URL("/auth/callback", origin);
  const next = `${location.pathname}${location.search}`;
  if (next.startsWith("/") && !next.startsWith("//")) {
    callback.searchParams.set("next", next);
  }
  return callback.toString();
}

/** What a sign-in again did. `redirected`: the page is leaving; `done`: it is back with a new session (desktop). */
export type ReauthResult =
  | "redirected"
  | "done"
  | "changed" // the sign-in ended with another account than the one that asked: nothing resumes
  | "cancelled"
  | "unsupported"
  | "failed";
