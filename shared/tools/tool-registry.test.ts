import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Tool, ToolDefinition } from "./types.js";
import {
  registerTool,
  getTool,
  listTools,
  registerCustomDefinition,
  listAllDefinitions,
  resolveProfilePolicy,
  listSections,
  isKnownToolId,
} from "./tool-registry.js";

// Helper: crea un tool fake
function fakeTool(name: string): Tool {
  return {
    name,
    label: name,
    description: `Tool ${name}`,
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
  };
}

describe("tool-registry", () => {
  it("registerTool e getTool — registra e recupera un tool", () => {
    const tool = fakeTool("test-tool-1");
    registerTool(tool);
    const found = getTool("test-tool-1");
    assert.ok(found, "Tool deve essere trovato");
    assert.equal(found.name, "test-tool-1");
  });

  it("getTool — ritorna undefined per tool inesistente", () => {
    const found = getTool("non-esiste-xyz");
    assert.equal(found, undefined);
  });

  it("listTools — contiene i tool registrati", () => {
    registerTool(fakeTool("test-list-a"));
    registerTool(fakeTool("test-list-b"));
    const tools = listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("test-list-a"), "Deve contenere test-list-a");
    assert.ok(names.includes("test-list-b"), "Deve contenere test-list-b");
  });

  it("listAllDefinitions — include definizioni core", () => {
    const defs = listAllDefinitions();
    assert.ok(defs.length > 0, "Deve avere definizioni");
    const ids = defs.map((d) => d.id);
    assert.ok(ids.includes("read"), "Deve includere 'read'");
    assert.ok(ids.includes("exec"), "Deve includere 'exec'");
  });

  it("registerCustomDefinition — aggiunge definizione custom", () => {
    const custom: ToolDefinition = {
      id: "custom-test-1",
      label: "Custom",
      description: "Test custom tool",
      sectionId: "runtime",
      profiles: ["full"],
    };
    registerCustomDefinition(custom);
    const defs = listAllDefinitions();
    assert.ok(defs.some((d) => d.id === "custom-test-1"));
  });

  it("isKnownToolId — true per tool core, false per sconosciuto", () => {
    assert.ok(isKnownToolId("read"));
    assert.ok(isKnownToolId("exec"));
    assert.ok(!isKnownToolId("tool-che-non-esiste"));
  });

  it("resolveProfilePolicy — coding ha allow list, full ritorna undefined", () => {
    const codingPolicy = resolveProfilePolicy("coding");
    assert.ok(codingPolicy, "coding deve avere una policy");
    assert.ok(Array.isArray(codingPolicy.allow), "coding.allow deve essere array");
    assert.ok(codingPolicy.allow!.includes("read"));

    const fullPolicy = resolveProfilePolicy("full");
    assert.equal(fullPolicy, undefined, "full non ha restrizioni");
  });

  it("listSections — ritorna sezioni con tool", () => {
    const sections = listSections();
    assert.ok(sections.length > 0, "Deve avere almeno una sezione");
    const fsSection = sections.find((s) => s.id === "fs");
    assert.ok(fsSection, "Deve avere sezione 'fs'");
    assert.ok(fsSection!.tools.length > 0, "Sezione fs deve avere tool");
  });
});
