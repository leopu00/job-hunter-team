/** Test E2E batch 9 — /goals, /reminders, /onboarding, /compare, /recommendations, /feedback, /cover-letters, /resume-builder */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/server", () => {
  class NR extends Response { static json(body: unknown, init?: { status?: number }) { return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }); } }
  return { NextResponse: NR, NextRequest: class extends Request { get nextUrl() { return new URL(this.url); } } };
});

const WEB = path.resolve(__dirname, "../../../web");
function read(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }
function req(url: string, init?: RequestInit) { return new Request(url, init); }

/* ── API: goals ── */
describe("API goals", () => {
  it("GET → goals array + summary (total, completed, onTrack, behind)", async () => {
    const { GET } = await import("../../../web/app/api/goals/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.goals)).toBe(true);
    expect(j.summary).toBeDefined();
    expect(typeof j.summary.total).toBe("number");
    expect(typeof j.summary.completed).toBe("number");
  });
  it("POST senza title → 400", async () => {
    const { POST } = await import("../../../web/app/api/goals/route.js");
    const res = await POST(req("http://h/api/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: 5 }) }));
    expect(res.status).toBe(400);
  });
});

/* ── API: reminders ── */
describe("API reminders", () => {
  it("GET → reminders + summary (pending, overdue, done)", async () => {
    const { GET } = await import("../../../web/app/api/reminders/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.reminders)).toBe(true);
    expect(typeof j.summary.pending).toBe("number");
    expect(typeof j.summary.overdue).toBe("number");
  });
  it("PUT senza id/status → 400", async () => {
    const { PUT } = await import("../../../web/app/api/reminders/route.js");
    const res = await PUT(req("http://h/api/reminders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
});

/* ── API: onboarding ── */
describe("API onboarding", () => {
  it("GET → stato onboarding (completed, skipped, stepsCompleted)", async () => {
    const { GET } = await import("../../../web/app/api/onboarding/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(typeof j.completed).toBe("boolean");
    expect(typeof j.skipped).toBe("boolean");
    expect(Array.isArray(j.stepsCompleted)).toBe(true);
  });
});

/* ── API: compare ── */
describe("API compare", () => {
  it("GET → jobs array (id, title, company)", async () => {
    const { GET } = await import("../../../web/app/api/compare/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.jobs)).toBe(true);
  });
  it("POST con <2 ids → 400", async () => {
    const { POST } = await import("../../../web/app/api/compare/route.js");
    const res = await POST(req("http://h/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ["j1"] }) }));
    expect(res.status).toBe(400);
  });
});

/* ── API: recommendations ── */
describe("API recommendations", () => {
  it("GET → jobs, companies, actions + updatedAt", async () => {
    const { GET } = await import("../../../web/app/api/recommendations/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.jobs)).toBe(true);
    expect(Array.isArray(j.companies)).toBe(true);
    expect(Array.isArray(j.actions)).toBe(true);
    expect(typeof j.updatedAt).toBe("number");
  });
});

/* ── API: feedback ── */
describe("API feedback", () => {
  it("GET → feedback array + summary (open, inProgress, resolved)", async () => {
    const { GET } = await import("../../../web/app/api/feedback/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.feedback)).toBe(true);
    expect(typeof j.summary.open).toBe("number");
    expect(typeof j.summary.resolved).toBe("number");
  });
  it("POST senza description → 400", async () => {
    const { POST } = await import("../../../web/app/api/feedback/route.js");
    const res = await POST(req("http://h/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: 0 }) }));
    expect(res.status).toBe(400);
  });
});

/* ── Rendering pagine ── */
describe("Rendering pagine batch 9", () => {
  const pages = [
    { name: "goals", file: "app/goals/page.tsx", heading: "Obiettivi", api: "/api/goals" },
    { name: "reminders", file: "app/reminders/page.tsx", heading: "Promemoria", api: "/api/reminders" },
    { name: "onboarding", file: "app/onboarding/page.tsx", heading: "Benvenuto", api: "/api/onboarding" },
    { name: "compare", file: "app/compare/page.tsx", heading: "Compara Offerte", api: "/api/compare" },
    { name: "recommendations", file: "app/recommendations/page.tsx", heading: "Raccomandazioni", api: "/api/recommendations" },
    { name: "feedback", file: "app/feedback/page.tsx", heading: "Feedback", api: "/api/feedback" },
    { name: "cover-letters", file: "app/cover-letters/page.tsx", heading: "Cover Letter", api: "/api/cover-letters" },
    { name: "resume-builder", file: "app/resume-builder/page.tsx", heading: "Resume Builder", api: "/api/resume" },
  ];

  for (const p of pages) {
    it(`${p.name}: 'use client', heading "${p.heading}", fetch ${p.api}`, () => {
      const src = read(p.file);
      expect(src).toContain("use client");
      expect(src).toContain(p.heading);
      expect(src).toContain(p.api);
      expect(src).toMatch(/export default function/);
    });
  }
});
