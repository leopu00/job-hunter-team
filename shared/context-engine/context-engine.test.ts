/**
 * Test unitari — shared/context-engine (assembler + compactor + registry)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assembleContext,
  systemSection,
  memorySection,
  toolsSection,
  historySection,
} from "./assembler.js";
import { compactContext } from "./compactor.js";
import {
  DefaultContextEngine,
  registerContextEngine,
  resolveContextEngine,
  listContextEngineIds,
  unregisterContextEngine,
} from "./registry.js";
import { estimateTokens, estimateMessageTokens } from "./types.js";
import type { ContextSection, ContextMessage } from "./types.js";

// --- estimateTokens ---

describe("estimateTokens", () => {
  it("stima ~1 token per 4 caratteri", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcde"), 2);
    assert.equal(estimateTokens(""), 0);
  });

  it("estimateMessageTokens aggiunge overhead di 4", () => {
    const msg: ContextMessage = { role: "user", content: "abcd" };
    assert.equal(estimateMessageTokens(msg), 5); // 1 + 4
  });
});

// --- Section helpers ---

describe("section helpers", () => {
  it("systemSection crea sezione required", () => {
    const s = systemSection("Sei un assistente");
    assert.equal(s.id, "system");
    assert.equal(s.priority, "required");
    assert.equal(s.messages.length, 1);
    assert.equal(s.messages[0].role, "system");
  });

  it("memorySection crea sezione high con contenuto", () => {
    const s = memorySection(["ricordo1", "ricordo2"]);
    assert.equal(s.priority, "high");
    assert.ok(s.messages[0].content.includes("ricordo1"));
  });

  it("memorySection vuota ha 0 messaggi", () => {
    const s = memorySection([]);
    assert.equal(s.messages.length, 0);
  });

  it("toolsSection crea sezione medium", () => {
    const s = toolsSection([{ name: "search", description: "cerca" }]);
    assert.equal(s.priority, "medium");
    assert.ok(s.messages[0].content.includes("search"));
  });

  it("historySection usa priorita' high", () => {
    const msgs: ContextMessage[] = [{ role: "user", content: "ciao" }];
    const s = historySection(msgs);
    assert.equal(s.id, "history");
    assert.equal(s.priority, "high");
    assert.equal(s.messages.length, 1);
  });
});

// --- assembleContext ---

describe("assembleContext", () => {
  it("include sezioni required sempre", () => {
    const result = assembleContext({
      sections: [systemSection("system prompt")],
      tokenBudget: 10,
    });
    assert.ok(result.includedSections.includes("system"));
    assert.equal(result.messages.length, 1);
  });

  it("rispetta ordine di priorita'", () => {
    const sections: ContextSection[] = [
      { id: "low", priority: "low", messages: [{ role: "system", content: "low" }] },
      { id: "req", priority: "required", messages: [{ role: "system", content: "req" }] },
      { id: "high", priority: "high", messages: [{ role: "user", content: "high" }] },
    ];
    const result = assembleContext({ sections, tokenBudget: 10000 });
    assert.equal(result.messages[0].content, "req");
  });

  it("scarta sezioni low quando il budget e' stretto", () => {
    const sections: ContextSection[] = [
      systemSection("x".repeat(200)),
      { id: "extra", priority: "low", messages: [{ role: "system", content: "x".repeat(400) }] },
    ];
    const result = assembleContext({ sections, tokenBudget: 60 });
    assert.ok(result.droppedSections.includes("extra"));
  });

  it("tronca sezioni grandi mantenendo messaggi recenti", () => {
    const msgs: ContextMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `msg-${i}-${"x".repeat(40)}`,
    }));
    const result = assembleContext({
      sections: [{ id: "hist", priority: "high", messages: msgs }],
      tokenBudget: 100,
    });
    assert.ok(result.messages.length < 20);
    assert.ok(result.messages[result.messages.length - 1].content.includes("msg-19"));
  });
});

// --- compactContext ---

describe("compactContext", () => {
  it("non compatta se sotto soglia", async () => {
    const msgs: ContextMessage[] = [{ role: "user", content: "breve" }];
    const result = await compactContext({ messages: msgs, tokenBudget: 10000 });
    assert.equal(result.compacted, false);
  });

  it("compatta messaggi vecchi con riassunto locale", async () => {
    const msgs: ContextMessage[] = [
      { role: "system", content: "Sei un assistente" },
      ...Array.from({ length: 30 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Messaggio numero ${i} con testo aggiuntivo per riempire`,
      })),
    ];
    const result = await compactContext({ messages: msgs, tokenBudget: 100, force: true });
    assert.equal(result.compacted, true);
    assert.ok(result.summary);
    assert.ok(result.tokensAfter <= result.tokensBefore);
  });

  it("usa summarizeFn custom se fornita", async () => {
    const msgs: ContextMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}-${"x".repeat(100)}`,
    }));
    const result = await compactContext({
      messages: msgs,
      tokenBudget: 50,
      force: true,
      summarizeFn: async () => "riassunto custom",
    });
    assert.equal(result.compacted, true);
    assert.equal(result.summary, "riassunto custom");
  });
});

// --- Context Engine registry ---

describe("ContextEngine registry", () => {
  it("resolveContextEngine ritorna default engine", async () => {
    unregisterContextEngine("default");
    const engine = await resolveContextEngine();
    assert.equal(engine.info.id, "default");
  });

  it("registra e risolve engine custom", async () => {
    const id = "test-engine-" + Date.now();
    registerContextEngine(id, () => ({
      info: { id, name: "Test" },
      async assemble() { return { messages: [], estimatedTokens: 0, includedSections: [], droppedSections: [] }; },
      async compact() { return { ok: true, compacted: false, tokensBefore: 0, tokensAfter: 0 }; },
    }));
    const engine = await resolveContextEngine(id);
    assert.equal(engine.info.id, id);
    unregisterContextEngine(id);
  });

  it("lancia errore per engine inesistente", async () => {
    await assert.rejects(() => resolveContextEngine("nonexistent-xyz"), /non registrato/);
  });

  it("listContextEngineIds elenca gli ID registrati", () => {
    const ids = listContextEngineIds();
    assert.ok(Array.isArray(ids));
  });
});
