import { describe, expect, it } from "vitest";
import { parseHarnessChoice } from "./harness-choice";

// The reply of the native command is closed again here: the names of a Pi sign-in that is not the right one are plain lowercase words, at most eight.
const base = { harness: "pi", provider: "openai", piAllowed: true, login: "signed_out" };

describe("parseHarnessChoice", () => {
  it("keeps the entry names of a sign-in that is for another provider, and only plain lowercase words", () => {
    expect(parseHarnessChoice({ ...base, loginFound: ["anthropic", "Bad Name", "x\ny", "a_b-c.1", ""] })?.loginFound).toEqual(["anthropic", "a_b-c.1"]);
    expect(parseHarnessChoice({ ...base, loginFound: Array.from({ length: 12 }, (_, i) => `n${i}`) })?.loginFound).toHaveLength(8);
  });

  it("has no names when the field is absent or is not a list", () => {
    expect(parseHarnessChoice(base)?.loginFound).toEqual([]);
    expect(parseHarnessChoice({ ...base, loginFound: "anthropic" })?.loginFound).toEqual([]);
  });

  it("still refuses a reply outside the closed shape", () => {
    expect(parseHarnessChoice({ ...base, login: "/etc/passwd" })).toBeNull();
    expect(parseHarnessChoice(null)).toBeNull();
  });
});
