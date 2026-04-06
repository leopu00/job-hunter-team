/** Test E2E vitest — API routes 200 + page rendering verification. */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  NextRequest: class extends Request {},
}));

const WEB = path.resolve(__dirname, "../../../web/app");

// --- API /api/monitoring ---

describe("API /api/monitoring — metriche e heartbeat", () => {
  beforeEach(async () => {
    const { resetMonitor, resetAlerter } = await import("../../../shared/monitoring/index.js");
    resetMonitor(); resetAlerter();
  });

  it("GET → 200 con metrics, agents, alerts", async () => {
    const { GET } = await import("../../../web/app/api/monitoring/route.js");
    const res = await GET(new Request("http://localhost/api/monitoring"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.metrics).toBeDefined();
    expect(data.metrics.cpu).toBeGreaterThanOrEqual(0);
    expect(data.metrics.memoryMb).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it("GET ?section=history → 200 con array history", async () => {
    const { GET } = await import("../../../web/app/api/monitoring/route.js");
    const res = await GET(new Request("http://localhost/api/monitoring?section=history"));
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).history)).toBe(true);
  });

  it("POST heartbeat → 200 con ok e agentId", async () => {
    const { POST } = await import("../../../web/app/api/monitoring/route.js");
    const res = await POST(new Request("http://localhost/api/monitoring", {
      method: "POST", body: JSON.stringify({ type: "heartbeat", agentId: "scout" }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST threshold → 201", async () => {
    const { POST } = await import("../../../web/app/api/monitoring/route.js");
    const res = await POST(new Request("http://localhost", {
      method: "POST", body: JSON.stringify({ type: "threshold", id: "t1", metric: "cpuUsage", operator: "gt", value: 80 }),
    }));
    expect(res.status).toBe(201);
  });

  it("POST heartbeat senza agentId → 400", async () => {
    const { POST } = await import("../../../web/app/api/monitoring/route.js");
    const res = await POST(new Request("http://localhost", {
      method: "POST", body: JSON.stringify({ type: "heartbeat" }),
    }));
    expect(res.status).toBe(400);
  });
});

// --- API /api/scheduler ---

describe("API /api/scheduler — task queue", () => {
  beforeEach(async () => {
    const { resetScheduler } = await import("../../../shared/scheduler/index.js");
    resetScheduler();
  });

  it("GET → 200 con tasks array e stats", async () => {
    const { GET } = await import("../../../web/app/api/scheduler/route.js");
    const res = await GET(new Request("http://localhost/api/scheduler"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.stats).toBeDefined();
  });

  it("POST enqueue → 201 con task creato", async () => {
    const { POST } = await import("../../../web/app/api/scheduler/route.js");
    const res = await POST(new Request("http://localhost", {
      method: "POST", body: JSON.stringify({ action: "enqueue", id: "t1", name: "test-task" }),
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe("t1");
    expect(["queued", "pending", "running"]).toContain(data.status);
  });

  it("POST cancel senza id → 400", async () => {
    const { POST } = await import("../../../web/app/api/scheduler/route.js");
    const res = await POST(new Request("http://localhost", {
      method: "POST", body: JSON.stringify({ action: "cancel" }),
    }));
    expect(res.status).toBe(400);
  });

  it("POST action invalida → 400", async () => {
    const { POST } = await import("../../../web/app/api/scheduler/route.js");
    const res = await POST(new Request("http://localhost", {
      method: "POST", body: JSON.stringify({ action: "nope" }),
    }));
    expect(res.status).toBe(400);
  });
});

// --- API /api/hooks ---

describe("API /api/hooks — discovery workspace", () => {
  it("GET senza workspace configurato → 200 con hooks vuoti e errore", async () => {
    const { GET } = await import("../../../web/app/api/hooks/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hooks).toEqual([]);
    expect(data.total).toBe(0);
  });
});

// --- API /api/backup ---

describe("API /api/backup — lista e validazione", () => {
  it("GET → 200 con backups array e count", async () => {
    const { GET } = await import("../../../web/app/api/backup/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.backups)).toBe(true);
    expect(typeof data.count).toBe("number");
    expect(typeof data.totalSize).toBe("number");
  });

  it("PATCH senza id → 400", async () => {
    const { PATCH } = await import("../../../web/app/api/backup/route.js");
    const res = await PATCH(new Request("http://localhost/api/backup"));
    expect(res.status).toBe(400);
  });

  it("DELETE senza id → 400", async () => {
    const m = await import("../../../web/app/api/backup/route.js");
    const res = await m.DELETE(new Request("http://localhost/api/backup"));
    expect(res.status).toBe(400);
  });

  it("DELETE id inesistente → 404", async () => {
    const m = await import("../../../web/app/api/backup/route.js");
    const res = await m.DELETE(new Request("http://localhost/api/backup?id=non-esiste"));
    expect(res.status).toBe(404);
  });
});

// --- API /api/settings ---

describe("API /api/settings — configurazione", () => {
  it("GET → 200 con exists e config", async () => {
    const { GET } = await import("../../../web/app/api/settings/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.exists).toBe("boolean");
  });
});

// --- Pagine: verifica contenuto e struttura ---

describe("pagine web — rendering e struttura", () => {
  const pages = [
    { route: "scheduler", file: "scheduler/page.tsx", heading: "Scheduler", fetch: "/api/scheduler" },
    { route: "hooks", file: "hooks/page.tsx", heading: "Hooks", fetch: "/api/hooks" },
    { route: "settings", file: "settings/page.tsx", heading: "Impostazioni", fetch: "/api/settings" },
    { route: "monitoring", file: "monitoring/page.tsx", heading: "Monitoring", fetch: "/api/monitoring" },
    { route: "backup", file: "backup/page.tsx", heading: "Backup", fetch: "/api/backup" },
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
