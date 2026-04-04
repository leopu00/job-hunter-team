/** Test E2E batch 7 — /contacts, /networking, /calendar, /saved-searches, /automations, /database */
import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/server", () => {
  class NR extends Response { static json(body: unknown, init?: { status?: number }) { return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }); } }
  return { NextResponse: NR, NextRequest: class extends Request { get nextUrl() { return new URL(this.url); } } };
});

const WEB = path.resolve(__dirname, "../../../web");
function read(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }
function req(url: string, init?: RequestInit) { return new Request(url, init); }

/* ── API: contacts ── */
describe("API contacts", () => {
  it("GET → contacts array + total", async () => {
    const { GET } = await import("../../../web/app/api/contacts/route.js");
    const res = await GET(req("http://h/api/contacts"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.contacts)).toBe(true);
    expect(j.total).toBeGreaterThanOrEqual(1);
  });
  it("POST senza name → 400", async () => {
    const { POST } = await import("../../../web/app/api/contacts/route.js");
    const res = await POST(req("http://h/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
});

/* ── API: networking ── */
describe("API networking", () => {
  it("GET → network, suggestions, totalContacts", async () => {
    const { GET } = await import("../../../web/app/api/networking/route.js");
    const res = await GET(req("http://h/api/networking"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.network)).toBe(true);
    expect(Array.isArray(j.suggestions)).toBe(true);
    expect(typeof j.totalContacts).toBe("number");
    expect(typeof j.totalCompanies).toBe("number");
  });
});

/* ── API: calendar ── */
describe("API calendar", () => {
  it("GET → events, month, total", async () => {
    const { GET } = await import("../../../web/app/api/calendar/route.js");
    const res = await GET(req("http://h/api/calendar?month=2026-04"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.events)).toBe(true);
    expect(j.month).toBe("2026-04");
    expect(typeof j.total).toBe("number");
  });
});

/* ── API: saved-searches ── */
describe("API saved-searches", () => {
  it("GET → searches, withAlerts, totalNew", async () => {
    const { GET } = await import("../../../web/app/api/saved-searches/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.searches)).toBe(true);
    expect(typeof j.withAlerts).toBe("number");
    expect(typeof j.totalNew).toBe("number");
  });
});

/* ── API: automations ── */
describe("API automations", () => {
  it("GET → automations, enabled, triggers, actions", async () => {
    const { GET } = await import("../../../web/app/api/automations/route.js");
    const res = await GET(req("http://h/api/automations"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.automations)).toBe(true);
    expect(typeof j.enabled).toBe("number");
    expect(Array.isArray(j.triggers)).toBe(true);
    expect(Array.isArray(j.actions)).toBe(true);
  });
  it("PUT senza id/enabled → 400", async () => {
    const { PUT } = await import("../../../web/app/api/automations/route.js");
    const res = await PUT(req("http://h/api/automations", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "x" }) }));
    expect(res.status).toBe(400);
  });
});

/* ── API: database ── */
describe("API database", () => {
  it("GET → tables, totalSizeKB, totalRows", async () => {
    const { GET } = await import("../../../web/app/api/database/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.tables)).toBe(true);
    expect(typeof j.totalSizeKB).toBe("number");
    expect(typeof j.totalRows).toBe("number");
  });
  it("POST non-SELECT → 403", async () => {
    const { POST } = await import("../../../web/app/api/database/route.js");
    const res = await POST(req("http://h/api/database", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table: "t", query: "DROP TABLE t" }) }));
    expect(res.status).toBe(403);
  });
});

/* ── Rendering pagine ── */
describe("Rendering pagine batch 7", () => {
  const pages = [
    { name: "contacts", file: "app/contacts/page.tsx", heading: "Contatti", api: "/api/contacts" },
    { name: "networking", file: "app/networking/page.tsx", heading: "Networking", api: "/api/networking" },
    { name: "calendar", file: "app/calendar/page.tsx", heading: "Calendario", api: "/api/calendar" },
    { name: "saved-searches", file: "app/saved-searches/page.tsx", heading: "Ricerche Salvate", api: "/api/saved-searches" },
    { name: "automations", file: "app/automations/page.tsx", heading: "Automazioni", api: "/api/automations" },
    { name: "database", file: "app/database/page.tsx", heading: "Database", api: "/api/database" },
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
