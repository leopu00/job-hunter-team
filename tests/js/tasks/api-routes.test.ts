/**
 * Test integrazione — API routes web (vitest)
 *
 * GET/POST per /api/agents, /api/tasks, /api/sessions,
 * /api/analytics, /api/queue, /api/health.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextRequest: class extends Request {
    nextUrl: URL;
    constructor(u: string | URL, init?: RequestInit) {
      super(u, init);
      this.nextUrl = new URL(typeof u === "string" ? u : u.toString());
    }
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
  },
}));
vi.mock("node:fs");
vi.mock("child_process");

import * as fs from "node:fs";
import * as cp from "child_process";

function mockRead(data: unknown) { vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(data)); }
function mockEnoent() { vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error(), { code: "ENOENT" }); }); }
function mockWrite() { vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any); vi.mocked(fs.writeFileSync).mockReturnValue(undefined); vi.mocked(fs.renameSync).mockReturnValue(undefined); }
function mkReq(path: string, body?: unknown): any {
  const init: RequestInit | undefined = body
    ? { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }
    : undefined;
  const r = new Request(`http://localhost${path}`, init);
  return Object.assign(r, { nextUrl: new URL(`http://localhost${path}`) });
}

beforeEach(() => { vi.clearAllMocks(); mockWrite(); });

describe("/api/agents", () => {
  it("GET ritorna lista agenti con status stopped", async () => {
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error(); });
    const { GET } = await import("../../../web/app/api/agents/route");
    const data = await (await GET()).json();
    expect(data.agents).toBeDefined();
    expect(data.agents.length).toBeGreaterThan(0);
    expect(data.agents.every((a: any) => a.status === "stopped")).toBe(true);
  });

  it("POST senza body ritorna 400", async () => {
    const { POST } = await import("../../../web/app/api/agents/route");
    const r = mkReq("/api/agents");
    r.json = async () => { throw new Error("no body"); };
    expect((await POST(r)).status).toBe(400);
  });

  it("POST action invalida ritorna 400", async () => {
    const { POST } = await import("../../../web/app/api/agents/route");
    const res = await POST(mkReq("/api/agents", { agentId: "alfa", action: "restart" }));
    expect(res.status).toBe(400);
  });

  it("POST agente sconosciuto ritorna 404", async () => {
    const { POST } = await import("../../../web/app/api/agents/route");
    const res = await POST(mkReq("/api/agents", { agentId: "unknown", action: "start" }));
    expect(res.status).toBe(404);
  });
});

describe("/api/tasks", () => {
  it("GET ritorna tasks da store", async () => {
    mockRead({ version: 1, updatedAt: 0, tasks: [{ taskId: "t1", status: "queued", task: "test", createdAt: Date.now(), runtime: "cli", ownerKey: "web" }] });
    const { GET } = await import("../../../web/app/api/tasks/route");
    const data = await (await GET(mkReq("/api/tasks"))).json();
    expect(data.tasks).toHaveLength(1);
    expect(data.total).toBe(1);
  });

  it("GET con filtro status=running filtra correttamente", async () => {
    mockRead({ version: 1, updatedAt: 0, tasks: [
      { taskId: "t1", status: "queued", task: "a", createdAt: 1, runtime: "cli", ownerKey: "w" },
      { taskId: "t2", status: "running", task: "b", createdAt: 2, runtime: "cli", ownerKey: "w" },
    ] });
    const { GET } = await import("../../../web/app/api/tasks/route");
    const data = await (await GET(mkReq("/api/tasks?status=running"))).json();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].taskId).toBe("t2");
  });

  it("POST crea task e ritorna 201", async () => {
    mockRead({ version: 1, updatedAt: 0, tasks: [] });
    const { POST } = await import("../../../web/app/api/tasks/route");
    const res = await POST(mkReq("/api/tasks", { task: "nuovo task" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.task.task).toBe("nuovo task");
    expect(data.task.status).toBe("queued");
  });

  it("POST senza task ritorna 400", async () => {
    const { POST } = await import("../../../web/app/api/tasks/route");
    const res = await POST(mkReq("/api/tasks", {}));
    expect(res.status).toBe(400);
  });
});

describe("/api/sessions", () => {
  it("GET ritorna sessioni da store", async () => {
    mockRead({ version: 1, sessions: [{ id: "s1", channelId: "web", state: "active", chatType: "direct", createdAtMs: 1, updatedAtMs: 1, messageCount: 0 }] });
    const { GET } = await import("../../../web/app/api/sessions/route");
    const data = await (await GET(mkReq("/api/sessions"))).json();
    expect(data.sessions).toHaveLength(1);
  });

  it("GET con filtro state=ended", async () => {
    mockRead({ version: 1, sessions: [
      { id: "s1", state: "active", channelId: "web", chatType: "direct", createdAtMs: 1, updatedAtMs: 1, messageCount: 0 },
      { id: "s2", state: "ended", channelId: "web", chatType: "direct", createdAtMs: 2, updatedAtMs: 2, messageCount: 5 },
    ] });
    const { GET } = await import("../../../web/app/api/sessions/route");
    const data = await (await GET(mkReq("/api/sessions?state=ended"))).json();
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].id).toBe("s2");
  });

  it("POST crea sessione e ritorna 201", async () => {
    mockRead({ version: 1, sessions: [] });
    const { POST } = await import("../../../web/app/api/sessions/route");
    const res = await POST(mkReq("/api/sessions", { channelId: "telegram" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.session.channelId).toBe("telegram");
    expect(data.session.state).toBe("active");
  });

  it("DELETE senza id ritorna 400", async () => {
    const { DELETE } = await import("../../../web/app/api/sessions/route");
    const res = await DELETE(mkReq("/api/sessions"));
    expect(res.status).toBe(400);
  });
});

describe("/api/analytics", () => {
  it("GET ritorna summary con totalCalls", async () => {
    mockRead({ version: 1, updatedAt: 0, entries: [
      { id: "a1", provider: "claude", model: "opus", tokens: { input: 10, output: 5, total: 15 }, latencyMs: 100, costUsd: 0.01, timestamp: Date.now(), success: true },
    ] });
    const { GET } = await import("../../../web/app/api/analytics/route");
    const data = await (await GET(mkReq("/api/analytics"))).json();
    expect(data.totalCalls).toBe(1);
    expect(data.totalTokens).toBe(15);
  });

  it("POST crea entry e ritorna 201", async () => {
    mockRead({ version: 1, updatedAt: 0, entries: [] });
    const { POST } = await import("../../../web/app/api/analytics/route");
    const res = await POST(mkReq("/api/analytics", {
      provider: "claude", model: "opus", tokens: { input: 10, output: 5, total: 15 },
    }));
    expect(res.status).toBe(201);
  });

  it("POST senza campi obbligatori ritorna 400", async () => {
    const { POST } = await import("../../../web/app/api/analytics/route");
    const res = await POST(mkReq("/api/analytics", { provider: "claude" }));
    expect(res.status).toBe(400);
  });
});

describe("/api/queue", () => {
  it("GET ritorna stato queue con stats", async () => {
    mockRead({ version: 1, updatedAt: 0, stats: { queued: 2, running: 1, succeeded: 10, failed: 0, dead: 0, totalProcessed: 13 }, pending: [], running: [], completed: [], deadLetter: [] });
    const { GET } = await import("../../../web/app/api/queue/route");
    const data = await (await GET(mkReq("/api/queue"))).json();
    expect(data.stats.queued).toBe(2);
    expect(data.stats.totalProcessed).toBe(13);
  });

  it("POST clear-dlq svuota dead letter", async () => {
    mockRead({ version: 1, updatedAt: 0, stats: { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 2, totalProcessed: 0 }, pending: [], running: [], completed: [], deadLetter: [{ id: "j1" }, { id: "j2" }] });
    const { POST } = await import("../../../web/app/api/queue/route");
    const data = await (await POST(mkReq("/api/queue", { action: "clear-dlq" }))).json();
    expect(data.ok).toBe(true);
    expect(data.cleared).toBe(2);
  });

  it("POST action invalida ritorna 400", async () => {
    mockRead({ version: 1, updatedAt: 0, stats: {}, pending: [], running: [], completed: [], deadLetter: [] });
    const { POST } = await import("../../../web/app/api/queue/route");
    const res = await POST(mkReq("/api/queue", { action: "nope" }));
    expect(res.status).toBe(400);
  });
});

