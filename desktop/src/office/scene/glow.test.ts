import { describe, expect, it } from "vitest";

import { glowTint } from "./glow";

describe("the glow of real work", () => {
  it("is no tint without a pulse and Godot's teal at the top of it", () => {
    expect(glowTint(undefined)).toBe(0xffffff);
    expect(glowTint(0)).toBe(0xffffff);
    expect(glowTint(1)).toBe(0xb8fff0);
  });

  it("grows with the pulse and never goes past it", () => {
    expect(glowTint(0.5)).toBeGreaterThan(glowTint(1));
    expect(glowTint(0.5)).toBeLessThan(0xffffff);
    expect(glowTint(3)).toBe(glowTint(1));
  });
});
