import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  attributionFromPage,
  DOWNLOAD_ATTRIBUTION_ALLOWLIST,
  DOWNLOAD_TARGETS,
  downloadHref,
  type DownloadClick,
} from "../../../web/lib/download-funnel";
import {
  DELETE,
  handleDownloadRedirect,
  OPTIONS,
  PATCH,
  POST,
  PUT,
} from "../../../web/app/go/[slug]/route";
import {
  DOWNLOAD_AGGREGATE_RATE_LIMIT,
  recordDownloadClick,
} from "../../../web/lib/download-clicks";
import { checkDistributedRateLimit } from "../../../web/lib/rate-limit";

const REPO = path.resolve(__dirname, "../../..");
const MIGRATION = readFileSync(
  path.join(REPO, "supabase/migrations/063_download_clicks.sql"),
  "utf8",
);
const SOURCE_MIGRATION = readFileSync(
  path.join(REPO, "supabase/migrations/082_download_clicks_tiktok_source.sql"),
  "utf8",
);
const ROUTE = readFileSync(
  path.join(REPO, "web/app/go/[slug]/route.ts"),
  "utf8",
);
const RECORDER = readFileSync(
  path.join(REPO, "web/lib/download-clicks.ts"),
  "utf8",
);
const DOWNLOAD_PAGE = readFileSync(
  path.join(REPO, "web/app/download/DownloadClient.tsx"),
  "utf8",
);
const PRIVACY_PAGE = readFileSync(
  path.join(REPO, "web/app/privacy/page.tsx"),
  "utf8",
);

const FIXED_NOW = new Date("2026-08-09T14:37:58.123Z");

function testDependencies(record = vi.fn(async (_event: DownloadClick) => {})) {
  const tasks: Array<() => void | Promise<void>> = [];
  const logFailure = vi.fn();
  return {
    dependencies: {
      schedule: (task: () => void | Promise<void>) => tasks.push(task),
      record,
      now: () => FIXED_NOW,
      logFailure,
    },
    tasks,
    record,
    logFailure,
  };
}

describe("B8 download funnel", () => {
  it("T1 redirects every allowlisted slug to its exact GitHub asset", async () => {
    for (const [slug, destination] of Object.entries(DOWNLOAD_TARGETS)) {
      const state = testDependencies();
      const response = handleDownloadRedirect(
        new Request(`https://jobhunterteam.ai/go/${slug}`),
        slug,
        state.dependencies,
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(destination);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(state.tasks).toHaveLength(1);
      await state.tasks[0]();
      expect(state.record).toHaveBeenCalledWith({
        ts_hour: "2026-08-09T14",
        slug,
        utm_source: "none",
        utm_medium: "none",
        utm_campaign: "none",
      });
    }
  });

  it("T2 fails closed for unknown assets without Location or persistence", () => {
    const state = testDependencies();
    const response = handleDownloadRedirect(
      new Request("https://jobhunterteam.ai/go/unknown"),
      "unknown",
      state.dependencies,
    );
    expect(response.status).toBe(404);
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.tasks).toHaveLength(0);
  });

  it.each([
    "url=https%3A%2F%2Fevil.example",
    "url=%2F%2Fevil.example",
    "url=%252F%252Fevil.example",
    "url=https%3A%2F%2Fgithub.com%40evil.example",
    "next=https%3A%2F%2Fevil.example",
  ])("T3 ignores redirect input: %s", (query) => {
    const state = testDependencies();
    const response = handleDownloadRedirect(
      new Request(`https://jobhunterteam.ai/go/win-setup?${query}`),
      "win-setup",
      state.dependencies,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      DOWNLOAD_TARGETS["win-setup"],
    );
  });

  it.each([
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "Reddit",
    "paid%20social",
    "%2F%2Fevil.example",
    "%F0%9F%9A%80",
  ])("T4 maps dirty attribution to none: %s", async (utmSource) => {
    const state = testDependencies();
    const response = handleDownloadRedirect(
      new Request(
        `https://jobhunterteam.ai/go/mac?utm_source=${utmSource}&utm_medium=paid&utm_campaign=lancio-2026-08`,
      ),
      "mac",
      state.dependencies,
    );
    expect(response.status).toBe(302);
    await state.tasks[0]();
    expect(state.record).toHaveBeenCalledWith({
      ts_hour: "2026-08-09T14",
      slug: "mac",
      utm_source: "none",
      utm_medium: "paid",
      utm_campaign: "lancio-2026-08",
    });
  });

  it("attributes an allowlisted TikTok download end-to-end", async () => {
    const state = testDependencies();
    const response = handleDownloadRedirect(
      new Request(
        "https://jobhunterteam.ai/go/mac?utm_source=tiktok&utm_medium=paid&utm_campaign=lancio-2026-08",
      ),
      "mac",
      state.dependencies,
    );

    expect(response.status).toBe(302);
    await state.tasks[0]();
    expect(state.record).toHaveBeenCalledWith({
      ts_hour: "2026-08-09T14",
      slug: "mac",
      utm_source: "tiktok",
      utm_medium: "paid",
      utm_campaign: "lancio-2026-08",
    });
    expect(
      downloadHref(
        "mac",
        attributionFromPage({
          utm_source: "tiktok",
          utm_medium: "paid",
          utm_campaign: "lancio-2026-08",
        }),
      ),
    ).toBe(
      "/go/mac?utm_source=tiktok&utm_medium=paid&utm_campaign=lancio-2026-08",
    );
  });

  it("T5 handles HEAD without a body and rejects non-read methods", async () => {
    const state = testDependencies();
    const head = handleDownloadRedirect(
      new Request("https://jobhunterteam.ai/go/linux", { method: "HEAD" }),
      "linux",
      state.dependencies,
    );
    expect(head.status).toBe(302);
    expect(head.headers.get("location")).toBe(DOWNLOAD_TARGETS.linux);
    expect(await head.text()).toBe("");

    for (const handler of [POST, PUT, PATCH, DELETE, OPTIONS]) {
      const response = handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.has("location")).toBe(false);
    }
  });

  it("T6 persists only the five aggregate dimensions and a counter", () => {
    const columns = MIGRATION.slice(
      MIGRATION.indexOf("CREATE TABLE"),
      MIGRATION.indexOf("ALTER TABLE"),
    );
    for (const allowed of [
      "ts_hour",
      "slug",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "n bigint",
    ]) {
      expect(columns).toContain(allowed);
    }
    for (const forbidden of [
      "ip_address",
      "user_agent",
      "referrer text",
      "cookie text",
      "user_id",
      "session_id",
      "created_at",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
    expect(ROUTE).not.toMatch(/headers\.get|cookies\(|request\.headers/);
    expect(RECORDER).not.toContain("Request");
  });

  it("T7 schedules all 50 increments and the SQL uses one atomic upsert", async () => {
    let aggregate = 0;
    const record = vi.fn(async () => {
      aggregate += 1;
    });
    const tasks: Array<() => void | Promise<void>> = [];

    for (let i = 0; i < 50; i += 1) {
      const response = handleDownloadRedirect(
        new Request(
          "https://jobhunterteam.ai/go/mac?utm_source=reddit&utm_medium=paid&utm_campaign=lancio-2026-08",
        ),
        "mac",
        {
          schedule: (task) => tasks.push(task),
          record,
          now: () => FIXED_NOW,
          logFailure: vi.fn(),
        },
      );
      expect(response.status).toBe(302);
    }

    await Promise.all(tasks.map((task) => task()));
    expect(record).toHaveBeenCalledTimes(50);
    expect(aggregate).toBe(50);
    expect(MIGRATION).toContain(
      "ON CONFLICT (ts_hour, slug, utm_source, utm_medium, utm_campaign)",
    );
    expect(MIGRATION).toMatch(
      /DO UPDATE SET n = public\.download_clicks\.n \+ 1/,
    );
  });

  it("T8 returns the download redirect when persistence is unavailable", async () => {
    const state = testDependencies(
      vi.fn(async () => {
        throw new Error("database unavailable with request details");
      }),
    );
    const response = handleDownloadRedirect(
      new Request(
        "https://jobhunterteam.ai/go/mac?utm_source=private-campaign",
      ),
      "mac",
      state.dependencies,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DOWNLOAD_TARGETS.mac);
    await state.tasks[0]();
    expect(state.logFailure).toHaveBeenCalledOnce();
    expect(state.logFailure).toHaveBeenCalledWith();
  });

  it("T8 also returns the redirect if background scheduling itself fails", () => {
    const logFailure = vi.fn();
    const response = handleDownloadRedirect(
      new Request("https://jobhunterteam.ai/go/linux?utm_source=reddit"),
      "linux",
      {
        schedule: () => {
          throw new Error("scheduler unavailable");
        },
        record: vi.fn(async () => {}),
        now: () => FIXED_NOW,
        logFailure,
      },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DOWNLOAD_TARGETS.linux);
    expect(logFailure).toHaveBeenCalledOnce();
    expect(logFailure).toHaveBeenCalledWith();
  });

  it("T9 enables forced RLS and denies browser roles table and RPC access", () => {
    expect(MIGRATION).toContain(
      "ALTER TABLE public.download_clicks ENABLE ROW LEVEL SECURITY",
    );
    expect(MIGRATION).toContain(
      "ALTER TABLE public.download_clicks FORCE ROW LEVEL SECURITY",
    );
    expect(MIGRATION).toContain(
      "REVOKE ALL ON TABLE public.download_clicks FROM PUBLIC, anon, authenticated",
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.increment_download_clicks[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    expect(MIGRATION).not.toMatch(/CREATE POLICY/i);
  });

  it("T10 gives the four page CTAs local links with only valid current UTM", () => {
    const attribution = attributionFromPage({
      utm_source: "reddit",
      utm_medium: "paid",
      utm_campaign: "lancio-2026-08",
      url: "https://evil.example",
      extra: "not-propagated",
    });
    for (const slug of Object.keys(DOWNLOAD_TARGETS)) {
      expect(
        downloadHref(slug as keyof typeof DOWNLOAD_TARGETS, attribution),
      ).toBe(
        `/go/${slug}?utm_source=reddit&utm_medium=paid&utm_campaign=lancio-2026-08`,
      );
    }
    expect(DOWNLOAD_PAGE).toContain('windows: "win-setup"');
    expect(DOWNLOAD_PAGE).toContain('href={downloadHref("win-portable"');
    expect(DOWNLOAD_PAGE).not.toContain("releases/latest/download");

    expect(
      attributionFromPage({
        utm_source: ["reddit", "spoofed"],
        utm_medium: "Paid",
        utm_campaign: "x".repeat(41),
      }),
    ).toEqual({
      utm_source: "none",
      utm_medium: "none",
      utm_campaign: "none",
    });
  });

  it("treats duplicate URL attribution as ambiguous and fail-closed", async () => {
    const state = testDependencies();
    handleDownloadRedirect(
      new Request(
        "https://jobhunterteam.ai/go/mac?utm_source=reddit&utm_source=unique-id",
      ),
      "mac",
      state.dependencies,
    );
    await state.tasks[0]();
    expect(state.record).toHaveBeenCalledWith(
      expect.objectContaining({ utm_source: "none" }),
    );
  });

  it("bounds anonymous bucket cardinality with matching app and DB allowlists", async () => {
    expect(DOWNLOAD_ATTRIBUTION_ALLOWLIST).toEqual({
      utm_source: ["reddit", "tiktok"],
      utm_medium: ["paid"],
      utm_campaign: ["lancio-2026-08"],
    });
    expect(MIGRATION).toContain("utm_source IN ('none', 'reddit')");
    expect(SOURCE_MIGRATION).toContain(
      "utm_source IN ('none', 'reddit', 'tiktok')",
    );
    expect(SOURCE_MIGRATION).not.toContain("utm_medium");
    expect(SOURCE_MIGRATION).not.toContain("utm_campaign");
    expect(MIGRATION).toContain("utm_medium IN ('none', 'paid')");
    expect(MIGRATION).toContain("utm_campaign IN ('none', 'lancio-2026-08')");

    const recorded: DownloadClick[] = [];
    const tasks: Array<() => void | Promise<void>> = [];
    for (let i = 0; i < 100; i += 1) {
      handleDownloadRedirect(
        new Request(
          `https://jobhunterteam.ai/go/mac?utm_source=attacker_${i}&utm_medium=paid_${i}&utm_campaign=unique_${i}`,
        ),
        "mac",
        {
          schedule: (task) => tasks.push(task),
          record: async (event) => {
            recorded.push(event);
          },
          now: () => FIXED_NOW,
          logFailure: vi.fn(),
        },
      );
    }
    await Promise.all(tasks.map((task) => task()));
    expect(new Set(recorded.map((event) => JSON.stringify(event))).size).toBe(
      1,
    );
    expect(recorded[0]).toEqual({
      ts_hour: "2026-08-09T14",
      slug: "mac",
      utm_source: "none",
      utm_medium: "none",
      utm_campaign: "none",
    });
  });

  it("bounds aggregate RPC writes with one shared non-identifying bucket", async () => {
    expect(DOWNLOAD_AGGREGATE_RATE_LIMIT).toEqual({
      namespace: "download-funnel",
      scope: "aggregate",
      identity: "global",
      max: 60,
      windowMs: 60_000,
    });

    let checks = 0;
    const increment = vi.fn(async (_event: DownloadClick) => {});
    const events = Array.from({ length: 100 }, (_, i): DownloadClick => ({
      ts_hour: "2026-08-09T14",
      slug: "mac",
      // Even if diverse values reached this boundary, no event dimension is
      // used as rate-limit identity and all callers consume the same budget.
      utm_source: `attacker_${i}`,
      utm_medium: `medium_${i}`,
      utm_campaign: `campaign_${i}`,
    }));

    await Promise.all(
      events.map((event) =>
        recordDownloadClick(event, {
          check: async (namespace, scope, identity, max, windowMs) => {
            expect({ namespace, scope, identity, max, windowMs }).toEqual(
              DOWNLOAD_AGGREGATE_RATE_LIMIT,
            );
            checks += 1;
            return { allowed: checks <= DOWNLOAD_AGGREGATE_RATE_LIMIT.max };
          },
          increment,
        }),
      ),
    );

    expect(checks).toBe(100);
    expect(increment).toHaveBeenCalledTimes(60);
    expect(RECORDER.indexOf("dependencies.check")).toBeLessThan(
      RECORDER.indexOf("dependencies.increment"),
    );
    expect(RECORDER).toContain('identity: "global"');
    expect(RECORDER).not.toMatch(/headers\.get|cookies\(|user_agent|user_id/);
  });

  it("fails closed across instances when distributed coordination is absent", async () => {
    const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
    const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      expect(
        await checkDistributedRateLimit(
          "download-funnel",
          "aggregate",
          "global",
          60,
          60_000,
        ),
      ).toBeNull();

      // Each call represents an independent cold instance. Without shared
      // state every one must skip privileged work, not receive a fresh budget.
      const increment = vi.fn(async (_event: DownloadClick) => {});
      await Promise.all(
        Array.from({ length: 100 }, () =>
          recordDownloadClick(
            {
              ts_hour: "2026-08-09T14",
              slug: "mac",
              utm_source: "reddit",
              utm_medium: "paid",
              utm_campaign: "lancio-2026-08",
            },
            { check: checkDistributedRateLimit, increment },
          ),
        ),
      );
      expect(increment).not.toHaveBeenCalled();
    } finally {
      if (savedUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
      else process.env.UPSTASH_REDIS_REST_URL = savedUrl;
      if (savedToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
      else process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
    }
  });

  it("fails closed instead of using local memory on Upstash failure", async () => {
    const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
    const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.UPSTASH_REDIS_REST_URL = "https://rate-limit.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ unexpected: "pipeline response" }),
      );

    try {
      expect(
        await checkDistributedRateLimit(
          "download-funnel",
          "aggregate",
          "global",
          60,
          60_000,
        ),
      ).toBeNull();
      expect(
        await checkDistributedRateLimit(
          "download-funnel",
          "aggregate",
          "global",
          60,
          60_000,
        ),
      ).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
      if (savedUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
      else process.env.UPSTASH_REDIS_REST_URL = savedUrl;
      if (savedToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
      else process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
    }
  });

  it("documents anonymous aggregated clicks in every privacy locale", () => {
    expect(PRIVACY_PAGE.match(/s5_title:/g)).toHaveLength(7);
    expect(PRIVACY_PAGE.match(/s5_body:/g)).toHaveLength(7);
    for (const term of [
      "senza cookie né identificativi",
      "without cookies or identifiers",
      "sütik és azonosítók nélkül",
      "sin cookies ni identificadores",
      "ohne Cookies oder Kennungen",
      "sans cookies ni identifiants",
      "sem cookies nem identificadores",
    ]) {
      expect(PRIVACY_PAGE).toContain(term);
    }
  });
});
