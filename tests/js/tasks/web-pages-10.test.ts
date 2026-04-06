/** Test E2E batch 10 — /map API, sidebar, NotificationCenter, GlobalSearch, rendering */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/server", () => {
  class NR extends Response { static json(body: unknown, init?: { status?: number }) { return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }); } }
  return { NextResponse: NR, NextRequest: class extends Request { get nextUrl() { return new URL(this.url); } } };
});

const WEB = path.resolve(__dirname, "../../../web");
function read(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }
function req(url: string) { return new Request(url); }

/* ── API: map ── */
describe("API map", () => {
  it("GET → clusters array + totalJobs + areas", async () => {
    const { GET } = await import("../../../web/app/api/map/route.js");
    const res = await GET(req("http://h/api/map"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.clusters)).toBe(true);
    expect(j.clusters.length).toBeGreaterThanOrEqual(10);
    expect(typeof j.totalJobs).toBe("number");
    expect(Array.isArray(j.areas)).toBe(true);
  });
  it("GET con location filter → filtra per area", async () => {
    const { GET } = await import("../../../web/app/api/map/route.js");
    const res = await GET(req("http://h/api/map?location=Nord"));
    const j = await res.json();
    expect(j.clusters.length).toBeGreaterThanOrEqual(1);
    expect(j.clusters.length).toBeLessThan(12);
  });
});

/* ── Sidebar ── */
describe("Sidebar", () => {
  const src = read("app/components/sidebar.tsx");
  it("export default Sidebar + 'use client' + NAV con 6 gruppi", () => {
    expect(src).toContain("use client");
    expect(src).toMatch(/export default function Sidebar/);
    for (const g of ["SISTEMA", "JOB HUNTING", "AGENTI", "DATI", "TOOLS", "CONFIG"])
      expect(src).toContain(`'${g}'`);
    expect(src).toContain("['/feedback','Feedback']");
  });
  it("collapsed state + toggleCollapse + localStorage persistence", () => {
    expect(src).toContain("collapsed");
    expect(src).toContain("toggleCollapse");
    expect(src).toContain("jht:sb-coll");
    expect(src).toContain("localStorage");
  });
  it("favs toggle + PROTECTED array + mobile detection", () => {
    expect(src).toContain("toggleFav");
    expect(src).toContain("jht:sb-favs");
    expect(src).toContain("PROTECTED");
    expect(src).toContain("isMobile");
    expect(src).toContain("768");
  });
});

/* ── NotificationCenter ── */
describe("NotificationCenter", () => {
  const src = read("app/components/NotificationCenter.tsx");
  it("export NotificationCenter + 'use client' + TYPE_CFG con 5 tipi", () => {
    expect(src).toContain("use client");
    expect(src).toMatch(/export function NotificationCenter/);
    for (const p of ["agent_start", "agent_stop", "task_done", "error", "info"])
      expect(src).toContain(`${p}:`);
  });
  it("timeAgo helper (s/m/h/g) + markRead + storage locale notifiche", () => {
    expect(src).toContain("function timeAgo");
    expect(src).toContain("markRead");
    expect(src).toContain("loadNotifications");
    expect(src).toContain("saveNotifications");
    expect(src).toContain("localStorage");
  });
  it("bell button + dropdown + 'Segna tutte lette' + 'Nessuna notifica'", () => {
    expect(src).toContain("aria-label={t.title}");
    expect(src).toContain("Segna tutte lette");
    expect(src).toContain("Nessuna notifica");
    expect(src).toContain("Cancella tutto");
  });
});

/* ── GlobalSearch ── */
describe("GlobalSearch", () => {
  const src = read("app/components/GlobalSearch.tsx");
  it("export GlobalSearch + 'use client' + ITEMS catalogo + RECENT_KEY", () => {
    expect(src).toContain("use client");
    expect(src).toMatch(/export function GlobalSearch/);
    expect(src).toContain("ITEMS");
    expect(src).toContain("RECENT_KEY");
  });
  it("fuzzy search function + Highlighted component", () => {
    expect(src).toContain("function fuzzy");
    expect(src).toContain("function Highlighted");
    expect(src).toContain("indices");
  });
  it("keyboard: Cmd+K, ArrowDown, ArrowUp, Enter, Escape", () => {
    expect(src).toContain("metaKey");
    expect(src).toContain("'k'");
    expect(src).toContain("'ArrowDown'");
    expect(src).toContain("'ArrowUp'");
    expect(src).toContain("'Enter'");
    expect(src).toContain("'Escape'");
  });
  it("3 categorie: Pagine, Config, Sistema", () => {
    for (const c of ["Pagine", "Config", "Sistema"])
      expect(src).toContain(`category: '${c}'`);
  });
  it("ITEMS ha almeno 20 voci navigabili con href", () => {
    const m = src.match(/\{ id: '/g);
    expect(m).toBeTruthy();
    expect(m!.length).toBeGreaterThanOrEqual(20);
  });
});

/* ── API: feedback (completamento batch) ── */
describe("API feedback", () => {
  it("GET → feedback + summary shape", async () => {
    const { GET } = await import("../../../web/app/api/feedback/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.feedback)).toBe(true);
    expect(typeof j.summary.total).toBe("number");
  });
});

/* ── Rendering pagina map ── */
describe("Rendering pagine batch 10", () => {
  it("map: 'use client', heading 'Mappa Opportunità', fetch /api/map + MapView", () => {
    const src = read("app/map/page.tsx");
    expect(src).toContain("use client");
    expect(src).toContain("Mappa Opportunità");
    expect(src).toContain("/api/map");
    expect(src).toContain("function MapView");
    expect(src).toMatch(/export default function/);
  });
});
