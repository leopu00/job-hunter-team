/** Test E2E vitest batch 5 — API 200 + rendering: performance, errors, status, api-explorer, integrations, reports, budget. */
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
  NextRequest: class extends Request {
    nextUrl: URL;
    constructor(input: string | URL, init?: RequestInit) {
      super(input, init);
      this.nextUrl = new URL(typeof input === "string" ? input : input.toString());
    }
  },
}));

const WEB = path.resolve(__dirname, "../../../web/app");

describe("API /api/performance", () => {
  it("GET → 200 con cwv (5 metriche valid), pages, totali", async () => {
    const { GET } = await import("../../../web/app/api/performance/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const d = await res.json();
    for (const k of ["lcp", "fid", "cls", "ttfb", "inp"]) {
      expect(d.cwv[k]).toBeDefined();
      expect(["good", "needs-improvement", "poor"]).toContain(d.cwv[k].rating);
      expect(typeof d.cwv[k].value).toBe("number");
    }
    expect(Array.isArray(d.pages)).toBe(true);
    expect(typeof d.totalBundleKB).toBe("number");
    expect(typeof d.avgLoadMs).toBe("number");
  });
});

describe("API /api/errors", () => {
  it("GET → 200 con errors, types, openCount", async () => {
    const { GET } = await import("../../../web/app/api/errors/route.js");
    const res = await GET(new Request("http://localhost/api/errors"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.errors)).toBe(true);
    expect(d.errors.length).toBeGreaterThan(0);
    expect(Array.isArray(d.types)).toBe(true);
    expect(typeof d.openCount).toBe("number");
    const e0 = d.errors[0];
    expect(e0.id).toBeDefined();
    expect(["open", "resolved", "ignored"]).toContain(e0.status);
  });
  it("GET ?status=open → solo errori aperti", async () => {
    const { GET } = await import("../../../web/app/api/errors/route.js");
    const res = await GET(new Request("http://localhost/api/errors?status=open"));
    const d = await res.json();
    for (const e of d.errors) expect(e.status).toBe("open");
  });
  it("PUT → 400 se parametri non validi", async () => {
    const { PUT } = await import("../../../web/app/api/errors/route.js");
    const res = await PUT(new Request("http://localhost/api/errors", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "", status: "bad" }),
    }));
    expect(res.status).toBe(400);
  });
  it("PUT → 404 se errore non trovato", async () => {
    const { PUT } = await import("../../../web/app/api/errors/route.js");
    const res = await PUT(new Request("http://localhost/api/errors", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "non-esiste-xyz", status: "resolved" }),
    }));
    expect(res.status).toBe(404);
  });
});

describe("API /api/status", () => {
  it("GET → 200 con services, overall, incidents", async () => {
    const { GET } = await import("../../../web/app/api/status/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.services)).toBe(true);
    expect(d.services.length).toBeGreaterThan(0);
    expect(["operational", "degraded", "down", "maintenance"]).toContain(d.overall);
    expect(Array.isArray(d.incidents)).toBe(true);
    expect(typeof d.operational).toBe("number");
    expect(typeof d.total).toBe("number");
    const s0 = d.services[0];
    expect(s0.id).toBeDefined();
    expect(typeof s0.uptimePercent).toBe("number");
  });
  it("GET → servizi includono web, api, db", async () => {
    const { GET } = await import("../../../web/app/api/status/route.js");
    const d = await (await GET()).json();
    const ids = d.services.map((s: any) => s.id);
    expect(ids).toContain("web");
    expect(ids).toContain("api");
    expect(ids).toContain("db");
  });
});

describe("API /api/api-explorer", () => {
  it("GET → 200 con endpoints, modules, grouped, total", async () => {
    const { GET } = await import("../../../web/app/api/api-explorer/route.js");
    const res = await GET(new Request("http://localhost/api/api-explorer"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(Array.isArray(d.endpoints)).toBe(true);
    expect(Array.isArray(d.modules)).toBe(true);
    expect(typeof d.grouped).toBe("object");
    expect(typeof d.total).toBe("number");
  });
});

describe("pagine batch 5 — rendering e struttura", () => {
  const pages = [
    { route: "performance",  file: "performance/page.tsx",  heading: "Performance",      fetch: "/api/performance" },
    { route: "errors",       file: "errors/page.tsx",       heading: "Errori",           fetch: "/api/errors" },
    { route: "status",       file: "status/page.tsx",       heading: "Stato del Sistema", fetch: "/api/status" },
    { route: "api-explorer", file: "api-explorer/page.tsx", heading: "API Explorer",     fetch: "/api/api-explorer" },
    { route: "integrations", file: "integrations/page.tsx", heading: "Integrazioni",     fetch: "/api/integrations" },
    { route: "reports",      file: "reports/page.tsx",      heading: "Report",           fetch: "/api/reports" },
    { route: "budget",       file: "budget/page.tsx",       heading: "Budget API",       fetch: "/api/budget" },
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
