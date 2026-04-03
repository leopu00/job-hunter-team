/**
 * Test unitari — Plugin System (registry, builder, hook runner)
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createRegistry, createEmptyRegistry, RegistryBuilder,
  resetActiveRegistry, setActiveRegistry, getActiveRegistry, requireActiveRegistry,
} from "./registry.js";
import { HookRunner, createHookRunner, resetActiveHookRunner } from "./hooks.js";
import type { PluginManifest, PluginRecord, PluginsConfig, PluginDefinition } from "./types.js";

function mockManifest(id: string, overrides?: Partial<PluginManifest>): PluginManifest {
  return { id, name: `Plugin ${id}`, version: "1.0.0", enabledByDefault: true, ...overrides };
}

function mockRecord(id: string, status: PluginRecord["status"] = "active", extra?: Partial<PluginRecord>): PluginRecord {
  return { id, manifest: mockManifest(id), status, rootDir: `/tmp/${id}`, ...extra };
}

describe("Plugin Registry", () => {
  beforeEach(() => { resetActiveRegistry(); });

  it("createEmptyRegistry crea registry vuoto", () => {
    const reg = createEmptyRegistry();
    assert.equal(reg.size, 0);
    assert.deepEqual([...reg.plugins], []);
  });

  it("createRegistry — get, has, size", () => {
    const reg = createRegistry([mockRecord("a"), mockRecord("b")]);
    assert.equal(reg.size, 2);
    assert.ok(reg.has("a"));
    assert.ok(!reg.has("z"));
    assert.equal(reg.get("a")?.id, "a");
    assert.equal(reg.get("z"), undefined);
  });

  it("getActive ritorna solo plugin attivi", () => {
    const reg = createRegistry([mockRecord("a", "active"), mockRecord("b", "loaded"), mockRecord("c", "active")]);
    assert.equal(reg.getActive().length, 2);
  });

  it("getByKind filtra per tipo plugin", () => {
    const reg = createRegistry([
      mockRecord("a", "active", { manifest: mockManifest("a", { kind: "skill" }) }),
      mockRecord("b", "active", { manifest: mockManifest("b", { kind: ["tool", "channel"] }) }),
      mockRecord("c", "active", { manifest: mockManifest("c", { kind: "channel" }) }),
    ]);
    assert.equal(reg.getByKind("skill").length, 1);
    assert.equal(reg.getByKind("channel").length, 2);
    assert.equal(reg.getByKind("storage").length, 0);
  });

  it("getByStatus filtra per stato", () => {
    const reg = createRegistry([mockRecord("a", "active"), mockRecord("b", "error"), mockRecord("c", "error")]);
    assert.equal(reg.getByStatus("error").length, 2);
    assert.equal(reg.getByStatus("disabled").length, 0);
  });

  it("singleton set/get/require/reset", () => {
    assert.equal(getActiveRegistry(), null);
    assert.throws(() => requireActiveRegistry(), { message: /non inizializzato/ });
    const reg = createEmptyRegistry();
    setActiveRegistry(reg);
    assert.equal(getActiveRegistry(), reg);
    resetActiveRegistry();
    assert.equal(getActiveRegistry(), null);
  });
});

describe("RegistryBuilder", () => {
  it("addDiscovered → setLoaded → setActive lifecycle", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(mockManifest("p1"), "/tmp/p1");
    assert.equal(builder.size, 1);
    assert.ok(builder.has("p1"));
    builder.setLoaded("p1", { manifest: mockManifest("p1") });
    builder.setActive("p1");
    const reg = builder.build();
    assert.equal(reg.get("p1")?.status, "active");
    assert.ok(reg.get("p1")?.loadedAt);
  });

  it("addDiscovered ignora duplicati", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(mockManifest("p1"), "/tmp/p1");
    builder.addDiscovered(mockManifest("p1"), "/tmp/dup");
    assert.equal(builder.size, 1);
  });

  it("setError e setDisabled cambiano stato", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(mockManifest("p1"), "/tmp/p1");
    builder.setError("p1", "crash");
    assert.equal(builder.build().get("p1")?.status, "error");
    assert.equal(builder.build().get("p1")?.error, "crash");
    builder.setDisabled("p1");
    assert.equal(builder.build().get("p1")?.status, "disabled");
  });

  it("isPluginEnabled rispetta allow, deny, enabledByDefault", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(mockManifest("p1"), "/tmp/p1");
    builder.addDiscovered(mockManifest("p2", { enabledByDefault: false }), "/tmp/p2");
    assert.ok(builder.isPluginEnabled("p1", { enabled: true }));
    assert.ok(!builder.isPluginEnabled("p2", { enabled: true }));
    assert.ok(!builder.isPluginEnabled("p1", { enabled: false }));
    assert.ok(!builder.isPluginEnabled("p1", { enabled: true, deny: ["p1"] }));
    assert.ok(builder.isPluginEnabled("p1", { enabled: true, allow: ["p1"] }));
    assert.ok(!builder.isPluginEnabled("p2", { enabled: true, allow: ["p1"] }));
  });
});

describe("Plugin HookRunner", () => {
  let runner: HookRunner;
  beforeEach(() => { runner = new HookRunner(); resetActiveHookRunner(); });

  it("register e run eseguono handler", async () => {
    const calls: string[] = [];
    runner.register({
      pluginId: "p1", hook: "beforeAgentStart",
      handler: async (e) => { calls.push(e.agentId); },
    });
    await runner.run("beforeAgentStart", { pluginId: "p1", timestamp: Date.now(), agentId: "scout", task: "t" });
    assert.deepEqual(calls, ["scout"]);
  });

  it("handler eseguiti in ordine di priorita", async () => {
    const order: number[] = [];
    runner.register({ pluginId: "p1", hook: "onError", handler: () => { order.push(2); }, priority: 200 });
    runner.register({ pluginId: "p2", hook: "onError", handler: () => { order.push(1); }, priority: 50 });
    await runner.run("onError", { pluginId: "x", timestamp: Date.now(), error: "e" });
    assert.deepEqual(order, [1, 2]);
  });

  it("unregisterPlugin rimuove tutti gli hook di un plugin", () => {
    runner.register({ pluginId: "p1", hook: "beforeAgentStart", handler: async () => {} });
    runner.register({ pluginId: "p1", hook: "afterAgentEnd", handler: async () => {} });
    runner.register({ pluginId: "p2", hook: "beforeAgentStart", handler: async () => {} });
    runner.unregisterPlugin("p1");
    assert.equal(runner.count("beforeAgentStart"), 1);
    assert.ok(!runner.has("afterAgentEnd"));
  });

  it("has, count e listHooks", () => {
    assert.ok(!runner.has("onError"));
    runner.register({ pluginId: "p1", hook: "onError", handler: () => {} });
    runner.register({ pluginId: "p1", hook: "beforeToolCall", handler: () => {} });
    assert.ok(runner.has("onError"));
    assert.equal(runner.count("onError"), 1);
    assert.equal(runner.count("beforeAgentStart"), 0);
    assert.equal(runner.listHooks().length, 2);
  });

  it("run cattura errori senza bloccare", async () => {
    const calls: string[] = [];
    runner.register({ pluginId: "bad", hook: "onError", handler: () => { throw new Error("fail"); }, priority: 1 });
    runner.register({ pluginId: "good", hook: "onError", handler: () => { calls.push("ok"); }, priority: 2 });
    await runner.run("onError", { pluginId: "x", timestamp: Date.now(), error: "e" });
    assert.deepEqual(calls, ["ok"]);
  });

  it("clear rimuove tutto", () => {
    runner.register({ pluginId: "p1", hook: "onError", handler: () => {} });
    runner.clear();
    assert.deepEqual(runner.listHooks(), []);
  });

  it("createHookRunner registra hook da registry plugin attivi", async () => {
    const calls: string[] = [];
    const def: PluginDefinition = {
      manifest: mockManifest("p1"),
      hooks: { beforeAgentStart: async (e) => { calls.push(e.agentId); } },
    };
    const reg = createRegistry([mockRecord("p1", "active", { definition: def })]);
    const r = createHookRunner(reg);
    await r.run("beforeAgentStart", { pluginId: "p1", timestamp: Date.now(), agentId: "a1", task: "t" });
    assert.deepEqual(calls, ["a1"]);
  });
});
