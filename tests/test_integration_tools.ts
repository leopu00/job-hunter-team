/**
 * Test integrazione tool-registry — registrazione e lookup tool
 *
 * Verifica registerTool, custom definitions, profili, sezioni.
 * Esecuzione: npx tsx --test tests/test_integration_tools.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  registerTool,
  getTool,
  listTools,
  registerCustomDefinition,
  listAllDefinitions,
  listSections,
  resolveProfilePolicy,
  isKnownToolId,
} from "../shared/tools/tool-registry.js";
import type { Tool, ToolDefinition } from "../shared/tools/types.js";

// ── registerTool / getTool / listTools ──────────────────────────────────────

describe("registerTool + getTool", () => {
  it("registra e recupera un tool per nome", () => {
    const tool: Tool = {
      name: "test_read",
      label: "Test Read",
      description: "Tool di test lettura",
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
    };
    registerTool(tool);
    const found = getTool("test_read");
    assert.ok(found);
    assert.equal(found.name, "test_read");
    assert.equal(found.description, "Tool di test lettura");
  });

  it("ritorna undefined per tool non registrato", () => {
    assert.equal(getTool("non_esiste_xyz"), undefined);
  });

  it("listTools include i tool registrati", () => {
    const tools = listTools();
    assert.ok(tools.some((t) => t.name === "test_read"));
  });
});

// ── registerCustomDefinition ────────────────────────────────────────────────

describe("registerCustomDefinition", () => {
  it("aggiunge definizione custom al catalogo", () => {
    const def: ToolDefinition = {
      id: "jht_scout",
      label: "scout",
      description: "Cerca posizioni lavorative",
      sectionId: "automation",
      profiles: ["coding"],
    };
    registerCustomDefinition(def);
    const all = listAllDefinitions();
    assert.ok(all.some((d) => d.id === "jht_scout"));
  });

  it("listAllDefinitions include core + custom", () => {
    const all = listAllDefinitions();
    // Core: almeno read, write, edit, exec
    assert.ok(all.some((d) => d.id === "read"));
    assert.ok(all.some((d) => d.id === "write"));
    // Custom: jht_scout aggiunto sopra
    assert.ok(all.some((d) => d.id === "jht_scout"));
  });
});

// ── isKnownToolId ───────────────────────────────────────────────────────────

describe("isKnownToolId", () => {
  it("riconosce tool core", () => {
    assert.ok(isKnownToolId("read"));
    assert.ok(isKnownToolId("exec"));
    assert.ok(isKnownToolId("web_search"));
  });

  it("riconosce tool custom registrato", () => {
    assert.ok(isKnownToolId("jht_scout"));
  });

  it("non riconosce tool sconosciuto", () => {
    assert.ok(!isKnownToolId("tool_fantasy_999"));
  });
});

// ── listSections ────────────────────────────────────────────────────────────

describe("listSections", () => {
  it("ritorna sezioni con tool associati", () => {
    const sections = listSections();
    assert.ok(sections.length > 0);
    // Ogni sezione deve avere almeno un tool
    for (const section of sections) {
      assert.ok(section.tools.length > 0, `Sezione ${section.id} vuota`);
    }
  });

  it("sezione fs contiene read/write/edit", () => {
    const sections = listSections();
    const fs = sections.find((s) => s.id === "fs");
    assert.ok(fs);
    const ids = fs.tools.map((t) => t.id);
    assert.ok(ids.includes("read"));
    assert.ok(ids.includes("write"));
    assert.ok(ids.includes("edit"));
  });

  it("sezione automation contiene cron e tool custom", () => {
    const sections = listSections();
    const auto = sections.find((s) => s.id === "automation");
    assert.ok(auto);
    const ids = auto.tools.map((t) => t.id);
    assert.ok(ids.includes("cron"));
    assert.ok(ids.includes("jht_scout"));
  });
});

// ── resolveProfilePolicy ────────────────────────────────────────────────────

describe("resolveProfilePolicy", () => {
  it("full ritorna undefined (nessuna restrizione)", () => {
    assert.equal(resolveProfilePolicy("full"), undefined);
  });

  it("undefined ritorna undefined", () => {
    assert.equal(resolveProfilePolicy(undefined), undefined);
  });

  it("coding ritorna lista di tool consentiti", () => {
    const policy = resolveProfilePolicy("coding");
    assert.ok(policy);
    assert.ok(Array.isArray(policy.allow));
    assert.ok(policy.allow.includes("read"));
    assert.ok(policy.allow.includes("exec"));
    assert.ok(policy.allow.includes("web_search"));
  });
});

// ── Tool execute (integrazione) ─────────────────────────────────────────────

describe("tool execute", () => {
  it("tool registrato puo essere eseguito", async () => {
    const tool: Tool = {
      name: "test_echo",
      label: "Echo",
      description: "Ritorna input come output",
      execute: async (_id, args: { text: string }) => ({
        content: [{ type: "text" as const, text: args.text }],
        details: { echoed: true },
      }),
    };
    registerTool(tool);

    const found = getTool("test_echo");
    assert.ok(found);
    const result = await found.execute("call-1", { text: "ciao" }, new AbortController().signal);
    assert.equal(result.content[0].text, "ciao");
    assert.deepStrictEqual(result.details, { echoed: true });
  });
});
