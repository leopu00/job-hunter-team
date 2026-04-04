/** Test unitari — shared/context-engine (vitest): assembler, compactor, registry, token estimation. */
import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateTokens, estimateMessageTokens, estimateSectionTokens,
  assembleContext, systemSection, memorySection, toolsSection, historySection,
  compactContext,
  DefaultContextEngine, registerContextEngine, unregisterContextEngine,
  listContextEngineIds, resolveContextEngine, getContextEngineFactory,
} from "../../../shared/context-engine/index.js";
import type { ContextMessage, ContextSection } from "../../../shared/context-engine/index.js";

function msg(role: ContextMessage["role"], content: string): ContextMessage { return { role, content }; }
function sec(id: string, priority: ContextSection["priority"], msgs: ContextMessage[], max?: number): ContextSection {
  return { id, priority, messages: msgs, ...(max != null ? { maxTokens: max } : {}) };
}

beforeEach(() => { for (const id of listContextEngineIds()) unregisterContextEngine(id); });

// --- Token estimation ---

describe("token estimation — chars/4, overhead, sezioni", () => {
  it("estimateTokens: 1 token per 4 chars", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("12345678")).toBe(2);
    expect(estimateTokens("abc")).toBe(1); // ceil
  });
  it("estimateMessageTokens: content tokens + 4 overhead", () => {
    const m = msg("user", "12345678"); // 2 content tokens + 4 overhead
    expect(estimateMessageTokens(m)).toBe(6);
  });
  it("estimateSectionTokens: somma messaggi o usa cache", () => {
    const s = sec("s1", "high", [msg("user", "abcd"), msg("assistant", "efgh")]);
    expect(estimateSectionTokens(s)).toBe(10); // 2 × (1+4)
    const cached = sec("s2", "high", [], undefined);
    (cached as any).estimatedTokens = 42;
    expect(estimateSectionTokens(cached)).toBe(42);
  });
});

// --- Section builders ---

describe("section builders — system, memory, tools, history", () => {
  it("systemSection: priority required, role system", () => {
    const s = systemSection("Sei un assistente.");
    expect(s.id).toBe("system");
    expect(s.priority).toBe("required");
    expect(s.messages[0].role).toBe("system");
    expect(s.messages[0].content).toContain("assistente");
  });
  it("memorySection: priority high, formatta memorie; vuota → 0 messaggi", () => {
    const s = memorySection(["mem1", "mem2"]);
    expect(s.priority).toBe("high");
    expect(s.messages[0].content).toContain("mem1");
    expect(memorySection([]).messages).toHaveLength(0);
  });
  it("toolsSection: priority medium, formatta tool", () => {
    const s = toolsSection([{ name: "search", description: "cerca" }]);
    expect(s.priority).toBe("medium");
    expect(s.messages[0].content).toContain("search");
  });
  it("historySection: priority high, passa messaggi", () => {
    const msgs = [msg("user", "ciao"), msg("assistant", "ehilà")];
    const s = historySection(msgs);
    expect(s.priority).toBe("high");
    expect(s.messages).toHaveLength(2);
  });
});

// --- assembleContext ---

describe("assembleContext — budget, priorità, troncamento", () => {
  it("sezioni required sempre incluse", () => {
    const r = assembleContext({
      sections: [systemSection("system prompt")],
      tokenBudget: 10000,
    });
    expect(r.includedSections).toContain("system");
    expect(r.messages).toHaveLength(1);
  });
  it("sezione low droppata quando budget esaurito da required+high", () => {
    const r = assembleContext({
      sections: [
        systemSection("a".repeat(200)),        // ~50 + 4 tokens
        sec("low1", "low", [msg("user", "b".repeat(400))]), // ~100+4 tokens
      ],
      tokenBudget: 60, // budget solo per system
    });
    expect(r.includedSections).toContain("system");
    expect(r.droppedSections).toContain("low1");
  });
  it("priorità rispettata: required > high > medium > low", () => {
    const r = assembleContext({
      sections: [
        sec("low1", "low", [msg("user", "x".repeat(40))]),
        systemSection("sys"),
        sec("high1", "high", [msg("user", "x".repeat(40))]),
      ],
      tokenBudget: 10000,
    });
    expect(r.includedSections.indexOf("system")).toBeLessThan(r.includedSections.indexOf("high1"));
  });
  it("sezione con <50 token disponibili droppata", () => {
    const r = assembleContext({
      sections: [
        systemSection("a".repeat(380)), // ~95+4 tokens
        sec("extra", "high", [msg("user", "b".repeat(400))]),
      ],
      tokenBudget: 100, // solo ~1 token rimasto dopo system
    });
    expect(r.droppedSections).toContain("extra");
  });
  it("lista vuota → risultato vuoto", () => {
    const r = assembleContext({ sections: [], tokenBudget: 1000 });
    expect(r.messages).toHaveLength(0);
    expect(r.estimatedTokens).toBe(0);
  });
  it("troncamento: messaggi vecchi rimossi, recenti mantenuti", () => {
    const history = sec("hist", "high", [
      msg("user", "a".repeat(400)),      // ~104 tokens
      msg("assistant", "b".repeat(400)), // ~104 tokens
      msg("user", "c".repeat(20)),       // ~9 tokens
    ]);
    const r = assembleContext({ sections: [history], tokenBudget: 51 });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].content).toContain("c".repeat(20)); // più recente
  });
});

// --- compactContext ---

describe("compactContext — soglia, compaction, force", () => {
  it("sotto soglia 80% → nessuna compaction", async () => {
    const msgs = [msg("user", "ciao"), msg("assistant", "ehilà")];
    const r = await compactContext({ messages: msgs, tokenBudget: 10000 });
    expect(r.compacted).toBe(false);
    expect(r.reason).toContain("soglia");
  });
  it("sopra soglia → compatta con localSummarize", async () => {
    const msgs = [
      msg("system", "Sei un bot."),
      ...Array.from({ length: 20 }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", `msg-${i} ${"x".repeat(100)}`)),
    ];
    const r = await compactContext({ messages: msgs, tokenBudget: 200 });
    expect(r.compacted).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("Riassunto");
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore);
  });
  it("force=true compatta anche sotto soglia", async () => {
    const msgs = [msg("system", "sys"), msg("user", "a"), msg("assistant", "b"), msg("user", "c")];
    const r = await compactContext({ messages: msgs, tokenBudget: 15, force: true });
    expect(r.compacted).toBe(true);
  });
  it("<=2 messaggi → niente da compattare", async () => {
    const msgs = [msg("user", "solo uno")];
    const r = await compactContext({ messages: msgs, tokenBudget: 1, force: true });
    expect(r.compacted).toBe(false);
  });
  it("summarizeFn custom usata al posto di localSummarize", async () => {
    const msgs = [msg("system", "s"), msg("user", "a"), msg("assistant", "b"), msg("user", "c"), msg("assistant", "d")];
    const r = await compactContext({
      messages: msgs, tokenBudget: 10, force: true,
      summarizeFn: async () => "RIASSUNTO_CUSTOM",
    });
    expect(r.summary).toBe("RIASSUNTO_CUSTOM");
  });
});

// --- Registry ---

describe("context engine registry — CRUD e resolve", () => {
  it("register, list, unregister, getFactory", () => {
    const factory = () => new DefaultContextEngine();
    const r = registerContextEngine("test-eng", factory);
    expect(r.ok).toBe(true);
    expect(listContextEngineIds()).toContain("test-eng");
    expect(getContextEngineFactory("test-eng")).toBe(factory);
    expect(unregisterContextEngine("test-eng")).toBe(true);
    expect(listContextEngineIds()).not.toContain("test-eng");
  });
  it("registrazione duplicata → ok=false", () => {
    registerContextEngine("dup", () => new DefaultContextEngine());
    const r = registerContextEngine("dup", () => new DefaultContextEngine());
    expect(r.ok).toBe(false);
    expect(r.error).toContain("gia'");
  });
  it("resolveContextEngine auto-registra default", async () => {
    const engine = await resolveContextEngine();
    expect(engine.info.id).toBe("default");
    expect(engine.info.version).toBe("1.0.0");
  });
  it("DefaultContextEngine.assemble delega ad assembleContext", async () => {
    const engine = new DefaultContextEngine();
    const r = await engine.assemble({ sections: [systemSection("test")], tokenBudget: 1000 });
    expect(r.includedSections).toContain("system");
    expect(r.messages).toHaveLength(1);
  });
});
