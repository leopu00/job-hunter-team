/**
 * Test unitari — Sessions (logica sessione, store helpers, tipi)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSession, pauseSession, resumeSession, endSession,
  updateSession, recordMessage, normalizeInputProvenance,
  onSessionLifecycle, onSessionTranscript,
} from "./session.js";
import {
  findSessionById, findSessionsByChannel, findActiveSessions,
  findSessionsByUser, removeSessionFromStore, addSessionToStore,
  pruneEndedSessions,
} from "./store.js";
import { looksLikeSessionId, parseSessionLabel } from "./types.js";
import type { SessionEntry, SessionStoreFile, SessionLifecycleEvent } from "./types.js";

function mockStore(...entries: SessionEntry[]): SessionStoreFile {
  return { version: 1, sessions: entries };
}

function mockEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: "s-1", channelId: "web", chatType: "direct", state: "active",
    createdAtMs: Date.now(), updatedAtMs: Date.now(), messageCount: 0,
    ...overrides,
  };
}

describe("Session Logic", () => {
  it("createSession crea sessione attiva con UUID", () => {
    const s = createSession({ channelId: "web" });
    assert.equal(s.state, "active");
    assert.ok(looksLikeSessionId(s.id));
    assert.equal(s.chatType, "direct");
    assert.equal(s.messageCount, 0);
  });

  it("createSession applica parametri opzionali", () => {
    const s = createSession({ channelId: "cli", label: "Test", provider: "openai", model: "gpt-4o" });
    assert.equal(s.label, "Test");
    assert.equal(s.provider, "openai");
    assert.equal(s.model, "gpt-4o");
    assert.equal(s.channelId, "cli");
  });

  it("pauseSession e resumeSession transizioni corrette", () => {
    const s = createSession({ channelId: "cli" });
    pauseSession(s);
    assert.equal(s.state, "paused");
    pauseSession(s); // ignora se gia paused
    assert.equal(s.state, "paused");
    resumeSession(s);
    assert.equal(s.state, "active");
    resumeSession(s); // ignora se gia active
    assert.equal(s.state, "active");
  });

  it("endSession termina da qualsiasi stato", () => {
    const s1 = createSession({ channelId: "web" });
    endSession(s1);
    assert.equal(s1.state, "ended");
    endSession(s1); // ignora se gia ended
    assert.equal(s1.state, "ended");
    const s2 = createSession({ channelId: "web" });
    pauseSession(s2);
    endSession(s2); // da paused
    assert.equal(s2.state, "ended");
  });

  it("updateSession patcha label, provider, model, context", () => {
    const s = createSession({ channelId: "web", label: "old" });
    updateSession(s, { label: "new", provider: "openai", context: { key: "val" } });
    assert.equal(s.label, "new");
    assert.equal(s.provider, "openai");
    assert.deepEqual(s.context, { key: "val" });
  });

  it("recordMessage incrementa counter e aggiorna timestamp", () => {
    const s = createSession({ channelId: "web" });
    const u = recordMessage(s, { role: "user", text: "ciao" });
    assert.equal(s.messageCount, 1);
    assert.ok(s.lastMessageAtMs);
    assert.equal(u.role, "user");
    assert.equal(u.text, "ciao");
    recordMessage(s, { role: "assistant", text: "risposta" });
    assert.equal(s.messageCount, 2);
  });

  it("lifecycle events emessi su create/pause/end", () => {
    const evts: SessionLifecycleEvent[] = [];
    const unsub = onSessionLifecycle((e) => evts.push(e));
    const s = createSession({ channelId: "web" });
    pauseSession(s);
    endSession(s);
    unsub();
    assert.deepEqual(evts.map((e) => e.action), ["created", "paused", "ended"]);
  });

  it("transcript events emessi su recordMessage", () => {
    const updates: Array<{ role: string; text: string }> = [];
    const unsub = onSessionTranscript((u) => updates.push({ role: u.role, text: u.text }));
    const s = createSession({ channelId: "cli" });
    recordMessage(s, { role: "user", text: "ping" });
    unsub();
    assert.equal(updates.length, 1);
    assert.equal(updates[0].text, "ping");
  });

  it("normalizeInputProvenance valida e rifiuta input invalido", () => {
    assert.equal(normalizeInputProvenance(null), undefined);
    assert.equal(normalizeInputProvenance({ kind: "invalid" }), undefined);
    const p = normalizeInputProvenance({ kind: "external_user", sourceChannel: "web" });
    assert.ok(p);
    assert.equal(p.kind, "external_user");
    assert.equal(p.sourceChannel, "web");
  });
});

describe("Session Types", () => {
  it("looksLikeSessionId valida UUID", () => {
    assert.ok(looksLikeSessionId("550e8400-e29b-41d4-a716-446655440000"));
    assert.ok(!looksLikeSessionId("not-a-uuid"));
    assert.ok(!looksLikeSessionId(""));
  });

  it("parseSessionLabel valida label", () => {
    const ok = parseSessionLabel("Test Label");
    assert.ok(ok.ok === true && ok.label === "Test Label");
    assert.ok(parseSessionLabel("").ok === false);
    assert.ok(parseSessionLabel(123).ok === false);
    assert.ok(parseSessionLabel("x".repeat(600)).ok === false);
  });
});

describe("Session Store Helpers", () => {
  it("findSessionById trova o ritorna undefined", () => {
    const store = mockStore(mockEntry({ id: "a" }), mockEntry({ id: "b" }));
    assert.equal(findSessionById(store, "a")?.id, "a");
    assert.equal(findSessionById(store, "z"), undefined);
  });

  it("findSessionsByChannel filtra per canale", () => {
    const store = mockStore(
      mockEntry({ id: "1", channelId: "web" }),
      mockEntry({ id: "2", channelId: "cli" }),
      mockEntry({ id: "3", channelId: "web" }),
    );
    assert.equal(findSessionsByChannel(store, "web").length, 2);
    assert.equal(findSessionsByChannel(store, "cli").length, 1);
  });

  it("findActiveSessions ritorna solo attive", () => {
    const store = mockStore(
      mockEntry({ id: "1", state: "active" }),
      mockEntry({ id: "2", state: "paused" }),
      mockEntry({ id: "3", state: "ended" }),
    );
    assert.equal(findActiveSessions(store).length, 1);
    assert.equal(findActiveSessions(store)[0].id, "1");
  });

  it("findSessionsByUser filtra per userId", () => {
    const store = mockStore(
      mockEntry({ id: "1", userId: "u1" }),
      mockEntry({ id: "2", userId: "u2" }),
      mockEntry({ id: "3", userId: "u1" }),
    );
    assert.equal(findSessionsByUser(store, "u1").length, 2);
  });

  it("addSessionToStore e removeSessionFromStore", () => {
    const store = mockStore();
    addSessionToStore(store, mockEntry({ id: "new" }));
    assert.equal(store.sessions.length, 1);
    assert.ok(removeSessionFromStore(store, "new"));
    assert.equal(store.sessions.length, 0);
    assert.ok(!removeSessionFromStore(store, "nonexistent"));
  });

  it("pruneEndedSessions rimuove sessioni vecchie", () => {
    const old = Date.now() - 100_000;
    const store = mockStore(
      mockEntry({ id: "1", state: "ended", updatedAtMs: old }),
      mockEntry({ id: "2", state: "active", updatedAtMs: old }),
      mockEntry({ id: "3", state: "ended", updatedAtMs: Date.now() }),
    );
    const pruned = pruneEndedSessions(store, 50_000);
    assert.equal(pruned, 1);
    assert.equal(store.sessions.length, 2);
  });
});
