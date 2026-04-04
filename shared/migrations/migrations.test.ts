/**
 * Test unitari — shared/migrations
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadState, saveState, compareVersions,
  migrateUp, migrateDown, getPendingMigrations, getCurrentVersion,
} from "./runner.js";
import type { Migration } from "./types.js";
import { DEFAULT_MIGRATION_CONFIG } from "./types.js";

let tmpDir: string;
let statePath: string;

function mkMigration(version: string, desc: string, upFn?: (c: Record<string, unknown>) => void, downFn?: (c: Record<string, unknown>) => void): Migration {
  return {
    version, description: desc,
    up: (c) => { upFn?.(c); return c; },
    down: (c) => { downFn?.(c); return c; },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-test-"));
  statePath = path.join(tmpDir, "state.json");
});

afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// --- compareVersions ---

describe("compareVersions", () => {
  it("a < b ritorna negativo", () => {
    assert.ok(compareVersions("1.0.0", "1.1.0") < 0);
  });

  it("a > b ritorna positivo", () => {
    assert.ok(compareVersions("2.0.0", "1.9.9") > 0);
  });

  it("a == b ritorna 0", () => {
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  });

  it("gestisce versioni con lunghezze diverse", () => {
    assert.ok(compareVersions("1.0", "1.0.1") < 0);
    assert.ok(compareVersions("1.0.1", "1.0") > 0);
  });
});

// --- loadState / saveState ---

describe("loadState / saveState", () => {
  it("loadState ritorna default se file non esiste", () => {
    const state = loadState(statePath);
    assert.equal(state.currentVersion, "0.0.0");
    assert.deepEqual(state.applied, []);
  });

  it("saveState persiste e loadState rilegge", () => {
    const state = { currentVersion: "1.2.0", applied: [{ version: "1.2.0", description: "test", appliedAt: 1000 }], updatedAt: 0 };
    saveState(state, statePath);
    const loaded = loadState(statePath);
    assert.equal(loaded.currentVersion, "1.2.0");
    assert.equal(loaded.applied.length, 1);
    assert.ok(loaded.updatedAt > 0);
  });

  it("saveState crea directory se non esiste", () => {
    const deep = path.join(tmpDir, "a", "b", "state.json");
    saveState({ currentVersion: "0.1.0", applied: [], updatedAt: 0 }, deep);
    assert.ok(fs.existsSync(deep));
  });
});

// --- migrateUp ---

describe("migrateUp", () => {
  it("applica migrazioni in ordine crescente", () => {
    const log: string[] = [];
    const migrations = [
      mkMigration("1.1.0", "second", () => log.push("1.1.0")),
      mkMigration("1.0.0", "first", () => log.push("1.0.0")),
    ];
    const result = migrateUp(migrations, {}, { statePath });
    assert.ok(result.ok);
    assert.equal(result.applied.length, 2);
    assert.deepEqual(log, ["1.0.0", "1.1.0"]);
  });

  it("aggiorna stato dopo migrazione", () => {
    const migrations = [mkMigration("1.0.0", "init")];
    migrateUp(migrations, {}, { statePath });
    assert.equal(getCurrentVersion(statePath), "1.0.0");
  });

  it("non applica migrazioni gia' applicate", () => {
    const migrations = [mkMigration("1.0.0", "init")];
    migrateUp(migrations, {}, { statePath });
    const result = migrateUp(migrations, {}, { statePath });
    assert.ok(result.ok);
    assert.equal(result.applied.length, 0);
  });

  it("rollback su fallimento", () => {
    const log: string[] = [];
    const migrations = [
      mkMigration("1.0.0", "ok", () => log.push("up1"), () => log.push("down1")),
      mkMigration("2.0.0", "fail", () => { throw new Error("boom"); }),
    ];
    const result = migrateUp(migrations, {}, { statePath });
    assert.equal(result.ok, false);
    assert.ok(result.rolledBack);
    assert.ok(log.includes("down1"));
    assert.equal(getCurrentVersion(statePath), "0.0.0");
  });

  it("modifica config in-place", () => {
    const migrations = [mkMigration("1.0.0", "add field", (c) => { c.newField = true; })];
    const config: Record<string, unknown> = {};
    migrateUp(migrations, config, { statePath });
    assert.equal(config.newField, true);
  });
});

// --- migrateDown ---

describe("migrateDown", () => {
  it("reverte migrazioni fino a target", () => {
    const migrations = [
      mkMigration("1.0.0", "v1", (c) => { c.v1 = true; }, (c) => { delete c.v1; }),
      mkMigration("2.0.0", "v2", (c) => { c.v2 = true; }, (c) => { delete c.v2; }),
    ];
    const config: Record<string, unknown> = {};
    migrateUp(migrations, config, { statePath });
    const result = migrateDown(migrations, config, "1.0.0", { statePath });
    assert.ok(result.ok);
    assert.equal(result.applied.length, 1);
    assert.equal(config.v2, undefined);
  });

  it("non reverte se gia' alla target version", () => {
    const migrations = [mkMigration("1.0.0", "v1")];
    migrateUp(migrations, {}, { statePath });
    const result = migrateDown(migrations, {}, "1.0.0", { statePath });
    assert.ok(result.ok);
    assert.equal(result.applied.length, 0);
  });

  it("gestisce errore in down senza crash", () => {
    const migrations = [
      mkMigration("1.0.0", "v1"),
      mkMigration("2.0.0", "v2", undefined, () => { throw new Error("down fail"); }),
    ];
    migrateUp(migrations, {}, { statePath });
    const result = migrateDown(migrations, {}, "0.0.0", { statePath });
    assert.equal(result.ok, false);
  });
});

// --- getPendingMigrations ---

describe("getPendingMigrations", () => {
  it("ritorna tutte se nessuna applicata", () => {
    const migrations = [mkMigration("1.0.0", "a"), mkMigration("2.0.0", "b")];
    const pending = getPendingMigrations(migrations, statePath);
    assert.equal(pending.length, 2);
    assert.equal(pending[0].version, "1.0.0");
  });

  it("ritorna solo le non applicate", () => {
    const migrations = [mkMigration("1.0.0", "a"), mkMigration("2.0.0", "b")];
    migrateUp([migrations[0]], {}, { statePath });
    const pending = getPendingMigrations(migrations, statePath);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].version, "2.0.0");
  });
});

// --- DEFAULT_MIGRATION_CONFIG ---

describe("DEFAULT_MIGRATION_CONFIG", () => {
  it("ha valori default corretti", () => {
    assert.equal(DEFAULT_MIGRATION_CONFIG.initialVersion, "0.0.0");
    assert.equal(DEFAULT_MIGRATION_CONFIG.backup, true);
  });
});
