/** Test E2E batch 11 — /export, /archive, /timeline, /map, /feedback, /recommendations */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

vi.mock("next/server", () => {
  class NR extends Response {
    static json(d: unknown, i?: ResponseInit) {
      return new Response(JSON.stringify(d), { ...i, headers: { "content-type": "application/json", ...(i?.headers as Record<string, string>) } });
    }
  }
  return { NextRequest: Request, NextResponse: NR };
});

function req(u: string) { return new Request(u); }
function nreq(u: string) { const r = req(u); (r as any).nextUrl = new URL(u); return r; }
const json = (r: Response) => r.json();

/* ── /export ── */
describe("/export", () => {
  it("API GET senza source → 400 + error", async () => {
    const { GET } = await import("../../../web/app/api/export/route");
    const res = await GET(nreq("http://h/api/export") as any);
    expect(res.status).toBe(400);
    const d = await json(res);
    expect(d.error).toBeDefined();
  });
  it("API GET source=tasks format=json → 200 json", async () => {
    const { GET } = await import("../../../web/app/api/export/route");
    const res = await GET(nreq("http://h/api/export?source=tasks&format=json") as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("json");
  });
  it("pagina: ExportPage + SOURCES 8 sorgenti + Esporta Dati", () => {
    const s = readSrc("app/export/page.tsx");
    expect(s).toContain("'use client'");
    expect(s).toMatch(/export default function ExportPage/);
    expect(s).toContain("Esporta Dati");
    expect(s).toContain("SOURCES");
    expect(s).toContain("doExport");
  });
});

/* ── /archive ── */
describe("/archive", () => {
  it("API GET → archive + total + counts (rejected/expired/withdrawn)", async () => {
    const { GET } = await import("../../../web/app/api/archive/route");
    const res = await GET(req("http://h/api/archive"));
    expect(res.status).toBe(200);
    const d = await json(res);
    expect(d).toHaveProperty("archive");
    expect(d).toHaveProperty("total");
    expect(d.counts).toHaveProperty("rejected");
    expect(d.counts).toHaveProperty("expired");
    expect(d.counts).toHaveProperty("withdrawn");
  });
  it("API GET reason=rejected → tutti rejected", async () => {
    const { GET } = await import("../../../web/app/api/archive/route");
    const res = await GET(req("http://h/api/archive?reason=rejected"));
    const d = await json(res);
    for (const a of d.archive) expect(a.reason).toBe("rejected");
  });
  it("pagina: ArchivePage + REASON_CFG + bulkDelete + exportCsv", () => {
    const s = readSrc("app/archive/page.tsx");
    expect(s).toContain("'use client'");
    expect(s).toMatch(/export default function ArchivePage/);
    expect(s).toContain("Archivio");
    expect(s).toContain("REASON_CFG");
    expect(s).toContain("bulkDelete");
    expect(s).toContain("exportCsv");
  });
});

/* ── /timeline ── */
describe("/timeline", () => {
  it("API GET → events + total + types 6 tipi evento", async () => {
    const { GET } = await import("../../../web/app/api/timeline/route");
    const res = await GET(req("http://h/api/timeline?days=90"));
    expect(res.status).toBe(200);
    const d = await json(res);
    expect(d).toHaveProperty("events");
    expect(d).toHaveProperty("total");
    expect(d.types).toContain("application");
    expect(d.types).toContain("interview");
  });
  it("API GET type=offer → filtra per tipo", async () => {
    const { GET } = await import("../../../web/app/api/timeline/route");
    const res = await GET(req("http://h/api/timeline?days=90&type=offer"));
    const d = await json(res);
    for (const e of d.events) expect(e.type).toBe("offer");
  });
  it("pagina: TimelinePage + TYPE_CFG + groupByDate + compact", () => {
    const s = readSrc("app/timeline/page.tsx");
    expect(s).toContain("'use client'");
    expect(s).toMatch(/export default function TimelinePage/);
    expect(s).toContain("TYPE_CFG");
    expect(s).toContain("groupByDate");
    expect(s).toContain("compact");
  });
});

/* ── /map ── */
describe("/map", () => {
  it("API GET → clusters + totalJobs + areas (Nord/Centro/Sud/Remoto)", async () => {
    const { GET } = await import("../../../web/app/api/map/route");
    const res = await GET(req("http://h/api/map"));
    expect(res.status).toBe(200);
    const d = await json(res);
    expect(d.clusters.length).toBeGreaterThan(0);
    expect(d).toHaveProperty("totalJobs");
    expect(d.areas).toContain("Nord");
  });
  it("API GET location=Nord → solo cluster Nord", async () => {
    const { GET } = await import("../../../web/app/api/map/route");
    const d = await json(await GET(req("http://h/api/map?location=Nord")));
    for (const c of d.clusters) expect(c.area).toBe("Nord");
  });
  it("pagina: MapPage + MapView SVG + Mappa Opportunità", () => {
    const s = readSrc("app/map/page.tsx");
    expect(s).toContain("'use client'");
    expect(s).toMatch(/export default function MapPage/);
    expect(s).toContain("MapView");
    expect(s).toContain("Mappa Opportun");
  });
});

/* ── /feedback ── */
describe("/feedback", () => {
  it("API GET → feedback + summary (open/inProgress/resolved)", async () => {
    const { GET } = await import("../../../web/app/api/feedback/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const d = await json(res);
    expect(d).toHaveProperty("feedback");
    expect(d.summary).toHaveProperty("open");
    expect(d.summary).toHaveProperty("inProgress");
    expect(d.summary).toHaveProperty("resolved");
  });
  it("API POST rating+description → nuovo feedback con id", async () => {
    const { POST } = await import("../../../web/app/api/feedback/route");
    const res = await POST(new Request("http://h/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: 4, category: "feature", description: "Test" }) }));
    expect(res.status).toBe(200);
    const d = await json(res);
    expect(d.feedback).toHaveProperty("id");
    expect(d.feedback.rating).toBe(4);
  });
  it("pagina: FeedbackPage + CAT_CFG + STATUS_CFG + Stars + timeAgo", () => {
    const s = readSrc("app/feedback/page.tsx");
    expect(s).toContain("'use client'");
    expect(s).toMatch(/export default function FeedbackPage/);
    expect(s).toContain("CAT_CFG");
    expect(s).toContain("STATUS_CFG");
    expect(s).toContain("function Stars");
    expect(s).toContain("function timeAgo");
  });
});

/* ── /recommendations ── */
describe("/recommendations", () => {
  it("API GET → jobs + companies + actions + updatedAt", async () => {
    const { GET } = await import("../../../web/app/api/recommendations/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const d = await json(res);
    expect(d.jobs.length).toBeGreaterThan(0);
    expect(d.companies.length).toBeGreaterThan(0);
    expect(d.actions.length).toBeGreaterThan(0);
    expect(d).toHaveProperty("updatedAt");
  });
  it("API GET → job con score/salary/remote, action con priority", async () => {
    const { GET } = await import("../../../web/app/api/recommendations/route");
    const d = await json(await GET());
    expect(d.jobs[0]).toHaveProperty("score");
    expect(d.jobs[0]).toHaveProperty("salary");
    expect(d.actions[0]).toHaveProperty("priority");
  });
  it("pagina: RecommendationsPage + PRIO_CFG + ScoreBadge + Raccomandazioni AI", () => {
    const s = readSrc("app/recommendations/page.tsx");
    expect(s).toContain("'use client'");
    expect(s).toMatch(/export default function RecommendationsPage/);
    expect(s).toContain("PRIO_CFG");
    expect(s).toContain("ScoreBadge");
    expect(s).toContain("Raccomandazioni AI");
  });
});
