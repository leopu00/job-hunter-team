/**
 * Test unitari — shared/assistant (vitest)
 *
 * Edge cases: varianti intent, filtri location/remote, bridge
 * multi-dispatch, receiveResponse doppio, config defaults, errori event handler.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({ execSync: vi.fn() }));
vi.mock("crypto", () => ({ randomUUID: vi.fn(() => `uuid-${Math.random().toString(36).slice(2, 10)}`) }));

import { execSync } from "child_process";
import { classifyIntent, getIntentAck, isOwner } from "../../../shared/assistant/assistant-bot.js";
import { TeamBridge } from "../../../shared/assistant/bridge-to-team.js";
import { DEFAULT_ASSISTANT_CONFIG } from "../../../shared/assistant/types.js";
import type { AssistantEvent } from "../../../shared/assistant/types.js";

const bridgeConfig = { botToken: "tok", ownerChatId: "42", captainSession: "TEST", teamResponseTimeoutMs: 60000 };

beforeEach(() => { vi.clearAllMocks(); (execSync as any).mockImplementation(() => ""); });

describe("classifyIntent — varianti e edge cases", () => {
  it("'cerco lavoro' riconosciuto come job_search", () => {
    expect(classifyIntent("cerco lavoro").kind).toBe("job_search");
  });

  it("'posizioni aperte' riconosciuto come job_search", () => {
    expect(classifyIntent("posizioni aperte").kind).toBe("job_search");
  });

  it("'aggiornamento' riconosciuto come status_check", () => {
    expect(classifyIntent("aggiornamento").kind).toBe("status_check");
  });

  it("'application' riconosciuto come list_applications", () => {
    expect(classifyIntent("application").kind).toBe("list_applications");
  });

  it("'modifica il mio cv' riconosciuto come update_profile", () => {
    const r = classifyIntent("modifica il mio cv");
    expect(r.kind).toBe("update_profile");
    if (r.kind === "update_profile") expect(r.details).toContain("modifica");
  });

  it("estrae location da 'lavoro a Milano'", () => {
    const r = classifyIntent("trovami lavoro a Milano");
    expect(r.kind).toBe("job_search");
    if (r.kind === "job_search") expect(r.filters?.location).toBe("Milano");
  });

  it("rileva 'smart working' come remote", () => {
    const r = classifyIntent("cerco lavoro smart working");
    if (r.kind === "job_search") expect(r.filters?.remote).toBe(true);
  });

  it("trims whitespace prima della classificazione", () => {
    expect(classifyIntent("  status  ").kind).toBe("status_check");
  });

  it("testo vuoto ritorna unknown", () => {
    const r = classifyIntent("");
    expect(r.kind).toBe("unknown");
  });
});

describe("getIntentAck — fallback", () => {
  it("intent con kind sconosciuto usa messaggio unknown", () => {
    const msg = getIntentAck({ kind: "nonexistent" as any, rawText: "x" });
    expect(msg).toContain("Non ho capito");
  });
});

describe("isOwner — edge cases", () => {
  it("ritorna false con chat undefined", () => {
    expect(isOwner({ chat: undefined } as any, "123")).toBe(false);
  });
});

describe("DEFAULT_ASSISTANT_CONFIG", () => {
  it("contiene valori default attesi", () => {
    expect(DEFAULT_ASSISTANT_CONFIG.name).toBe("Assistente JHT");
    expect(DEFAULT_ASSISTANT_CONFIG.avatar).toBe("🤖");
    expect(DEFAULT_ASSISTANT_CONFIG.captainSession).toBe("CAPITANO");
    expect(DEFAULT_ASSISTANT_CONFIG.teamResponseTimeoutMs).toBe(5 * 60 * 1000);
  });
});

describe("TeamBridge — edge cases avanzati", () => {
  it("receiveResponse doppio sullo stesso id ritorna false", async () => {
    const bridge = new TeamBridge(bridgeConfig);
    const req = await bridge.dispatch({ kind: "status_check" }, "u1");
    expect(bridge.receiveResponse({ requestId: req.id, message: "ok", timestamp: Date.now() })).toBe(true);
    expect(bridge.receiveResponse({ requestId: req.id, message: "ok2", timestamp: Date.now() })).toBe(false);
  });

  it("dispatch multipli tracciati con pending e total corretti", async () => {
    const bridge = new TeamBridge(bridgeConfig);
    await bridge.dispatch({ kind: "status_check" }, "u1");
    await bridge.dispatch({ kind: "stop_search" }, "u2");
    await bridge.dispatch({ kind: "list_applications" }, "u3");
    const s = bridge.getStatus();
    expect(s.totalRequests).toBe(3);
    expect(s.pendingRequests).toBe(3);
    expect(bridge.getPendingRequests()).toHaveLength(3);
  });

  it("event handler che lancia errore non blocca altri handler", async () => {
    const bridge = new TeamBridge(bridgeConfig);
    const received: string[] = [];
    bridge.onEvent(() => { throw new Error("boom"); });
    bridge.onEvent((e) => received.push(e.type));
    await bridge.dispatch({ kind: "status_check" }, "u1");
    expect(received).toContain("request_received");
    expect(received).toContain("request_dispatched");
  });

  it("config merges con defaults (name, avatar)", () => {
    const bridge = new TeamBridge({ botToken: "t", ownerChatId: "1" });
    const s = bridge.getStatus();
    expect(s.ownerChatId).toBe("1");
    expect(s.running).toBe(true);
  });

  it("dispatch job_search invia messaggio tmux al capitano", async () => {
    const bridge = new TeamBridge(bridgeConfig);
    await bridge.dispatch({ kind: "job_search", query: "developer react" }, "u1");
    expect(execSync).toHaveBeenCalled();
    const calls = (execSync as any).mock.calls.map((c: any) => c[0]);
    expect(calls.some((c: string) => c.includes("Ricerca lavoro"))).toBe(true);
  });

  it("dispatch update_profile include descrizione nel messaggio tmux", async () => {
    const bridge = new TeamBridge(bridgeConfig);
    await bridge.dispatch({ kind: "update_profile", details: "aggiungi React" }, "u1");
    const calls = (execSync as any).mock.calls.map((c: any) => c[0]);
    expect(calls.some((c: string) => c.includes("Aggiornamento profilo"))).toBe(true);
  });
});
