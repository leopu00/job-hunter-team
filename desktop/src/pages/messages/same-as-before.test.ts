import { describe, expect, it } from "vitest";
import { sameAsBefore } from "./same-as-before";

describe("a read that brings the same page keeps the state it had", () => {
  it("keeps the old value when the content is the same, takes the new one when it is not", () => {
    const before = [{ id: "a", at: 1 }];
    expect(sameAsBefore(before, [{ id: "a", at: 1 }])).toBe(before);
    const after = [{ id: "a", at: 2 }];
    expect(sameAsBefore(before, after)).toBe(after);
  });

  it("takes the new value when it cannot compare", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const other: Record<string, unknown> = {};
    expect(sameAsBefore(loop, other)).toBe(other);
  });
});
