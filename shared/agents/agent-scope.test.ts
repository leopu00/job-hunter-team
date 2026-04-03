/**
 * Test unitari — AgentScope (risoluzione config agenti)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  listAgentIds, resolveDefaultAgentId, getAgentConfig,
  resolveAgent, resolveAgentWorkspaceDir, resolveAgentDir,
  resolveAgentModel, resolveAgentProvider, createSingleAgentConfig,
} from "./agent-scope.js";
import type { AgentsConfig } from "./types.js";

function mockConfig(): AgentsConfig {
  return {
    defaults: { model: "def-model", provider: "def-prov", workspace: "~/ws" },
    list: [
      { id: "scout", name: "Scout", skills: ["search"], model: "claude-opus-4-6" },
      { id: "writer", name: "Writer", default: true, provider: "openai" },
      { id: "plain", name: "Plain" },
    ],
  };
}

describe("AgentScope", () => {
  it("listAgentIds ritorna tutti gli ID", () => {
    assert.deepEqual(listAgentIds(mockConfig()), ["scout", "writer", "plain"]);
  });

  it("resolveDefaultAgentId ritorna agente default o primo", () => {
    assert.equal(resolveDefaultAgentId(mockConfig()), "writer");
    const cfg = mockConfig();
    cfg.list.forEach((a) => { a.default = undefined; });
    assert.equal(resolveDefaultAgentId(cfg), "scout");
  });

  it("getAgentConfig trova o ritorna undefined", () => {
    assert.equal(getAgentConfig(mockConfig(), "scout")?.name, "Scout");
    assert.equal(getAgentConfig(mockConfig(), "unknown"), undefined);
  });

  it("resolveAgent applica defaults completi", () => {
    const r = resolveAgent(mockConfig(), "plain");
    assert.ok(r);
    assert.equal(r.model, "def-model");
    assert.equal(r.provider, "def-prov");
    assert.equal(r.thinking, "medium");
    assert.equal(r.contextTokens, 200_000);
  });

  it("resolveAgent usa override agente su defaults", () => {
    const r = resolveAgent(mockConfig(), "scout");
    assert.ok(r);
    assert.equal(r.model, "claude-opus-4-6");
    assert.equal(r.provider, "def-prov");
  });

  it("resolveAgent ritorna undefined per ID sconosciuto", () => {
    assert.equal(resolveAgent(mockConfig(), "nope"), undefined);
  });

  it("resolveAgentWorkspaceDir usa workspace specifico o default", () => {
    const cfg = mockConfig();
    cfg.list[0].workspace = "~/custom";
    assert.ok(resolveAgentWorkspaceDir(cfg, "scout").endsWith("custom"));
    assert.ok(resolveAgentWorkspaceDir(cfg, "plain").endsWith("ws"));
  });

  it("resolveAgentDir path sotto .jht/agents/", () => {
    const dir = resolveAgentDir("test-id");
    assert.ok(dir.includes(".jht") && dir.endsWith("test-id"));
  });

  it("resolveAgentModel e Provider rispettano gerarchia", () => {
    const cfg = mockConfig();
    assert.equal(resolveAgentModel(cfg, "scout"), "claude-opus-4-6");
    assert.equal(resolveAgentModel(cfg, "plain"), "def-model");
    assert.equal(resolveAgentProvider(cfg, "writer"), "openai");
    assert.equal(resolveAgentProvider(cfg, "plain"), "def-prov");
  });

  it("createSingleAgentConfig crea config con un agente default", () => {
    const cfg = createSingleAgentConfig({ id: "solo", name: "Solo" });
    assert.equal(cfg.list.length, 1);
    assert.equal(cfg.list[0].id, "solo");
    assert.equal(cfg.list[0].default, true);
    assert.ok(cfg.defaults.model);
  });
});
