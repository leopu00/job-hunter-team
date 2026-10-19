/**
 * What a provider's 429 says, read without the AI SDK: how long it asks to
 * wait, when that is over, and the headers that say why — saved on the error so
 * that whoever manages the team can tell a burst from an exhausted plan.
 */

import type { QuotaReason, RateLimitDetails } from "../errors.ts";

/**
 * A wait this long is not a burst of requests: it is a window that is spent
 * (the 5-hour or the weekly one of a plan), and the error names it `quota`.
 */
export const QUOTA_THRESHOLD_MS = 5 * 60_000;

/**
 * No wait longer than this is believed. A provider asking for more (or a figure with 300 digits)
 * is asking for "not today": 30 days says that, and keeps `now + asked` a date `toISOString` can write.
 */
export const MAX_ASKED_MS = 30 * 24 * 60 * 60_000;

/** The most headers kept, and the longest name and value: an error is not a log. */
const MAX_HEADERS = 20;
const MAX_NAME = 64;
const MAX_VALUE = 64;

/** `retry-after`, and the `…ratelimit…` family the providers use for their limits (x-ratelimit-*, anthropic-ratelimit-*). */
const NAME = /^(?:retry-after|[a-z0-9-]*ratelimit[a-z0-9-]*)$/;

/** Counts, durations and instants: letters, digits and the punctuation of "6m0s", "Mon, 19 Oct 2026 10:00:00 GMT", "2026-10-19T10:00:00Z". */
const VALUE = /^[A-Za-z0-9 .,:;=+\/_-]+$/;

/** A secret looks like a name with no spaces, or says what it is. */
const SECRET = /\b(?:sk|pk|rk)-[A-Za-z0-9]|bearer|token|secret|password|[A-Za-z0-9_-]{32,}/i;

/**
 * `retry-after` as milliseconds: whole or fractional seconds, or an HTTP-date
 * measured against `nowMs`. Anything else is no instruction (null). A date in
 * the past is a wait of zero, not a negative one.
 */
export function parseRetryAfter(raw: string | undefined, nowMs: number): number | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.min(MAX_ASKED_MS, Math.ceil(seconds * 1_000)) : null;
  }
  // An HTTP-date is always GMT. Date.parse also reads "-5" and "1" as years, and a date with no zone as local time:
  // neither is an instruction, so only the GMT form is read.
  if (!/[A-Za-z]{3}/.test(text) || !/(?:GMT|UTC)$/i.test(text)) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.min(MAX_ASKED_MS, Math.max(0, at - nowMs));
}

/** The headers of a 429 that say how long and why, and only those, and only when their value is plain. */
export function rateLimitHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> {
  const kept: Record<string, string> = {};
  if (!headers) return kept;
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (Object.keys(kept).length >= MAX_HEADERS) break;
    if (name.length > MAX_NAME || !NAME.test(name)) continue;
    if (typeof rawValue !== "string") continue;
    const value = rawValue.trim();
    if (value === "" || value.length > MAX_VALUE || !VALUE.test(value) || SECRET.test(value)) continue;
    kept[name] = value;
  }
  return kept;
}

/**
 * What a 429 that outlived the backoff is: a burst to wait out
 * (`rate_limit_429`) or a spent window (`quota`). Only the wait the provider
 * asked for tells them apart, and without one it is a burst. `reason` names the
 * window with the agent-state vocabulary when the caller can prove it; the
 * headers of a 429 do not, so the runtime never guesses.
 */
export function describeRateLimit(
  askedMs: number | null,
  headers: Record<string, string | undefined> | undefined,
  nowMs: number,
  reason?: QuotaReason,
): RateLimitDetails {
  const kind = askedMs !== null && askedMs > QUOTA_THRESHOLD_MS ? "quota" : "rate_limit_429";
  return {
    kind,
    headers: rateLimitHeaders(headers),
    ...(askedMs !== null ? { retryAfterMs: askedMs, resumeAt: new Date(nowMs + askedMs).toISOString() } : {}),
    ...(kind === "quota" && reason ? { reason } : {}),
  };
}
