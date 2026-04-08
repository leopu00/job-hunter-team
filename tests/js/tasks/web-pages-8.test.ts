/** Test E2E batch 8 — /ai-assistant, /forum, /activity, /search, /docs, /audit */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/server", () => {
  class NR extends Response { static json(body: unknown, init?: { status?: number }) { return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }); } }
  return { NextResponse: NR, NextRequest: class extends Request { get nextUrl() { return new URL(this.url); } } };
});

const WEB = path.resolve(__dirname, "../../../web");
function read(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }
function req(url: string, init?: RequestInit) { return new Request(url, init); }
/** Request con nextUrl (per route che usano req.nextUrl.searchParams) */
function nreq(url: string) { const r = req(url); (r as any).nextUrl = new URL(url); return r; }

const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_ASSISTANT_MODEL = process.env.JHT_AI_ASSISTANT_MODEL;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  delete process.env.OPENAI_API_KEY;
  delete process.env.JHT_AI_ASSISTANT_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_OPENAI_KEY) process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  else delete process.env.OPENAI_API_KEY;
  if (ORIGINAL_ASSISTANT_MODEL) process.env.JHT_AI_ASSISTANT_MODEL = ORIGINAL_ASSISTANT_MODEL;
  else delete process.env.JHT_AI_ASSISTANT_MODEL;
});

/* ── API: ai-assistant ── */
describe("API ai-assistant", () => {
  it("GET → suggestions + stato configurazione", async () => {
    const { GET } = await import("../../../web/app/api/ai-assistant/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.history)).toBe(true);
    expect(Array.isArray(j.suggestions)).toBe(true);
    expect(j.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(typeof j.configured).toBe("boolean");
  });
  it("POST senza message → 400", async () => {
    const { POST } = await import("../../../web/app/api/ai-assistant/route.js");
    const res = await POST(req("http://h/api/ai-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "" }) }));
    expect(res.status).toBe(400);
  });
  it("POST senza OPENAI_API_KEY → 503", async () => {
    const { POST } = await import("../../../web/app/api/ai-assistant/route.js");
    const res = await POST(req("http://h/api/ai-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "help" }) }));
    expect(res.status).toBe(503);
  });
  it("POST messaggio valido → reply string", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      output: [
        { type: "message", content: [{ type: "output_text", text: "Ciao, vai su /setup per iniziare." }] },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req_123" } }));
    const { POST } = await import("../../../web/app/api/ai-assistant/route.js");
    const res = await POST(req("http://h/api/ai-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "help", history: [{ role: "user", content: "ciao", timestamp: Date.now() }], path: "/setup" }),
    }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(typeof j.reply).toBe("string");
    expect(j.reply.length).toBeGreaterThan(0);
    expect(j.model).toBe("gpt-4o-mini");
  });
});

/* ── API: forum ── */
describe("API forum", () => {
  it("GET → messages, total, authors", async () => {
    const { GET } = await import("../../../web/app/api/forum/route.js");
    const res = await GET(req("http://h/api/forum"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.messages)).toBe(true);
    expect(typeof j.total).toBe("number");
    expect(Array.isArray(j.authors)).toBe(true);
  });
});

/* ── API: activity ── */
describe("API activity", () => {
  it("GET → items, total, page, pages", async () => {
    const { GET } = await import("../../../web/app/api/activity/route.js");
    const res = await GET(nreq("http://h/api/activity?page=1&limit=10"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.items)).toBe(true);
    expect(typeof j.total).toBe("number");
    expect(j.page).toBe(1);
    expect(typeof j.pages).toBe("number");
  });
});

/* ── API: search ── */
describe("API search", () => {
  it("GET q troppo corta → results vuoti", async () => {
    const { GET } = await import("../../../web/app/api/search/route.js");
    const res = await GET(nreq("http://h/api/search?q=x"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.results).toEqual([]);
  });
  it("GET q valida → results array + total", async () => {
    const { GET } = await import("../../../web/app/api/search/route.js");
    const res = await GET(nreq("http://h/api/search?q=dashboard"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.results)).toBe(true);
    expect(j.results.length).toBeGreaterThanOrEqual(1);
    expect(typeof j.total).toBe("number");
  });
});

/* ── API: audit ── */
describe("API audit", () => {
  it("GET → events array + total", async () => {
    const { GET } = await import("../../../web/app/api/audit/route.js");
    const res = await GET(req("http://h/api/audit"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.events)).toBe(true);
    expect(typeof j.total).toBe("number");
  });
  it("GET severity filter → 200", async () => {
    const { GET } = await import("../../../web/app/api/audit/route.js");
    const res = await GET(req("http://h/api/audit?severity=critical"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.events)).toBe(true);
  });
});

/* ── Rendering pagine ── */
describe("Rendering pagine batch 8", () => {
  const pages = [
    { name: "ai-assistant", file: "app/ai-assistant/page.tsx", heading: "AI Assistant", api: "/api/ai-assistant" },
    { name: "forum", file: "app/forum/page.tsx", heading: "Forum", api: "/api/forum" },
    { name: "activity", file: "app/activity/page.tsx", heading: "Attività", api: "/api/activity" },
    { name: "search", file: "app/search/page.tsx", heading: "Ricerca globale", api: "/api/search" },
    { name: "docs", file: "app/docs/page.tsx", heading: "Documentazione", api: null },
    { name: "audit", file: "app/audit/page.tsx", heading: "Audit Log", api: "/api/audit" },
  ];

  for (const p of pages) {
    it(`${p.name}: 'use client', heading "${p.heading}"${p.api ? ", fetch " + p.api : ""}`, () => {
      const src = read(p.file);
      expect(src).toContain("use client");
      expect(src).toContain(p.heading);
      if (p.api) expect(src).toContain(p.api);
      expect(src).toMatch(/export default function/);
    });
  }
});
