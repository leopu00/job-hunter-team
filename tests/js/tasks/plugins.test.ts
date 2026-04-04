/** Test vitest shared/plugins/ — HookRunner, emitHook, discoverPlugins, lifecycle. */
import { describe, it, expect, beforeEach } from "vitest";
import {
  HookRunner, createHookRunner, createHookEvent,
  setActiveHookRunner, getActiveHookRunner, resetActiveHookRunner, emitHook,
} from "../../../shared/plugins/hooks.js";
import {
  createRegistry, createEmptyRegistry, RegistryBuilder,
  resetActiveRegistry,
} from "../../../shared/plugins/registry.js";
import { discoverPlugins } from "../../../shared/plugins/loader.js";
import { DEFAULT_PLUGINS_CONFIG } from "../../../shared/plugins/types.js";
import type { PluginManifest, PluginRecord, PluginDefinition } from "../../../shared/plugins/types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function manifest(id: string, extra?: Partial<PluginManifest>): PluginManifest {
  return { id, name: `P-${id}`, version: "1.0.0", enabledByDefault: true, ...extra };
}
function record(id: string, status = "active" as any, def?: PluginDefinition): PluginRecord {
  return { id, manifest: manifest(id), status, rootDir: `/tmp/${id}`, definition: def };
}

beforeEach(() => { resetActiveRegistry(); resetActiveHookRunner(); });

describe("HookRunner avanzato", () => {
  it("runSync esegue handler sincroni", () => {
    const runner = new HookRunner();
    const calls: string[] = [];
    runner.register({ pluginId: "p1", hook: "onError", handler: () => { calls.push("ok"); } });
    runner.runSync("onError", { pluginId: "x", timestamp: Date.now(), error: "e" });
    expect(calls).toEqual(["ok"]);
  });
  it("runSync cattura errori senza bloccare", () => {
    const runner = new HookRunner();
    const calls: string[] = [];
    runner.register({ pluginId: "bad", hook: "onError", handler: () => { throw new Error("fail"); }, priority: 1 });
    runner.register({ pluginId: "good", hook: "onError", handler: () => { calls.push("ok"); }, priority: 2 });
    runner.runSync("onError", { pluginId: "x", timestamp: Date.now(), error: "e" });
    expect(calls).toEqual(["ok"]);
  });
  it("run hook senza handler → noop", async () => {
    const runner = new HookRunner();
    await runner.run("beforeAgentStart", { pluginId: "p", timestamp: 0, agentId: "a", task: "t" });
  });
  it("register multipli stesso hook → tutti eseguiti", async () => {
    const runner = new HookRunner();
    const calls: string[] = [];
    runner.register({ pluginId: "p1", hook: "onError", handler: () => { calls.push("1"); } });
    runner.register({ pluginId: "p2", hook: "onError", handler: () => { calls.push("2"); } });
    await runner.run("onError", { pluginId: "x", timestamp: 0, error: "e" });
    expect(calls.length).toBe(2);
  });
  it("clear → listHooks vuoto, has false", () => {
    const runner = new HookRunner();
    runner.register({ pluginId: "p1", hook: "onError", handler: () => {} });
    runner.clear();
    expect(runner.listHooks()).toEqual([]);
    expect(runner.has("onError")).toBe(false);
  });
});

describe("emitHook globale e singleton", () => {
  it("emitHook senza runner → noop", async () => {
    await emitHook("onError", { pluginId: "x", timestamp: 0, error: "e" });
  });
  it("emitHook con runner attivo → chiama handler", async () => {
    const runner = new HookRunner();
    const calls: string[] = [];
    runner.register({ pluginId: "p1", hook: "onError", handler: () => { calls.push("fired"); } });
    setActiveHookRunner(runner);
    await emitHook("onError", { pluginId: "x", timestamp: 0, error: "e" });
    expect(calls).toEqual(["fired"]);
  });
  it("set/get/resetActiveHookRunner round-trip", () => {
    expect(getActiveHookRunner()).toBeNull();
    const runner = new HookRunner();
    setActiveHookRunner(runner);
    expect(getActiveHookRunner()).toBe(runner);
    resetActiveHookRunner();
    expect(getActiveHookRunner()).toBeNull();
  });
  it("createHookEvent ritorna pluginId + timestamp", () => {
    const evt = createHookEvent("my-plugin");
    expect(evt.pluginId).toBe("my-plugin");
    expect(typeof evt.timestamp).toBe("number");
    expect(evt.timestamp).toBeGreaterThan(0);
  });
});

describe("createHookRunner da registry", () => {
  it("registra hook da plugin attivi", async () => {
    const calls: string[] = [];
    const def: PluginDefinition = {
      manifest: manifest("p1"),
      hooks: { onError: () => { calls.push("p1"); } },
    };
    const reg = createRegistry([record("p1", "active", def)]);
    const runner = createHookRunner(reg);
    await runner.run("onError", { pluginId: "x", timestamp: 0, error: "e" });
    expect(calls).toEqual(["p1"]);
  });
  it("ignora plugin non attivi", async () => {
    const calls: string[] = [];
    const def: PluginDefinition = {
      manifest: manifest("p1"),
      hooks: { onError: () => { calls.push("p1"); } },
    };
    const reg = createRegistry([record("p1", "loaded", def)]);
    const runner = createHookRunner(reg);
    await runner.run("onError", { pluginId: "x", timestamp: 0, error: "e" });
    expect(calls).toEqual([]);
  });
  it("ignora plugin senza hooks", () => {
    const def: PluginDefinition = { manifest: manifest("p1") };
    const reg = createRegistry([record("p1", "active", def)]);
    const runner = createHookRunner(reg);
    expect(runner.listHooks()).toEqual([]);
  });
});

describe("DEFAULT_PLUGINS_CONFIG e RegistryBuilder edge cases", () => {
  it("DEFAULT_PLUGINS_CONFIG ha campi corretti", () => {
    expect(DEFAULT_PLUGINS_CONFIG.enabled).toBe(true);
    expect(Array.isArray(DEFAULT_PLUGINS_CONFIG.searchPaths)).toBe(true);
    expect(Array.isArray(DEFAULT_PLUGINS_CONFIG.allow)).toBe(true);
    expect(Array.isArray(DEFAULT_PLUGINS_CONFIG.deny)).toBe(true);
  });
  it("RegistryBuilder operazioni su id sconosciuto → noop", () => {
    const builder = new RegistryBuilder();
    builder.setLoaded("nope", { manifest: manifest("nope") });
    builder.setActive("nope");
    builder.setError("nope", "x");
    builder.setDisabled("nope");
    expect(builder.size).toBe(0);
  });
  it("createRegistry plugins è frozen", () => {
    const reg = createRegistry([record("a")]);
    expect(Object.isFrozen(reg.plugins)).toBe(true);
  });
  it("createEmptyRegistry → size 0, getActive vuoto", () => {
    const reg = createEmptyRegistry();
    expect(reg.size).toBe(0);
    expect(reg.getActive()).toEqual([]);
    expect(reg.getByKind("skill")).toEqual([]);
  });
});

describe("discoverPlugins filesystem", () => {
  it("directory inesistente → array vuoto", () => {
    const c = discoverPlugins({ ...DEFAULT_PLUGINS_CONFIG, searchPaths: ["/tmp/jht-nonexistent-xyz"] });
    expect(c).toEqual([]);
  });
  it("directory con plugin valido → trova candidato", () => {
    const tmpDir = path.join(os.tmpdir(), `jht-plugins-test-${Date.now()}`);
    const pluginDir = path.join(tmpDir, "my-plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "jht.plugin.json"),
      JSON.stringify({ id: "my-plugin", name: "My Plugin", version: "1.0.0" }));
    try {
      const c = discoverPlugins({ ...DEFAULT_PLUGINS_CONFIG, searchPaths: [tmpDir] });
      expect(c.length).toBe(1);
      expect(c[0].manifest.id).toBe("my-plugin");
      expect(c[0].manifest.name).toBe("My Plugin");
      expect(c[0].rootDir).toBe(pluginDir);
    } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  });
  it("manifest invalido (manca name) → skipped", () => {
    const tmpDir = path.join(os.tmpdir(), `jht-plugins-test-${Date.now()}`);
    const pluginDir = path.join(tmpDir, "bad-plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "jht.plugin.json"), JSON.stringify({ id: "bad" }));
    try {
      expect(discoverPlugins({ ...DEFAULT_PLUGINS_CONFIG, searchPaths: [tmpDir] })).toEqual([]);
    } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  });
  it("manifest con kind e dependencies → campi parsati", () => {
    const tmpDir = path.join(os.tmpdir(), `jht-plugins-test-${Date.now()}`);
    const pluginDir = path.join(tmpDir, "rich-plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "jht.plugin.json"),
      JSON.stringify({ id: "rich", name: "Rich", version: "2.0.0", kind: ["skill", "tool"], dependencies: ["core"] }));
    try {
      const c = discoverPlugins({ ...DEFAULT_PLUGINS_CONFIG, searchPaths: [tmpDir] });
      expect(c[0].manifest.kind).toEqual(["skill", "tool"]);
      expect(c[0].manifest.dependencies).toEqual(["core"]);
    } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  });
});
