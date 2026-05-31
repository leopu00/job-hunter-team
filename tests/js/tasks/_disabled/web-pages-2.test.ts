/** Test E2E vitest batch 2 — API routes 200 + page rendering per team, secrets, context, activity, forum, search, sentinel, audit. */
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
function readPage(file: string) {
  const direct = path.join(WEB, file);
  if (fs.existsSync(direct)) return fs.readFileSync(direct, "utf-8");
  const protectedPath = path.join(WEB, "(protected)", file);
  return fs.readFileSync(protectedPath, "utf-8");
}
function nreq(url: string, init?: RequestInit) {
  const r = new Request(url, init) as any;
  r.nextUrl = new URL(url);
  return r;
}

describe("API /api/team", () => {
  it("GET → 200 con array team", async () => {
    const { GET } = await import("../../../web/app/api/team/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.team)).toBe(true);
    expect(data.team.length).toBeGreaterThan(0);
    expect(data.team[0]).toHaveProperty("id");
    expect(data.team[0]).toHaveProperty("online");
  });
});

describe("API /api/secrets", () => {
  it("GET → 200 con secrets array e total", async () => {
    const { GET } = await import("../../../web/app/api/secrets/route.js");
    const res = await GET(nreq("http://localhost/api/secrets"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.secrets)).toBe(true);
    expect(typeof data.total).toBe("number");
  });
  it("POST senza name → 400", async () => {
    const { POST } = await import("../../../web/app/api/secrets/route.js");
    const res = await POST(nreq("http://localhost/api/secrets", {
      method: "POST", body: JSON.stringify({ value: "v" }),
    }));
    expect(res.status).toBe(400);
  });
  it("DELETE senza id → 400", async () => {
    const m = await import("../../../web/app/api/secrets/route.js");
    const res = await m.DELETE(nreq("http://localhost/api/secrets"));
    expect(res.status).toBe(400);
  });
  it("DELETE id inesistente → 404", async () => {
    const m = await import("../../../web/app/api/secrets/route.js");
    const res = await m.DELETE(nreq("http://localhost/api/secrets?id=non-esiste"));
    expect(res.status).toBe(404);
  });
});

describe("API /api/context", () => {
  it("GET → 200 con engine, budget, sections", async () => {
    const { GET } = await import("../../../web/app/api/context/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.engine).toBeDefined();
    expect(data.engine.status).toBe("active");
    expect(data.budget.total).toBeGreaterThan(0);
    expect(Array.isArray(data.sections)).toBe(true);
    expect(data.sections.length).toBeGreaterThanOrEqual(3);
  });
});

describe("API /api/activity", () => {
  it("GET → 200 con items, total, page", async () => {
    const { GET } = await import("../../../web/app/api/activity/route.js");
    const res = await GET(nreq("http://localhost/api/activity"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(data.page).toBe(1);
  });
});

describe("API /api/forum", () => {
  it("GET → 200 con messages, total, authors", async () => {
    const { GET } = await import("../../../web/app/api/forum/route.js");
    const res = await GET(new Request("http://localhost/api/forum"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.messages)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.authors)).toBe(true);
  });
});

describe("API /api/search", () => {
  it("GET senza query → results vuoti", async () => {
    const { GET } = await import("../../../web/app/api/search/route.js");
    const res = await GET(nreq("http://localhost/api/search"));
    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual([]);
  });
  it("GET q troppo corta (<2) → results vuoti", async () => {
    const { GET } = await import("../../../web/app/api/search/route.js");
    const res = await GET(nreq("http://localhost/api/search?q=a"));
    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual([]);
  });
  it("GET q=dashboard → almeno 1 risultato", async () => {
    const { GET } = await import("../../../web/app/api/search/route.js");
    const res = await GET(nreq("http://localhost/api/search?q=dashboard"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.query).toBe("dashboard");
  });
});

describe("API /api/sentinel", () => {
  it("GET → 200 con history e orders array", async () => {
    const { GET } = await import("../../../web/app/api/sentinel/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.history)).toBe(true);
    expect(Array.isArray(data.orders)).toBe(true);
  });
});

describe("API /api/audit", () => {
  it("GET → 200 con events array e total", async () => {
    const { GET } = await import("../../../web/app/api/audit/route.js");
    const res = await GET(new Request("http://localhost/api/audit"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.events)).toBe(true);
    expect(typeof data.total).toBe("number");
  });
  it("GET ?severity=critical → filtra", async () => {
    const { GET } = await import("../../../web/app/api/audit/route.js");
    const res = await GET(new Request("http://localhost/api/audit?severity=critical"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events.every((e: any) => e.severity === "critical")).toBe(true);
  });
});

describe("pagine web batch 2 — rendering e struttura", () => {
  const pages = [
    { route: "team", file: "team/page.tsx", heading: "Team", fetch: "/api/team" },
    { route: "secrets", file: "secrets/page.tsx", heading: "Secrets", fetch: "/api/secrets" },
    { route: "context", file: "context/page.tsx", heading: "Context Engine", fetch: "/api/context" },
    { route: "activity", file: "activity/page.tsx", heading: "Attivit", fetch: "/api/activity" },
    { route: "forum", file: "forum/page.tsx", heading: "Forum", fetch: "/api/forum" },
    { route: "search", file: "search/page.tsx", heading: "Ricerca globale", fetch: "/api/search" },
    { route: "sentinel", file: "sentinel/page.tsx", heading: "Sentinel", fetch: "/api/sentinel" },
    { route: "audit", file: "audit/page.tsx", heading: "Audit Log", fetch: "/api/audit" },
  ];
  for (const p of pages) {
    it(`/${p.route}: 'use client', heading "${p.heading}", fetch ${p.fetch}`, () => {
      const content = readPage(p.file);
      expect(content).toContain("use client");
      expect(content).toContain(p.heading);
      expect(content).toContain(p.fetch);
      expect(content).toMatch(/export default function/);
    });
  }
});
