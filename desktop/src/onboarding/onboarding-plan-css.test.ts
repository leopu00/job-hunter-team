// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./onboarding.css", import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

// The plan card (PlanChoice.tsx): a long label or price used to push the row past the card's border.
describe("the plan card's rows", () => {
  it("keep their column at the card's width however long a label is", () => {
    expect(rule(".onboarding-plan__list")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule(".onboarding-plan__option")).toMatch(/min-width:\s*0/);
  });

  it("let the label break and the badge go to the next line instead of leaving the row", () => {
    expect(rule(".onboarding-plan__option")).toMatch(/flex-wrap:\s*wrap/);
    const label = rule(".onboarding-plan__option > span:not(.onboarding-choice__badge)");
    expect(label).toMatch(/min-width:\s*0/);
    expect(label).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(".onboarding-plan__option .onboarding-choice__badge")).toMatch(/flex:\s*none/);
    expect(rule(".onboarding-plan__option input")).toMatch(/flex:\s*none/);
  });
});
