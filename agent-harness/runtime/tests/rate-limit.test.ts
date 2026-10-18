/**
 * T10: how a 429 is read, apart from the SDK — the figure the provider asked
 * for, which kind of limit it is, and the only headers that are kept.
 */

import { describe, expect, it } from "vitest";

import { QUOTA_REASONS } from "../src/core/errors.ts";
import { QUOTA_THRESHOLD_MS, describeRateLimit, parseRetryAfter, rateLimitHeaders } from "../src/core/provider/rate-limit.ts";

const AT = Date.UTC(2026, 9, 19, 10, 0, 0);

describe("parseRetryAfter", () => {
  it.each([
    ["10", 10_000],
    ["1", 1_000],
    ["0", 0],
    ["7.5", 7_500],
    [" 3 ", 3_000],
    [new Date(AT + 20_000).toUTCString(), 20_000],
    [new Date(AT - 5_000).toUTCString(), 0],
  ])("%s -> %s ms", (raw, expected) => {
    expect(parseRetryAfter(raw, AT)).toBe(expected);
  });

  it.each([undefined, "", "soon", "-5", "+5", "12 5", "10:00", "Wed, 21 Oct 2026 07:28:00", "2026-10-19T10:00:00"])(
    "%s is no instruction",
    (raw) => {
      expect(parseRetryAfter(raw, AT)).toBeNull();
    },
  );
});

describe("rateLimitHeaders", () => {
  it("keeps the names of the family and drops every other header, whatever its value", () => {
    expect(
      rateLimitHeaders({
        "Retry-After": "30",
        "X-RateLimit-Limit-Requests": "500",
        "content-type": "application/json",
        "set-cookie": "a=b",
        authorization: "Bearer x",
      }),
    ).toEqual({ "retry-after": "30", "x-ratelimit-limit-requests": "500" });
  });

  it("drops a value that is not plain: too long, with odd characters, or shaped like a secret", () => {
    const headers = rateLimitHeaders({
      "x-ratelimit-a": "x".repeat(65),
      "x-ratelimit-b": "ok; <script>",
      "x-ratelimit-c": "sk-abcdef1234",
      "x-ratelimit-d": "abcdefghijklmnopqrstuvwxyzABCDEF012345",
      "x-ratelimit-e": "a bearer b",
      "x-ratelimit-f": "",
      "x-ratelimit-g": "1m30s",
    });
    expect(headers).toEqual({ "x-ratelimit-g": "1m30s" });
  });

  it("keeps at most twenty", () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`x-ratelimit-n${i}`, String(i)]));
    expect(Object.keys(rateLimitHeaders(many))).toHaveLength(20);
  });
});

describe("describeRateLimit", () => {
  it("is a burst up to five minutes and a spent window past it", () => {
    expect(describeRateLimit(QUOTA_THRESHOLD_MS, undefined, AT).kind).toBe("rate_limit_429");
    expect(describeRateLimit(QUOTA_THRESHOLD_MS + 1, undefined, AT).kind).toBe("quota");
    expect(describeRateLimit(null, undefined, AT)).toEqual({ kind: "rate_limit_429", headers: {} });
  });

  it("names the window only when told, with the agent-state vocabulary, and only for a quota", () => {
    expect(QUOTA_REASONS).toEqual(["limite_5h", "limite_settimanale", "limite_spesa_org"]);
    expect(describeRateLimit(3_600_000, undefined, AT, "limite_5h")).toMatchObject({ kind: "quota", reason: "limite_5h" });
    expect(describeRateLimit(3_600_000, undefined, AT)).not.toHaveProperty("reason");
    expect(describeRateLimit(5_000, undefined, AT, "limite_5h")).not.toHaveProperty("reason");
  });
});
