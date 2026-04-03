/**
 * Test unitari — Hook System (registry, triggering, risoluzione)
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerHook, unregisterHook, clearAllHooks,
  hasListeners, getRegisteredEvents, getHandlerCount,
  triggerHook, createHookEvent, resolveHookEntries, filterEligibleHooks,
} from "./registry.js";
import { HOOK_SOURCE_PRECEDENCE } from "./types.js";
import type { HookEntry, HookSource } from "./types.js";

function mockEntry(name: string, source: HookSource, enabled = true): HookEntry {
  return {
    hook: { name, description: `Hook ${name}`, source, baseDir: "/tmp", handlerPath: "/tmp/h.js" },
    metadata: { events: ["test:action"] },
    enabled,
  };
}

describe("Hook Registry", () => {
  beforeEach(() => { clearAllHooks(); });

  it("registerHook e unregisterHook", () => {
    registerHook("command", "h1", async () => {});
    assert.equal(getHandlerCount("command"), 1);
    unregisterHook("command", "h1");
    assert.equal(getHandlerCount("command"), 0);
  });

  it("unregisterHook ignora hook inesistente", () => {
    unregisterHook("nonexistent", "nope");
    assert.equal(getHandlerCount(), 0);
  });

  it("clearAllHooks rimuove tutto", () => {
    registerHook("command", "h1", async () => {});
    registerHook("session", "h2", async () => {});
    clearAllHooks();
    assert.equal(getHandlerCount(), 0);
    assert.deepEqual(getRegisteredEvents(), []);
  });

  it("hasListeners controlla tipo e tipo:azione", () => {
    registerHook("command", "h1", async () => {});
    registerHook("session:start", "h2", async () => {});
    assert.ok(hasListeners("command"));
    assert.ok(hasListeners("session", "start"));
    assert.ok(!hasListeners("agent"));
  });

  it("getRegisteredEvents elenca tutti gli eventi", () => {
    registerHook("command", "h1", async () => {});
    registerHook("session:start", "h2", async () => {});
    assert.deepEqual(getRegisteredEvents().sort(), ["command", "session:start"]);
  });

  it("getHandlerCount conta totale e per evento", () => {
    registerHook("command", "h1", async () => {});
    registerHook("command", "h2", async () => {});
    registerHook("session", "h3", async () => {});
    assert.equal(getHandlerCount("command"), 2);
    assert.equal(getHandlerCount("session"), 1);
    assert.equal(getHandlerCount(), 3);
  });

  it("triggerHook esegue handler generici e specifici", async () => {
    const calls: string[] = [];
    registerHook("message", "generic", async () => { calls.push("generic"); });
    registerHook("message:received", "specific", async () => { calls.push("specific"); });
    await triggerHook(createHookEvent("message", "received"));
    assert.deepEqual(calls, ["generic", "specific"]);
  });

  it("triggerHook cattura errori senza bloccare", async () => {
    const calls: string[] = [];
    registerHook("command", "bad", async () => { throw new Error("boom"); });
    registerHook("command", "good", async () => { calls.push("ok"); });
    await triggerHook(createHookEvent("command", "run"));
    assert.deepEqual(calls, ["ok"]);
  });

  it("triggerHook noop senza handler registrati", async () => {
    await triggerHook(createHookEvent("gateway", "ping")); // no crash
  });

  it("createHookEvent crea evento con defaults", () => {
    const event = createHookEvent("agent", "start", { agentId: "scout" });
    assert.equal(event.type, "agent");
    assert.equal(event.action, "start");
    assert.ok(event.timestamp > 0);
    assert.deepEqual(event.messages, []);
    assert.equal(event.context.agentId, "scout");
  });

  it("handler multipli sullo stesso evento", async () => {
    const order: number[] = [];
    registerHook("command", "first", async () => { order.push(1); });
    registerHook("command", "second", async () => { order.push(2); });
    registerHook("command", "third", async () => { order.push(3); });
    await triggerHook(createHookEvent("command", "exec"));
    assert.deepEqual(order, [1, 2, 3]);
  });
});

describe("Hook Resolution", () => {
  it("resolveHookEntries risolve collisioni per precedenza", () => {
    const entries = [
      mockEntry("logger", "bundled"),
      mockEntry("logger", "workspace"),
      mockEntry("notifier", "plugin"),
    ];
    const resolved = resolveHookEntries(entries, HOOK_SOURCE_PRECEDENCE);
    assert.equal(resolved.length, 2);
    const logger = resolved.find((e) => e.hook.name === "logger");
    assert.equal(logger?.hook.source, "workspace");
  });

  it("filterEligibleHooks filtra per enabled", () => {
    const entries = [mockEntry("h1", "bundled", true), mockEntry("h2", "bundled", false)];
    assert.equal(filterEligibleHooks(entries).length, 1);
  });

  it("filterEligibleHooks rispetta config globale disabled", () => {
    const entries = [mockEntry("h1", "bundled")];
    assert.equal(filterEligibleHooks(entries, { enabled: false }).length, 0);
  });

  it("filterEligibleHooks rispetta config per-hook disabled", () => {
    const entries = [mockEntry("h1", "bundled"), mockEntry("h2", "bundled")];
    const eligible = filterEligibleHooks(entries, { entries: { h1: { enabled: false } } });
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0].hook.name, "h2");
  });
});
