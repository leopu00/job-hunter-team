/** Test E2E vitest batch 3 — API routes 200 + rendering: integrations, webhooks, reports, docs, search, forum. */
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
function nreq(url: string, init?: RequestInit) {
  const r = new Request(url, init) as any;
  r.nextUrl = new URL(url);
  return r;
}

describe("API /api/integrations", () => {
  it("GET → 200 con integrations array e summary", async () => {
    const { GET } = await import("../../../web/app/api/integrations/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.integrations)).toBe(true);
    expect(data.integrations.length).toBeGreaterThan(0);
    expect(data.summary).toBeDefined();
    expect(typeof data.summary.connected).toBe("number");
    expect(typeof data.summary.disconnected).toBe("number");
  });
});

describe("API /api/webhooks", () => {
  it("GET → 200 con webhooks e total", async () => {
    const { GET } = await import("../../../web/app/api/webhooks/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.webhooks)).toBe(true);
    expect(typeof data.total).toBe("number");
  });
  it("POST senza url → 400", async () => {
    const { POST } = await import("../../../web/app/api/webhooks/route.js");
    const res = await POST(nreq("http://localhost", {
      method: "POST", body: JSON.stringify({ name: "test" }),
    }));
    expect(res.status).toBe(400);
  });
  it("PUT senza id → 400", async () => {
    const { PUT } = await import("../../../web/app/api/webhooks/route.js");
    const res = await PUT(nreq("http://localhost", {
      method: "PUT", body: JSON.stringify({ name: "x" }),
    }));
    expect(res.status).toBe(400);
  });
  it("PUT id inesistente → 404", async () => {
    const { PUT } = await import("../../../web/app/api/webhooks/route.js");
    const res = await PUT(nreq("http://localhost", {
      method: "PUT", body: JSON.stringify({ id: "ghost" }),
    }));
    expect(res.status).toBe(404);
  });
  it("DELETE senza id → 400", async () => {
    const m = await import("../../../web/app/api/webhooks/route.js");
    const res = await m.DELETE(nreq("http://localhost/api/webhooks"));
    expect(res.status).toBe(400);
  });
  it("DELETE id inesistente → 404", async () => {
    const m = await import("../../../web/app/api/webhooks/route.js");
    const res = await m.DELETE(nreq("http://localhost/api/webhooks?id=ghost"));
    expect(res.status).toBe(404);
  });
});

describe("API /api/reports", () => {
  it("GET → 200 con modules array", async () => {
    const { GET } = await import("../../../web/app/api/reports/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.modules)).toBe(true);
    expect(data.modules.length).toBeGreaterThan(0);
  });
  it("POST senza parametri → 400", async () => {
    const { POST } = await import("../../../web/app/api/reports/route.js");
    const res = await POST(nreq("http://localhost", {
      method: "POST", body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });
  it("POST valido → 200 con report e period", async () => {
    const { POST } = await import("../../../web/app/api/reports/route.js");
    const res = await POST(nreq("http://localhost", {
      method: "POST",
      body: JSON.stringify({ from: "2026-01-01", to: "2026-12-31", modules: ["tasks"] }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.report).toBeDefined();
    expect(data.report.period.from).toBe("2026-01-01");
    expect(Array.isArray(data.report.rows)).toBe(true);
  });
});

describe("pagine batch 3 — rendering e struttura", () => {
  const pages = [
    { route: "integrations", file: "integrations/page.tsx", heading: "Integrazioni", fetch: "/api/integrations" },
    { route: "webhooks", file: "webhooks/page.tsx", heading: "Webhook", fetch: "/api/webhooks" },
    { route: "reports", file: "reports/page.tsx", heading: "Report", fetch: "/api/reports" },
    { route: "docs", file: "docs/page.tsx", heading: "Documentazione", fetch: null as string | null },
    { route: "search", file: "search/page.tsx", heading: "Ricerca globale", fetch: "/api/search" },
    { route: "forum", file: "forum/page.tsx", heading: "Forum", fetch: "/api/forum" },
  ];
  for (const p of pages) {
    it(`/${p.route}: 'use client', heading "${p.heading}"`, () => {
      const content = fs.readFileSync(path.join(WEB, p.file), "utf-8");
      expect(content).toContain("use client");
      expect(content).toContain(p.heading);
      if (p.fetch) expect(content).toContain(p.fetch);
      expect(content).toMatch(/export default function/);
    });
  }
});
