/** Test unitari — shared/events + shared/history (vitest): pub/sub avanzato, transcript JSONL. */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("node:os", () => ({ homedir: () => "/mock-home" }));

import * as fs from "node:fs";
import { EventBus } from "../../../shared/events/event-bus.js";
import { DEFAULT_HISTORY_CONFIG, createTranscriptHeader, createHistoryMessage } from "../../../shared/history/types.js";

// --- Events: edge cases avanzati ---

describe("EventBus — edge cases avanzati", () => {
  let bus: EventBus;
  beforeEach(() => { bus = new EventBus("test-adv"); bus.resetForTest(); });

  it("emit senza runId usa default e incrementa seq", () => {
    const seqs: number[] = [];
    bus.on((e) => seqs.push(e.seq));
    bus.emit({ stream: "lifecycle", data: {} });
    bus.emit({ stream: "lifecycle", data: {} });
    expect(seqs).toEqual([1, 2]);
  });

  it("registerRunContext merge: secondo call aggiorna campi", () => {
    bus.registerRunContext("r1", { sessionId: "s1" });
    bus.registerRunContext("r1", { agentId: "a1" });
    const ctx = bus.getRunContext("r1");
    expect(ctx?.sessionId).toBe("s1");
    expect(ctx?.agentId).toBe("a1");
  });

  it("emit arricchisce sessionId/agentId da runContext registrato", () => {
    bus.registerRunContext("r1", { sessionId: "sess-x", agentId: "agent-y" });
    let event: any;
    bus.on((e) => (event = e));
    bus.emit({ stream: "tool", data: {}, runId: "r1" });
    expect(event.sessionId).toBe("sess-x");
    expect(event.agentId).toBe("agent-y");
  });

  it("clearRunContext resetta seq — nuovo emit riparte da 1", () => {
    bus.emit({ stream: "lifecycle", data: {}, runId: "r1" });
    bus.emit({ stream: "lifecycle", data: {}, runId: "r1" });
    bus.clearRunContext("r1");
    const seqs: number[] = [];
    bus.on((e) => seqs.push(e.seq));
    bus.emit({ stream: "lifecycle", data: {}, runId: "r1" });
    expect(seqs[0]).toBe(1);
  });

  it("unsub di un listener non impatta gli altri", () => {
    const r1: string[] = [], r2: string[] = [];
    const unsub1 = bus.on(() => r1.push("a"));
    bus.on(() => r2.push("b"));
    unsub1();
    bus.emit({ stream: "lifecycle", data: {} });
    expect(r1).toHaveLength(0);
    expect(r2).toHaveLength(1);
  });

  it("doppia unsub non crasha", () => {
    const unsub = bus.on(() => {});
    unsub();
    expect(() => unsub()).not.toThrow();
    expect(bus.listenerCount).toBe(0);
  });

  it("emit con stream custom funziona", () => {
    let received: any;
    bus.on((e) => (received = e));
    bus.emit({ stream: "custom-deploy", data: { x: 1 } });
    expect(received.stream).toBe("custom-deploy");
  });

  it("emit sessionId esplicito sovrascrive runContext", () => {
    bus.registerRunContext("r1", { sessionId: "from-ctx" });
    let event: any;
    bus.on((e) => (event = e));
    bus.emit({ stream: "lifecycle", data: {}, runId: "r1", sessionId: "explicit" });
    expect(event.sessionId).toBe("explicit");
  });

  it("getRunContext ritorna undefined per run non registrato", () => {
    expect(bus.getRunContext("non-esiste")).toBeUndefined();
  });
});

// --- History transcript JSONL ---

describe("history/transcript — JSONL persistence", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("resolveTranscriptPath sanitizza caratteri speciali", async () => {
    const { resolveTranscriptPath } = await import("../../../shared/history/transcript.js");
    const p = resolveTranscriptPath("sess/weird:chars!");
    expect(p).toContain("sess_weird_chars_");
    expect(p).toContain(".jsonl");
  });

  it("resolveBaseDir usa default o config.baseDir", async () => {
    const { resolveBaseDir } = await import("../../../shared/history/transcript.js");
    expect(resolveBaseDir()).toContain("history");
    expect(resolveBaseDir({ baseDir: "/custom/dir" })).toBe("/custom/dir");
  });

  it("ensureTranscriptFile crea directory e scrive header JSONL", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    const { ensureTranscriptFile } = await import("../../../shared/history/transcript.js");
    ensureTranscriptFile("sess-1");
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalled();
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const header = JSON.parse(written.trim());
    expect(header.type).toBe("session");
    expect(header.sessionId).toBe("sess-1");
  });

  it("loadTranscript file inesistente ritorna vuoto", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { loadTranscript } = await import("../../../shared/history/transcript.js");
    const data = loadTranscript("nope");
    expect(data.header).toBeNull();
    expect(data.messages).toHaveLength(0);
    expect(data.lineCount).toBe(0);
  });

  it("loadTranscript parsea header + messaggi JSONL", async () => {
    const header = JSON.stringify({ type: "session", version: "1.0.0", sessionId: "s1", timestamp: 1 });
    const msg = JSON.stringify({ id: "m1", message: { role: "user", content: "ciao", timestamp: 1 } });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`${header}\n${msg}\n`);
    const { loadTranscript } = await import("../../../shared/history/transcript.js");
    const data = loadTranscript("s1");
    expect(data.header?.sessionId).toBe("s1");
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].content).toBe("ciao");
    expect(data.lineCount).toBe(2);
  });

  it("loadTranscript salta righe malformate senza errore", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('not json\n{"id":"m1","message":{"role":"user","content":"ok","timestamp":1}}\n');
    const { loadTranscript } = await import("../../../shared/history/transcript.js");
    const data = loadTranscript("s1");
    expect(data.messages).toHaveLength(1);
  });

  it("archiveTranscript rinomina il file e ritorna true", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    const { archiveTranscript } = await import("../../../shared/history/transcript.js");
    expect(archiveTranscript("s1")).toBe(true);
    expect(fs.renameSync).toHaveBeenCalled();
    const dest = vi.mocked(fs.renameSync).mock.calls[0][1] as string;
    expect(dest).toContain(".archived.");
  });

  it("archiveTranscript file inesistente ritorna false, deleteTranscript rimuove", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { archiveTranscript, deleteTranscript } = await import("../../../shared/history/transcript.js");
    expect(archiveTranscript("nope")).toBe(false);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
    expect(deleteTranscript("s1")).toBe(true);
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it("listTranscriptSessionIds filtra .jsonl non archived", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(["a.jsonl", "b.jsonl.archived.123", "c.jsonl", "d.txt"] as any);
    const { listTranscriptSessionIds } = await import("../../../shared/history/transcript.js");
    const ids = listTranscriptSessionIds();
    expect(ids).toEqual(["a", "c"]);
  });

  it("listTranscriptSessionIds directory mancante ritorna vuoto", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { listTranscriptSessionIds } = await import("../../../shared/history/transcript.js");
    expect(listTranscriptSessionIds()).toEqual([]);
  });

  it("DEFAULT_HISTORY_CONFIG, createTranscriptHeader, createHistoryMessage", () => {
    expect(DEFAULT_HISTORY_CONFIG.maxMessages).toBe(0);
    expect(DEFAULT_HISTORY_CONFIG.maxBytes).toBe(0);
    const h = createTranscriptHeader("test-sess", "/cwd");
    expect(h.type).toBe("session");
    expect(h.sessionId).toBe("test-sess");
    const m = createHistoryMessage("assistant", "risposta");
    expect(m.id).toBeTruthy();
    expect(m.role).toBe("assistant");
  });
});
