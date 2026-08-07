import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  attributionFromPage,
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

const REPO = path.resolve(__dirname, "../../..");
const MIGRATION = readFileSync(
  path.join(REPO, "supabase/migrations/063_download_clicks.sql"),
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
