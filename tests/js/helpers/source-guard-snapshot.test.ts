import { describe, expect, it } from "vitest";
import { assertMultisetSnapshot } from "../../helpers/source-guard-snapshot";

const FROZEN = {
  version: 1,
  guard: "example.matches",
  total: 3,
  elements: [{ name: "alpha", count: 1 }, { name: "beta", count: 2 }],
};
const ACTUAL = ["beta", "alpha", "beta"];

describe("exact source inventory snapshots", () => {
  it("accepts the same names and multiplicities in any observed order", () => {
    const original = structuredClone(FROZEN);
    assertMultisetSnapshot(ACTUAL, FROZEN);
    expect(FROZEN).toEqual(original);
    expect(ACTUAL).toEqual(["beta", "alpha", "beta"]);
  });

  it.each([
    ["one duplicate disappears", ["alpha", "beta"]],
    ["one occurrence is added", ["alpha", "beta", "beta", "beta"]],
    ["a different name preserves the total", ["alpha", "beta", "gamma"]],
    ["all inputs disappear", []],
  ])("rejects when %s", (_name, actual) => {
    expect(() => assertMultisetSnapshot(actual, FROZEN)).toThrow("source inventory changed");
  });

  it("reports both the missing and unexpected names", () => {
    expect(() => assertMultisetSnapshot(["alpha", "beta", "gamma"], FROZEN))
      .toThrow('missing=[{"name":"beta","count":1}], extra=[{"name":"gamma","count":1}]');
  });

  it("allows an explicitly empty matches snapshot", () => {
    assertMultisetSnapshot([], { version: 1, guard: "example.matches", total: 0, elements: [] });
  });

  it("rejects an unexpected match when the frozen inventory is empty", () => {
    expect(() => assertMultisetSnapshot(["unexpected"], {
      version: 1, guard: "example.matches", total: 0, elements: [],
    })).toThrow('extra=[{"name":"unexpected","count":1}]');
  });

  it("uses UTF-8 order for names beyond the basic multilingual plane", () => {
    assertMultisetSnapshot(["\u{10000}", "\uE000"], {
      version: 1, guard: "unicode.matches", total: 2,
      elements: [{ name: "\uE000", count: 1 }, { name: "\u{10000}", count: 1 }],
    });
  });
});

describe("snapshot validation", () => {
  it.each([
    ["null", null],
    ["unknown field", { ...FROZEN, refresh: true }],
    ["unsupported version", { ...FROZEN, version: 2 }],
    ["boolean version", { ...FROZEN, version: true }],
    ["empty guard", { ...FROZEN, guard: "" }],
    ["false total", { ...FROZEN, total: 2 }],
    ["fractional total", { ...FROZEN, total: 3.5 }],
    ["unsafe total", { ...FROZEN, total: Number.MAX_SAFE_INTEGER + 1 }],
    ["non-array elements", { ...FROZEN, elements: {} }],
    ["fractional count", { ...FROZEN, elements: [{ name: "alpha", count: 1.5 }] }],
    ["unordered names", { ...FROZEN, elements: [...FROZEN.elements].reverse() }],
    ["malformed Unicode", { ...FROZEN, elements: [{ name: "\uD800", count: 3 }] }],
  ])("rejects %s without refreshing the snapshot", (_name, snapshot) => {
    expect(() => assertMultisetSnapshot(ACTUAL, snapshot)).toThrow();
  });

  it("rejects a zero counter even when the observed and frozen multisets are empty", () => {
    expect(() => assertMultisetSnapshot([], {
      version: 1, guard: "example.matches", total: 0, elements: [{ name: "alpha", count: 0 }],
    })).toThrow("element count");
  });

  it("rejects repeated names even when the last count matches the observed multiset", () => {
    expect(() => assertMultisetSnapshot(["alpha", "alpha"], {
      version: 1, guard: "example.matches", total: 3,
      elements: [{ name: "alpha", count: 1 }, { name: "alpha", count: 2 }],
    })).toThrow("duplicate snapshot element");
  });

  it("rejects a string passed as the observed collection", () => {
    const invalid = "alpha" as unknown as Iterable<string> & object;
    expect(() => assertMultisetSnapshot(invalid, FROZEN)).toThrow("not a string");
  });

  it("rejects invalid observed names", () => {
    expect(() => assertMultisetSnapshot([""], FROZEN)).toThrow("actual element name");
    expect(() => assertMultisetSnapshot(["\uD800"], FROZEN)).toThrow("actual element name");
  });
});
