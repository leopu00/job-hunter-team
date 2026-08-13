import { describe, expect, it } from "vitest";
import { getUpstashConfigStatus } from "@/lib/upstash-config";

describe("F-06 pairing/upstash safety", () => {
  it("reports only sanitised Upstash readiness", () => {
    expect(
      getUpstashConfigStatus({
        UPSTASH_REDIS_REST_URL: "https://redis.example.test",
        UPSTASH_REDIS_REST_TOKEN: "secret-value",
      }),
    ).toEqual({ configured: true, urlHost: "redis.example.test" });
    expect(
      getUpstashConfigStatus({
        UPSTASH_REDIS_REST_URL: "http://redis.example.test",
        UPSTASH_REDIS_REST_TOKEN: "secret-value",
      }),
    ).toEqual({ configured: false, reason: "invalid-url" });
    expect(
      JSON.stringify(
        getUpstashConfigStatus({
          UPSTASH_REDIS_REST_URL: "https://redis.example.test",
          UPSTASH_REDIS_REST_TOKEN: "secret-value",
        }),
      ),
    ).not.toContain("secret-value");
  });
});
