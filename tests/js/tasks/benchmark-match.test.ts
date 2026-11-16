import { describe, expect, it } from "vitest";
import {
  EMPTY_QUERY,
  matchCandidates,
  matchOne,
  normalize,
  parseQuery,
  queryToParams,
  tradeRelation,
  type Candidate,
} from "../../../web/lib/benchmark-match";

const WAITER: Candidate = { kind: "round", id: "r6", os: "linux", service: "glm", cost: 3.71, sector: "hospitality", trades: ["Waiter", "Cameriere", "Kellner"] };
const RECEPTION: Candidate = { kind: "round", id: "r7", os: "windows", service: "claude", cost: 5.28, sector: "hospitality", trades: ["Receptionist", "Recepcionista"] };
const GARDENER: Candidate = { kind: "round", id: "rg", os: "macos", service: "claude", cost: 5, sector: "trades", trades: ["Giardiniere", "Gardener"] };
const ANALYST: Candidate = { kind: "round", id: "r1", os: "linux", service: "glm", cost: 3.41, sector: "it", trades: ["Data analyst"] };
const FINANCE: Candidate = { kind: "case", id: "beta-2", href: "/case-studies/beta-2", service: "codex", sector: "office", trades: ["Finance", "Credit risk analyst"] };
const ALL = [WAITER, RECEPTION, GARDENER, ANALYST, FINANCE];
const ME = { ...EMPTY_QUERY, os: "macos", service: "claude", budget: 15, trade: "giardiniere", sector: "trades" };

describe("normalize and tradeRelation", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalize("  Sanità, EDILIZIA! ")).toBe("sanita edilizia");
  });
  it("tells the same trade (in any language of the candidate), a similar one, and none", () => {
    expect(tradeRelation("cameriere", ["Waiter", "Cameriere"])).toBe("same");
    expect(tradeRelation("camerier", ["Cameriere"])).toBe("same");
    expect(tradeRelation("cameriera di sala", ["Cameriere"])).toBe("similar");
    expect(tradeRelation("giardiniere", ["Data analyst"])).toBe("none");
    expect(tradeRelation("", ["Waiter"])).toBe("none");
  });
});

describe("matching", () => {
  it("puts the round that matches every filled field first, with the reasons", () => {
    const { exact, close } = matchCandidates(ALL, { ...ME, budget: 5 });
    expect(exact.map((m) => m.candidate.id)).toEqual(["rg"]);
    expect(exact[0].reasons.map((r) => r.code).sort()).toEqual(["budget-close", "os-same", "service-same", "trade-same"]);
    expect(close.map((m) => m.candidate.id)).not.toContain("rg");
  });

  it("with another budget the round is a close one, with the reason and an estimate by proportion", () => {
    const { exact, close } = matchCandidates(ALL, ME);
    expect(exact).toEqual([]);
    const best = close[0];
    expect(best.candidate.id).toBe("rg");
    expect(best.reasons.find((r) => r.code === "budget-other")).toEqual({ code: "budget-other", value: "5", other: "15" });
    expect(best.scale).toBe(3);
  });

  it("a trade of the same sector is close even when the words do not match (a «manutentore del verde» for a gardener)", () => {
    const green: Candidate = { kind: "round", id: "rv", os: "macos", service: "claude", cost: 5, sector: "trades", trades: ["Manutentore del verde"] };
    const m = matchOne(green, ME);
    expect(m.reasons.map((r) => r.code)).toContain("sector-same");
    expect(m.score).toBeGreaterThan(0);
  });

  it("a different sector never counts as the same, and a candidate with nothing in common is left out", () => {
    const { exact, close } = matchCandidates(ALL, { ...EMPTY_QUERY, sector: "health" });
    expect(exact).toEqual([]);
    expect(close).toEqual([]);
  });

  it("a case study has no system and no budget: it is not penalised for them", () => {
    const m = matchOne(FINANCE, { ...EMPTY_QUERY, os: "macos", sector: "office", budget: 15 });
    expect(m.reasons.map((r) => r.code)).toEqual(["sector-same"]);
    expect(m.exact).toBe(true);
    expect(m.scale).toBeNull();
  });

  it("a round of two services matches either", () => {
    const both: Candidate = { kind: "round", id: "r8", os: "macos", service: "openai-glm", trades: ["Truck driver"] };
    expect(matchOne(both, { ...EMPTY_QUERY, service: "glm" }).exact).toBe(true);
    expect(matchOne(both, { ...EMPTY_QUERY, service: "openai" }).exact).toBe(true);
    expect(matchOne(both, { ...EMPTY_QUERY, service: "claude" }).exact).toBe(false);
  });

  it("nothing is shown for an empty query", () => {
    expect(matchCandidates(ALL, EMPTY_QUERY)).toEqual({ exact: [], close: [] });
  });

  it("is stable: same candidates and query give the same order", () => {
    expect(matchCandidates(ALL, { ...EMPTY_QUERY, service: "glm" })).toEqual(matchCandidates([...ALL], { ...EMPTY_QUERY, service: "glm" }));
  });
});

describe("the query string", () => {
  const options = { os: ["linux", "windows", "macos"], service: ["glm", "kimi", "openai", "claude"] };
  it("round trips and keeps a fixed order", () => {
    const params = queryToParams({ os: "macos", service: "claude", budget: 15, trade: "giardiniere", sector: "trades" });
    expect(params.toString()).toBe("os=macos&service=claude&budget=15&trade=giardiniere&sector=trades");
    expect(parseQuery(params, options)).toEqual({ os: "macos", service: "claude", budget: 15, trade: "giardiniere", sector: "trades" });
  });
  it("drops what is not an option, a bad number or a huge one", () => {
    const p = new URLSearchParams("os=beos&service=gpt&budget=abc&sector=magic&trade=cuoco");
    expect(parseQuery(p, options)).toEqual({ os: "", service: "", budget: null, trade: "cuoco", sector: "" });
    expect(parseQuery(new URLSearchParams("budget=-3"), options).budget).toBeNull();
    expect(parseQuery(new URLSearchParams("budget=1e9"), options).budget).toBeNull();
    expect(parseQuery(new URLSearchParams("budget=7,5"), options).budget).toBe(7.5);
  });
  it("an empty query has an empty query string", () => {
    expect(queryToParams(EMPTY_QUERY).toString()).toBe("");
  });
});
