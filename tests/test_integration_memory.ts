/**
 * Test integrazione memory-manager — caricamento contesto agente
 *
 * Verifica il flusso completo: creazione workspace, template,
 * caricamento soul/identity/bootstrap files da filesystem reale.
 * Esecuzione: npx tsx --test tests/test_integration_memory.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadAgentMemory,
  ensureTemplates,
  loadBootstrapFiles,
  hasMemoryFiles,
  listMemoryFiles,
} from "../shared/memory/memory-manager.js";

let testDir: string;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), "jht-mem-integ-"));
});

after(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── ensureTemplates ─────────────────────────────────────────────────────────

describe("ensureTemplates", () => {
  it("crea SOUL.md e IDENTITY.md in directory vuota", () => {
    const dir = join(testDir, "empty-ws");
    const created = ensureTemplates(dir);
    assert.ok(created.includes("IDENTITY.md"));
    assert.ok(created.includes("SOUL.md"));
    assert.ok(existsSync(join(dir, "IDENTITY.md")));
    assert.ok(existsSync(join(dir, "SOUL.md")));
  });

  it("non sovrascrive file esistenti", () => {
    const dir = join(testDir, "existing-ws");
    ensureTemplates(dir);
    writeFileSync(join(dir, "SOUL.md"), "# Custom Soul\nPersonalizzata.");
    const created = ensureTemplates(dir);
    assert.ok(!created.includes("SOUL.md"));
    const content = readFileSync(join(dir, "SOUL.md"), "utf-8");
    assert.ok(content.includes("Custom Soul"));
  });

  it("crea la directory se non esiste", () => {
    const dir = join(testDir, "nested", "deep", "ws");
    ensureTemplates(dir);
    assert.ok(existsSync(dir));
  });
});

// ── hasMemoryFiles / listMemoryFiles ────────────────────────────────────────

describe("hasMemoryFiles", () => {
  it("ritorna false per directory vuota", () => {
    const dir = join(testDir, "no-files");
    ensureTemplates(dir); // crea dir
    rmSync(join(dir, "SOUL.md"));
    rmSync(join(dir, "IDENTITY.md"));
    assert.equal(hasMemoryFiles(dir), false);
  });

  it("ritorna true se c'e almeno un bootstrap file", () => {
    const dir = join(testDir, "has-soul");
    ensureTemplates(dir);
    assert.equal(hasMemoryFiles(dir), true);
  });
});

describe("listMemoryFiles", () => {
  it("elenca solo file presenti", () => {
    const dir = join(testDir, "list-test");
    ensureTemplates(dir);
    writeFileSync(join(dir, "MEMORY.md"), "# Ricordi\n- qualcosa");
    const files = listMemoryFiles(dir);
    assert.ok(files.includes("SOUL.md"));
    assert.ok(files.includes("IDENTITY.md"));
    assert.ok(files.includes("MEMORY.md"));
    assert.ok(!files.includes("AGENTS.md"));
    assert.ok(!files.includes("TOOLS.md"));
  });
});

// ── loadBootstrapFiles ──────────────────────────────────────────────────────

describe("loadBootstrapFiles", () => {
  it("carica tutti i file bootstrap presenti", () => {
    const dir = join(testDir, "bootstrap-test");
    ensureTemplates(dir);
    writeFileSync(join(dir, "AGENTS.md"), "# Agenti\n- capitano");
    writeFileSync(join(dir, "TOOLS.md"), "# Tools\n- read");
    const files = loadBootstrapFiles(dir);
    const names = files.map((f) => f.name);
    assert.ok(names.includes("SOUL.md"));
    assert.ok(names.includes("IDENTITY.md"));
    assert.ok(names.includes("AGENTS.md"));
    assert.ok(names.includes("TOOLS.md"));
  });

  it("ignora file vuoti", () => {
    const dir = join(testDir, "empty-files");
    ensureTemplates(dir);
    writeFileSync(join(dir, "MEMORY.md"), "   ");
    const files = loadBootstrapFiles(dir);
    const names = files.map((f) => f.name);
    assert.ok(!names.includes("MEMORY.md"));
  });

  it("ogni file ha path e contenuto corretti", () => {
    const dir = join(testDir, "content-check");
    ensureTemplates(dir);
    const files = loadBootstrapFiles(dir);
    const soul = files.find((f) => f.name === "SOUL.md");
    assert.ok(soul);
    assert.equal(soul.filePath, join(dir, "SOUL.md"));
    assert.ok(soul.content.includes("SOUL.md"));
  });
});

// ── loadAgentMemory (integrazione completa) ─────────────────────────────────

describe("loadAgentMemory", () => {
  it("carica contesto completo con identity e soul", () => {
    const dir = join(testDir, "full-agent");
    writeFileSync(join(testDir, "full-agent-skip"), ""); // placeholder
    ensureTemplates(dir);

    // Scrivi un'identity compilata
    writeFileSync(join(dir, "IDENTITY.md"), [
      "# IDENTITY.md",
      "- **Name:** Capitano",
      "- **Emoji:** 🤖",
      "- **Creature:** AI coordinator",
      "- **Vibe:** sharp and focused",
    ].join("\n"));

    const ctx = loadAgentMemory({ workspaceDir: dir });
    assert.equal(ctx.workspaceDir, dir);
    assert.ok(ctx.identity);
    assert.equal(ctx.identity.name, "Capitano");
    assert.equal(ctx.identity.emoji, "🤖");
    assert.ok(ctx.soul);
    assert.ok(ctx.soul.raw.length > 0);
    assert.ok(ctx.files.length >= 2);
  });

  it("con createTemplates=true crea file mancanti", () => {
    const dir = join(testDir, "auto-create");
    const ctx = loadAgentMemory({ workspaceDir: dir, createTemplates: true });
    assert.ok(existsSync(join(dir, "SOUL.md")));
    assert.ok(existsSync(join(dir, "IDENTITY.md")));
    assert.ok(ctx.soul);
    // identity sara null perche il template ha placeholder
    assert.equal(ctx.identity, null);
  });

  it("workspace vuoto senza createTemplates ritorna null per soul e identity", () => {
    const dir = join(testDir, "bare-ws");
    require("node:fs").mkdirSync(dir, { recursive: true });
    const ctx = loadAgentMemory({ workspaceDir: dir });
    assert.equal(ctx.identity, null);
    assert.equal(ctx.soul, null);
    assert.equal(ctx.files.length, 0);
  });

  it("soul ha sezioni parsate correttamente", () => {
    const dir = join(testDir, "soul-sections");
    ensureTemplates(dir);
    const ctx = loadAgentMemory({ workspaceDir: dir });
    assert.ok(ctx.soul);
    assert.ok(ctx.soul.coreTruths);
    assert.ok(ctx.soul.boundaries);
    assert.ok(ctx.soul.vibe);
    assert.ok(ctx.soul.continuity);
  });
});
