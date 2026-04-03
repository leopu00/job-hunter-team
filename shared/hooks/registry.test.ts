/**
 * Test unitari — shared/hooks/registry
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerHook,
  unregisterHook,
  clearAllHooks,
  hasListeners,
  getRegisteredEvents,
  getHandlerCount,
  triggerHook,
  createHookEvent,
  resolveHookEntries,
  filterEligibleHooks,
} from "./registry.js";
import type { HookEntry, HookSource } from "./types.js";
import { HOOK_SOURCE_PRECEDENCE } from "./types.js";

beforeEach(() => clearAllHooks());

// --- registerHook / unregisterHook ---

describe("registerHook", () => {
  it("registra un handler e lo trova con hasListeners", () => {
    registerHook("agent", "test-hook", () => {});
    assert.ok(hasListeners("agent"));
  });

  it("registra piu' handler sullo stesso evento", () => {
    registerHook("session", "h1", () => {});
    registerHook("session", "h2", () => {});
    assert.equal(getHandlerCount("session"), 2);
  });
});

describe("unregisterHook", () => {
  it("rimuove un handler per nome", () => {
    registerHook("message", "to-remove", () => {});
    unregisterHook("message", "to-remove");
    assert.equal(hasListeners("message"), false);
  });

  it("non fa nulla se evento non esiste", () => {
    unregisterHook("nonexistent", "nope");
    assert.equal(getHandlerCount(), 0);
  });
});

// --- clearAllHooks ---

describe("clearAllHooks", () => {
  it("rimuove tutti gli handler registrati", () => {
    registerHook("a", "h1", () => {});
    registerHook("b", "h2", () => {});
    clearAllHooks();
    assert.equal(getHandlerCount(), 0);
    assert.deepEqual(getRegisteredEvents(), []);
  });
});

// --- hasListeners ---

describe("hasListeners", () => {
  it("trova listener su evento specifico tipo:azione", () => {
    registerHook("agent:start", "hook-start", () => {});
    assert.ok(hasListeners("agent", "start"));
  });

  it("ritorna false se nessun listener", () => {
    assert.equal(hasListeners("gateway", "nope"), false);
  });
});

// --- triggerHook ---

describe("triggerHook", () => {
  it("esegue handler registrati per tipo", async () => {
    const calls: string[] = [];
    registerHook("command", "cmd-hook", () => { calls.push("executed"); });
    await triggerHook(createHookEvent("command", "run"));
    assert.deepEqual(calls, ["executed"]);
  });

  it("esegue handler generici + specifici in ordine", async () => {
    const order: number[] = [];
    registerHook("agent", "generic", () => { order.push(1); });
    registerHook("agent:deploy", "specific", () => { order.push(2); });
    await triggerHook(createHookEvent("agent", "deploy"));
    assert.deepEqual(order, [1, 2]);
  });

  it("cattura errori senza bloccare gli altri handler", async () => {
    const results: string[] = [];
    registerHook("session", "bad", () => { throw new Error("boom"); });
    registerHook("session", "good", () => { results.push("ok"); });
    await triggerHook(createHookEvent("session", "start"));
    assert.deepEqual(results, ["ok"]);
  });
});

// --- createHookEvent ---

describe("createHookEvent", () => {
  it("crea evento con tipo, azione e timestamp", () => {
    const ev = createHookEvent("gateway", "connect", { ip: "127.0.0.1" });
    assert.equal(ev.type, "gateway");
    assert.equal(ev.action, "connect");
    assert.equal(ev.context.ip, "127.0.0.1");
    assert.ok(ev.timestamp > 0);
    assert.deepEqual(ev.messages, []);
  });
});

// --- resolveHookEntries ---

describe("resolveHookEntries", () => {
  it("hook con precedenza piu' alta sovrascrive per nome", () => {
    const entries: HookEntry[] = [
      makeEntry("my-hook", "bundled"),
      makeEntry("my-hook", "workspace"),
    ];
    const resolved = resolveHookEntries(entries, HOOK_SOURCE_PRECEDENCE);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].hook.source, "workspace");
  });

  it("mantiene hook con nomi diversi", () => {
    const entries: HookEntry[] = [
      makeEntry("hook-a", "bundled"),
      makeEntry("hook-b", "plugin"),
    ];
    const resolved = resolveHookEntries(entries, HOOK_SOURCE_PRECEDENCE);
    assert.equal(resolved.length, 2);
  });
});

// --- filterEligibleHooks ---

describe("filterEligibleHooks", () => {
  it("filtra hook disabilitati", () => {
    const entries: HookEntry[] = [
      { ...makeEntry("enabled", "bundled"), enabled: true },
      { ...makeEntry("disabled", "bundled"), enabled: false },
    ];
    const result = filterEligibleHooks(entries);
    assert.equal(result.length, 1);
    assert.equal(result[0].hook.name, "enabled");
  });

  it("ritorna vuoto se config.enabled e' false", () => {
    const entries: HookEntry[] = [makeEntry("any", "bundled")];
    const result = filterEligibleHooks(entries, { enabled: false });
    assert.equal(result.length, 0);
  });

  it("filtra per config.entries disabilitato", () => {
    const entries: HookEntry[] = [makeEntry("target", "bundled")];
    const result = filterEligibleHooks(entries, {
      enabled: true,
      entries: { target: { enabled: false } },
    });
    assert.equal(result.length, 0);
  });
});

// --- Helpers ---

function makeEntry(name: string, source: HookSource): HookEntry {
  return {
    hook: { name, description: "", source, baseDir: "/tmp", handlerPath: "/tmp/h.js" },
    metadata: { events: [`agent:${name}`] },
    enabled: true,
  };
}
