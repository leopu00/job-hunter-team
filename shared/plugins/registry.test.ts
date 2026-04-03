/**
 * Test unitari — shared/plugins/registry
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createRegistry,
  createEmptyRegistry,
  RegistryBuilder,
  setActiveRegistry,
  getActiveRegistry,
  requireActiveRegistry,
  resetActiveRegistry,
} from "./registry.js";
import type { PluginManifest, PluginRecord, PluginsConfig } from "./types.js";
import { DEFAULT_PLUGINS_CONFIG } from "./types.js";

beforeEach(() => resetActiveRegistry());

// --- createEmptyRegistry ---

describe("createEmptyRegistry", () => {
  it("crea registry vuoto con size 0", () => {
    const reg = createEmptyRegistry();
    assert.equal(reg.size, 0);
    assert.deepEqual(reg.plugins, []);
  });
});

// --- createRegistry ---

describe("createRegistry", () => {
  it("crea registry da record e permette lookup", () => {
    const records = [makeRecord("alpha"), makeRecord("beta")];
    const reg = createRegistry(records);
    assert.equal(reg.size, 2);
    assert.ok(reg.has("alpha"));
    assert.ok(!reg.has("gamma"));
    assert.equal(reg.get("alpha")?.id, "alpha");
  });

  it("getActive filtra per status active", () => {
    const records = [
      makeRecord("a", "active"),
      makeRecord("b", "loaded"),
      makeRecord("c", "active"),
    ];
    const reg = createRegistry(records);
    assert.equal(reg.getActive().length, 2);
  });

  it("getByKind filtra per kind singolo", () => {
    const records = [
      makeRecord("s1", "active", "skill"),
      makeRecord("c1", "active", "channel"),
    ];
    const reg = createRegistry(records);
    assert.equal(reg.getByKind("skill").length, 1);
    assert.equal(reg.getByKind("channel").length, 1);
  });

  it("getByKind filtra per kind array", () => {
    const r = makeRecord("multi", "active");
    r.manifest.kind = ["skill", "tool"];
    const reg = createRegistry([r]);
    assert.equal(reg.getByKind("skill").length, 1);
    assert.equal(reg.getByKind("tool").length, 1);
    assert.equal(reg.getByKind("channel").length, 0);
  });

  it("getByStatus ritorna record filtrati", () => {
    const records = [
      makeRecord("ok", "active"),
      makeRecord("err", "error"),
      makeRecord("dis", "disabled"),
    ];
    const reg = createRegistry(records);
    assert.equal(reg.getByStatus("error").length, 1);
    assert.equal(reg.getByStatus("disabled").length, 1);
  });
});

// --- RegistryBuilder ---

describe("RegistryBuilder", () => {
  it("addDiscovered + build crea registry con status discovered", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(makeManifest("p1"), "/tmp/p1");
    const reg = builder.build();
    assert.equal(reg.size, 1);
    assert.equal(reg.get("p1")?.status, "discovered");
  });

  it("setLoaded aggiorna status e loadedAt", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(makeManifest("p2"), "/tmp/p2");
    builder.setLoaded("p2", { manifest: makeManifest("p2") });
    const reg = builder.build();
    assert.equal(reg.get("p2")?.status, "loaded");
    assert.ok(reg.get("p2")?.loadedAt);
  });

  it("setActive / setError / setDisabled cambiano status", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(makeManifest("a"), "/tmp");
    builder.addDiscovered(makeManifest("b"), "/tmp");
    builder.addDiscovered(makeManifest("c"), "/tmp");
    builder.setActive("a");
    builder.setError("b", "crash");
    builder.setDisabled("c");
    const reg = builder.build();
    assert.equal(reg.get("a")?.status, "active");
    assert.equal(reg.get("b")?.status, "error");
    assert.equal(reg.get("b")?.error, "crash");
    assert.equal(reg.get("c")?.status, "disabled");
  });

  it("ignora duplicati in addDiscovered", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(makeManifest("dup"), "/tmp/1");
    builder.addDiscovered(makeManifest("dup"), "/tmp/2");
    assert.equal(builder.size, 1);
  });

  it("isPluginEnabled rispetta deny list", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(makeManifest("blocked"), "/tmp");
    const config: PluginsConfig = { ...DEFAULT_PLUGINS_CONFIG, deny: ["blocked"] };
    assert.equal(builder.isPluginEnabled("blocked", config), false);
  });

  it("isPluginEnabled rispetta allow list esclusiva", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(makeManifest("allowed"), "/tmp");
    builder.addDiscovered(makeManifest("other"), "/tmp");
    const config: PluginsConfig = { ...DEFAULT_PLUGINS_CONFIG, allow: ["allowed"] };
    assert.equal(builder.isPluginEnabled("allowed", config), true);
    assert.equal(builder.isPluginEnabled("other", config), false);
  });

  it("isPluginEnabled ritorna false se config.enabled e' false", () => {
    const builder = new RegistryBuilder();
    builder.addDiscovered(makeManifest("any"), "/tmp");
    assert.equal(builder.isPluginEnabled("any", { enabled: false }), false);
  });
});

// --- Singleton ---

describe("singleton registry", () => {
  it("setActiveRegistry + getActiveRegistry", () => {
    const reg = createEmptyRegistry();
    setActiveRegistry(reg);
    assert.strictEqual(getActiveRegistry(), reg);
  });

  it("requireActiveRegistry lancia se non inizializzato", () => {
    assert.throws(() => requireActiveRegistry(), /non inizializzato/);
  });

  it("resetActiveRegistry resetta a null", () => {
    setActiveRegistry(createEmptyRegistry());
    resetActiveRegistry();
    assert.equal(getActiveRegistry(), null);
  });
});

// --- Helpers ---

function makeManifest(id: string): PluginManifest {
  return { id, name: `Plugin ${id}`, version: "1.0.0", enabledByDefault: true };
}

function makeRecord(id: string, status = "discovered" as any, kind?: string): PluginRecord {
  const manifest = makeManifest(id);
  if (kind) manifest.kind = kind as any;
  return { id, manifest, status, rootDir: `/tmp/${id}` };
}
