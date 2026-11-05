import { describe, expect, it } from "vitest";
import { ROLE_COLOR, roleColor } from "./role-color";

describe("the colour of a role", () => {
  it("comes from the main colour of the chosen theme (--cat-N), one slot for each of the 13 roles", () => {
    for (const [role, color] of Object.entries(ROLE_COLOR)) expect(color, role).toMatch(/^var\(--cat-\d{1,2}, /);
    expect(Object.keys(ROLE_COLOR)).toHaveLength(13);
  });

  it("is different for every role, and a role the list does not know is the neutral one", () => {
    const colors = Object.values(ROLE_COLOR);
    expect(new Set(colors).size).toBe(colors.length);
    expect(roleColor("scout")).toBe(ROLE_COLOR.scout);
    expect(roleColor("a_role_nobody_wrote")).toBe("var(--color-muted)");
  });
});
