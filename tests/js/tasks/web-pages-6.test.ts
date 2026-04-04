/** Test E2E vitest batch 6 — API 200 + rendering: jobs, applications, interviews, companies, cover-letters, profiles, alerts, resume. */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const WEB = path.resolve(__dirname, "../../../web/app");

describe("API /api/jobs", () => {
  it("GET → 200 con jobs array, total, counts", async () => {
    const { GET } = await import("../../../web/app/api/jobs/route.js");
    const res = await GET(new Request("http://localhost/api/jobs"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.jobs)).toBe(true);
    expect(d.jobs.length).toBeGreaterThan(0);
    expect(typeof d.total).toBe("number");
    expect(typeof d.counts).toBe("object");
    const j = d.jobs[0];
    expect(j.id).toBeDefined();
    expect(j.title).toBeDefined();
    expect(j.company).toBeDefined();
  });
});

describe("API /api/applications", () => {
  it("GET → 200 con applications array, total, counts", async () => {
    const { GET } = await import("../../../web/app/api/applications/route.js");
    const res = await GET(new Request("http://localhost/api/applications"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.applications)).toBe(true);
    expect(d.applications.length).toBeGreaterThan(0);
    expect(typeof d.counts).toBe("object");
    const a = d.applications[0];
    expect(a.jobTitle).toBeDefined();
    expect(Array.isArray(a.timeline)).toBe(true);
    expect(Array.isArray(a.docs)).toBe(true);
  });
});

describe("API /api/interviews", () => {
  it("GET → 200 con interviews, upcoming, passed", async () => {
    const { GET } = await import("../../../web/app/api/interviews/route.js");
    const res = await GET(new Request("http://localhost/api/interviews"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.interviews)).toBe(true);
    expect(d.interviews.length).toBeGreaterThan(0);
    expect(typeof d.upcoming).toBe("number");
    expect(typeof d.passed).toBe("number");
    const i = d.interviews[0];
    expect(["phone", "video", "onsite", "take-home"]).toContain(i.type);
    expect(["pending", "passed", "failed"]).toContain(i.outcome);
  });
});

describe("API /api/companies", () => {
  it("GET → 200 con companies, sectors, totalPositions", async () => {
    const { GET } = await import("../../../web/app/api/companies/route.js");
    const res = await GET(new Request("http://localhost/api/companies"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.companies)).toBe(true);
    expect(d.companies.length).toBeGreaterThan(0);
    expect(Array.isArray(d.sectors)).toBe(true);
    expect(typeof d.totalPositions).toBe("number");
    expect(d.companies[0].rating).toBeGreaterThan(0);
  });
});

describe("API /api/cover-letters", () => {
  it("GET → 200 con letters, drafts, finals", async () => {
    const { GET } = await import("../../../web/app/api/cover-letters/route.js");
    const res = await GET(new Request("http://localhost/api/cover-letters"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.letters)).toBe(true);
    expect(d.letters.length).toBeGreaterThan(0);
    expect(typeof d.drafts).toBe("number");
    expect(typeof d.finals).toBe("number");
    expect(d.drafts + d.finals).toBe(d.total);
  });
});

describe("API /api/profiles", () => {
  it("GET → 200 con profiles, avgCompleteness", async () => {
    const { GET } = await import("../../../web/app/api/profiles/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.profiles)).toBe(true);
    expect(d.profiles.length).toBeGreaterThan(0);
    expect(typeof d.avgCompleteness).toBe("number");
    const p = d.profiles[0];
    expect(Array.isArray(p.sections)).toBe(true);
    expect(typeof p.completeness).toBe("number");
  });
});

describe("API /api/alerts", () => {
  it("GET → 200 con alerts array, enabled count", async () => {
    const { GET } = await import("../../../web/app/api/alerts/route.js");
    const res = await GET(new Request("http://localhost/api/alerts"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.alerts)).toBe(true);
    expect(d.alerts.length).toBeGreaterThan(0);
    expect(typeof d.enabled).toBe("number");
    const a = d.alerts[0];
    expect(["email", "telegram", "web"]).toContain(a.channel);
    expect(typeof a.condition).toBe("string");
  });
  it("PUT → 400 se parametri mancanti", async () => {
    const { PUT } = await import("../../../web/app/api/alerts/route.js");
    const res = await PUT(new Request("http://localhost/api/alerts", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "" }),
    }));
    expect(res.status).toBe(400);
  });
  it("PUT → 404 se alert non trovato", async () => {
    const { PUT } = await import("../../../web/app/api/alerts/route.js");
    const res = await PUT(new Request("http://localhost/api/alerts", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "non-esiste", enabled: false }),
    }));
    expect(res.status).toBe(404);
  });
});

describe("API /api/resume", () => {
  it("GET → 200 con personal, experience, skills, languages", async () => {
    const { GET } = await import("../../../web/app/api/resume/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(typeof d.personal).toBe("object");
    expect(Array.isArray(d.experience)).toBe(true);
    expect(Array.isArray(d.skills)).toBe(true);
    expect(Array.isArray(d.languages)).toBe(true);
    expect(typeof d.updatedAt).toBe("number");
  });
});

describe("pagine batch 6 — rendering e struttura", () => {
  const pages = [
    { route: "jobs",           file: "jobs/page.tsx",           heading: "Offerte Lavoro",    fetch: "/api/jobs" },
    { route: "applications",   file: "applications/page.tsx",   heading: "Candidature",       fetch: "/api/applications" },
    { route: "interviews",     file: "interviews/page.tsx",     heading: "Colloqui",          fetch: "/api/interviews" },
    { route: "companies",      file: "companies/page.tsx",      heading: "Aziende",           fetch: "/api/companies" },
    { route: "cover-letters",  file: "cover-letters/page.tsx",  heading: "Cover Letter",      fetch: "/api/cover-letters" },
    { route: "profiles",       file: "profiles/page.tsx",       heading: "Profili Candidato", fetch: "/api/profiles" },
    { route: "alerts",         file: "alerts/page.tsx",         heading: "Alert",             fetch: "/api/alerts" },
    { route: "resume-builder", file: "resume-builder/page.tsx", heading: "Resume Builder",    fetch: "/api/resume" },
  ];
  for (const p of pages) {
    it(`/${p.route}: 'use client', heading "${p.heading}", fetch ${p.fetch}`, () => {
      const content = fs.readFileSync(path.join(WEB, p.file), "utf-8");
      expect(content).toContain("use client");
      expect(content).toContain(p.heading);
      expect(content).toContain(p.fetch);
      expect(content).toMatch(/export default function/);
    });
  }
});
