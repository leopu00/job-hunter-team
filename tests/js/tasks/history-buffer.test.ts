import { describe, it, expect, beforeEach } from "vitest";
import {
  appendHistoryEntry, getHistoryBuffer, clearHistoryBuffer,
  clearAllHistoryBuffers, evictOldHistoryKeys, getBufferKeyCount,
  buildHistoryContext, limitHistoryTurns, entriesToMessages,
} from "../../../shared/history/buffer.js";
import type { HistoryEntry, HistoryMessage } from "../../../shared/history/types.js";
import { createHistoryMessage, createTranscriptHeader } from "../../../shared/history/types.js";

beforeEach(() => clearAllHistoryBuffers());

function entry(sender: string, body: string, msgId?: string): HistoryEntry {
  return { sender, body, timestamp: Date.now(), messageId: msgId };
}

describe("appendHistoryEntry / getHistoryBuffer", () => {
  it("appende e recupera entry per chiave", () => {
    appendHistoryEntry("s1", entry("user", "ciao"));
    appendHistoryEntry("s1", entry("bot", "salve"));
    const buf = getHistoryBuffer("s1");
    expect(buf).toHaveLength(2);
    expect(buf[0].body).toBe("ciao");
  });

  it("dedup per messageId", () => {
    appendHistoryEntry("s1", entry("user", "hello", "msg-1"));
    appendHistoryEntry("s1", entry("user", "hello again", "msg-1"));
    expect(getHistoryBuffer("s1")).toHaveLength(1);
  });

  it("FIFO eviction quando supera maxEntries", () => {
    for (let i = 0; i < 5; i++) appendHistoryEntry("s1", entry("u", `msg-${i}`), 3);
    expect(getHistoryBuffer("s1")).toHaveLength(3);
    expect(getHistoryBuffer("s1")[0].body).toBe("msg-2");
  });

  it("ritorna array vuoto per chiave inesistente", () => {
    expect(getHistoryBuffer("nope")).toEqual([]);
  });
});

describe("clearHistoryBuffer / clearAllHistoryBuffers", () => {
  it("svuota buffer per chiave specifica", () => {
    appendHistoryEntry("s1", entry("u", "a"));
    appendHistoryEntry("s2", entry("u", "b"));
    clearHistoryBuffer("s1");
    expect(getHistoryBuffer("s1")).toHaveLength(0);
    expect(getHistoryBuffer("s2")).toHaveLength(1);
  });

  it("svuota tutti i buffer", () => {
    appendHistoryEntry("s1", entry("u", "a"));
    appendHistoryEntry("s2", entry("u", "b"));
    clearAllHistoryBuffers();
    expect(getBufferKeyCount()).toBe(0);
  });
});

describe("evictOldHistoryKeys", () => {
  it("rimuove chiavi più vecchie se supera maxKeys", () => {
    for (let i = 0; i < 10; i++) appendHistoryEntry(`k${i}`, entry("u", "m"));
    const removed = evictOldHistoryKeys(5);
    expect(removed).toBe(5);
    expect(getBufferKeyCount()).toBe(5);
  });

  it("non rimuove nulla se sotto il limite", () => {
    appendHistoryEntry("k1", entry("u", "m"));
    expect(evictOldHistoryKeys(10)).toBe(0);
  });
});

describe("buildHistoryContext", () => {
  it("costruisce contesto formattato per prompt", () => {
    const entries = [entry("Max", "pronto"), entry("Ace", "vai")];
    const ctx = buildHistoryContext(entries);
    expect(ctx).toContain("Max: pronto");
    expect(ctx).toContain("Ace: vai");
    expect(ctx).toContain("[Messaggi recenti");
  });

  it("ritorna stringa vuota per lista vuota", () => {
    expect(buildHistoryContext([])).toBe("");
  });
});

describe("limitHistoryTurns", () => {
  it("limita a N turni utente mantenendo system prompt", () => {
    const msgs: HistoryMessage[] = [
      createHistoryMessage("system", "Sei un assistente"),
      createHistoryMessage("user", "ciao"),
      createHistoryMessage("assistant", "salve"),
      createHistoryMessage("user", "aiutami"),
      createHistoryMessage("assistant", "certo"),
      createHistoryMessage("user", "grazie"),
      createHistoryMessage("assistant", "prego"),
    ];
    const limited = limitHistoryTurns(msgs, 2);
    expect(limited[0].role).toBe("system");
    const userMsgs = limited.filter((m) => m.role === "user");
    expect(userMsgs.length).toBeLessThanOrEqual(2);
  });

  it("ritorna vuoto con maxTurns 0", () => {
    const msgs = [createHistoryMessage("user", "ciao")];
    expect(limitHistoryTurns(msgs, 0)).toEqual([]);
  });
});

describe("entriesToMessages", () => {
  it("converte HistoryEntry in HistoryMessage", () => {
    const entries = [entry("Max", "test", "msg-1")];
    const msgs = entriesToMessages(entries);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("Max: test");
  });
});

describe("createTranscriptHeader / createHistoryMessage", () => {
  it("crea header transcript con sessione e versione", () => {
    const h = createTranscriptHeader("sess-1", "/tmp");
    expect(h.type).toBe("session");
    expect(h.sessionId).toBe("sess-1");
    expect(h.cwd).toBe("/tmp");
    expect(h.version).toBeTruthy();
  });

  it("crea messaggio history con id e timestamp", () => {
    const m = createHistoryMessage("assistant", "risposta", { model: "gpt-4o" });
    expect(m.id).toBeTruthy();
    expect(m.role).toBe("assistant");
    expect(m.content).toBe("risposta");
    expect(m.meta).toEqual({ model: "gpt-4o" });
  });
});
