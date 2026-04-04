/** Test unitari — shared/deploy (vitest): health check HTTP, tmux detection, monitor parsing. */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({ execSync: vi.fn() }));
vi.mock("node:child_process", () => ({ execSync: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));
vi.mock("node:os", () => ({ homedir: () => "/mock-home" }));

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

describe("health-check — checkAll", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("servizi raggiungibili ritornano ok=true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.mocked(execSync).mockReturnValue("JHT-BOT\n" as any);
    const { checkAll } = await import("../../../shared/deploy/health-check.js");
    const report = await checkAll({ timeoutMs: 2000 });
    expect(report.ok).toBe(true);
    expect(report.services).toHaveLength(3);
    expect(report.services.every(s => s.ok)).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    vi.unstubAllGlobals();
  });

  it("HTTP 500 ritorna status error per il servizio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500 }));
    vi.mocked(execSync).mockReturnValue("JHT-TELEGRAM\n" as any);
    const { checkAll } = await import("../../../shared/deploy/health-check.js");
    const report = await checkAll();
    const web = report.services.find(s => s.name === "web")!;
    expect(web.ok).toBe(false);
    expect(web.status).toBe("error");
    expect(web.httpStatus).toBe(500);
    expect(report.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it("fetch che lancia errore ritorna status error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    vi.mocked(execSync).mockReturnValue("" as any);
    const { checkAll } = await import("../../../shared/deploy/health-check.js");
    const report = await checkAll({ timeoutMs: 1000 });
    const web = report.services.find(s => s.name === "web")!;
    expect(web.ok).toBe(false);
    expect(web.error).toContain("ECONNREFUSED");
    vi.unstubAllGlobals();
  });

  it("AbortError classificato come timeout", async () => {
    const abortErr = new DOMException("signal timed out", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    vi.mocked(execSync).mockReturnValue("" as any);
    const { checkAll } = await import("../../../shared/deploy/health-check.js");
    const report = await checkAll({ timeoutMs: 100 });
    const web = report.services.find(s => s.name === "web")!;
    expect(web.status).toBe("timeout");
    expect(web.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it("HTTP 404 considerato ok (< 500)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    vi.mocked(execSync).mockReturnValue("JHT-BOT\n" as any);
    const { checkAll } = await import("../../../shared/deploy/health-check.js");
    const report = await checkAll();
    const web = report.services.find(s => s.name === "web")!;
    expect(web.ok).toBe(true);
    expect(web.httpStatus).toBe(404);
    vi.unstubAllGlobals();
  });

  it("nessuna sessione tmux telegram → servizio error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.mocked(execSync).mockReturnValue("JHT-COORD\nJHT-BACKEND\n" as any);
    const { checkAll } = await import("../../../shared/deploy/health-check.js");
    const report = await checkAll();
    const tg = report.services.find(s => s.name === "telegram")!;
    expect(tg.ok).toBe(false);
    expect(tg.error).toContain("Nessuna sessione");
    vi.unstubAllGlobals();
  });

  it("sessione JHT-BRIDGE riconosciuta come telegram attivo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.mocked(execSync).mockReturnValue("JHT-BRIDGE\n" as any);
    const { checkAll } = await import("../../../shared/deploy/health-check.js");
    const report = await checkAll();
    const tg = report.services.find(s => s.name === "telegram")!;
    expect(tg.ok).toBe(true);
    vi.unstubAllGlobals();
  });

  it("report contiene timestamp e durationMs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.mocked(execSync).mockReturnValue("" as any);
    const { checkAll } = await import("../../../shared/deploy/health-check.js");
    const before = Date.now();
    const report = await checkAll();
    expect(report.ts).toBeGreaterThanOrEqual(before);
    expect(typeof report.durationMs).toBe("number");
    vi.unstubAllGlobals();
  });
});

describe("monitor — buildReport e parsing", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("forum vuoto ritorna entries vuote", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockReturnValue("" as any);
    const { buildReport } = await import("../../../shared/deploy/monitor.js");
    const report = buildReport({});
    expect(report.entries).toHaveLength(0);
    expect(report.errorCount).toBe(0);
    expect(report.warnCount).toBe(0);
  });

  it("parsea righe forum con formato [ts] [agent] messaggio", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "[2026-04-01 10:00:00] [Gus] checkpoint API pronta\n[2026-04-01 10:01:00] [Dot] pagina completata\n"
    );
    vi.mocked(execSync).mockReturnValue("" as any);
    const { buildReport } = await import("../../../shared/deploy/monitor.js");
    const report = buildReport({ tail: 10 });
    expect(report.entries).toHaveLength(2);
    expect(report.entries[0].agent).toBe("Gus");
    expect(report.entries[1].agent).toBe("Dot");
  });

  it("classifica [URG] come error e 'attenzione' come warn", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(execSync).mockReturnValue("" as any);
    vi.mocked(readFileSync).mockReturnValue("[2026-04-01 10:00:00] [Ace] [URG] deploy fallito\n");
    const { buildReport } = await import("../../../shared/deploy/monitor.js");
    expect(buildReport({}).entries[0].level).toBe("error");
    vi.mocked(readFileSync).mockReturnValue("[2026-04-01 10:00:00] [Tom] attenzione: disco quasi pieno\n");
    const r2 = buildReport({});
    expect(r2.entries[0].level).toBe("warn");
    expect(r2.warnCount).toBe(1);
  });

  it("filtro agentFilter seleziona solo l'agente richiesto", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "[2026-04-01 10:00:00] [Gus] msg1\n[2026-04-01 10:01:00] [Dot] msg2\n[2026-04-01 10:02:00] [Gus] msg3\n"
    );
    vi.mocked(execSync).mockReturnValue("" as any);
    const { buildReport } = await import("../../../shared/deploy/monitor.js");
    const report = buildReport({ agentFilter: "Gus" });
    expect(report.entries).toHaveLength(2);
    expect(report.entries.every((e: any) => e.agent === "Gus")).toBe(true);
  });

  it("tail limita le righe lette", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `[2026-04-01 10:${String(i).padStart(2, "0")}:00] [Bot] msg${i}`).join("\n");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(lines);
    vi.mocked(execSync).mockReturnValue("" as any);
    const { buildReport } = await import("../../../shared/deploy/monitor.js");
    const report = buildReport({ tail: 5 });
    expect(report.entries.length).toBeLessThanOrEqual(5);
  });

  it("listActiveSessions rileva sessioni JHT-*", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockReturnValue("JHT-COORD\nJHT-BACKEND\nALTRA\n" as any);
    const { buildReport } = await import("../../../shared/deploy/monitor.js");
    const report = buildReport({});
    expect(report.agents).toHaveLength(2);
    expect(report.agents[0].session).toBe("JHT-COORD");
    expect(report.agents[1].session).toBe("JHT-BACKEND");
  });

  it("execSync fallita ritorna agents vuoto e report ha ts numerico", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockImplementation(() => { throw new Error("tmux not found"); });
    const { buildReport } = await import("../../../shared/deploy/monitor.js");
    const report = buildReport({});
    expect(report.agents).toHaveLength(0);
    expect(typeof report.ts).toBe("number");
    expect(report.ts).toBeGreaterThan(0);
  });
});
