import { describe, expect, it } from "vitest";
import { ROLE_COLOR, roleColor } from "./role-color";

describe("the colour of a role", () => {
  it("is a hue of the chosen theme: an accent or a mix of two, never a background or border token a bar would vanish into", () => {
    const accent = "(?:green|yellow|blue|red|orange|purple)";
    const plain = new RegExp(`^var\\(--color-(?:${accent}|ready|white|base|muted)\\)$`);
    const mixed = new RegExp(`^color-mix\\(in srgb, var\\(--color-${accent}\\) \\d+%, var\\(--color-${accent}\\)\\)$`);
    for (const [role, color] of Object.entries(ROLE_COLOR)) expect(plain.test(color) || mixed.test(color), `${role}: ${color}`).toBe(true);
  });

  it("is different for every role, and a role the list does not know is the neutral one", () => {
    const colors = Object.values(ROLE_COLOR);
    expect(new Set(colors).size).toBe(colors.length);
    expect(roleColor("scout")).toBe(ROLE_COLOR.scout);
    expect(roleColor("a_role_nobody_wrote")).toBe("var(--color-muted)");
  });
});
