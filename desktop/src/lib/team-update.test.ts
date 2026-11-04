import { describe, expect, it } from "vitest";
import { ERROR_CATALOG } from "./error-catalog";
import { TEAM_UPDATE_COMMAND, wantsTeamUpdate } from "./team-update";

describe("wantsTeamUpdate", () => {
  it("is true for the Budget's «the team does not offer the figures yet» and for every message whose action is «Update the team»", () => {
    expect(wantsTeamUpdate("budget_unavailable")).toBe(true);
    const asking = Object.entries(ERROR_CATALOG).filter(([, copy]) => /^Update the team\b/i.test(copy.action.en));
    expect(asking.length).toBeGreaterThanOrEqual(9);
    for (const [code, copy] of asking) {
      expect(wantsTeamUpdate(code), code).toBe(true);
      // The Italian copy says the same thing: the two sources of the catalog never disagree about it.
      expect(copy.action.it, code).toMatch(/^Aggiorna (la squadra|il team)\b/);
    }
  });

  it("is false for every other message, for a code the catalog does not know and for no code", () => {
    for (const [code, copy] of Object.entries(ERROR_CATALOG)) {
      if (!/^Update the team\b/i.test(copy.action.en)) expect(wantsTeamUpdate(code), code).toBe(false);
    }
    expect(wantsTeamUpdate("budget_unreadable")).toBe(false);
    expect(wantsTeamUpdate("a_code_nobody_wrote")).toBe(false);
    expect(wantsTeamUpdate(null)).toBe(false);
    expect(wantsTeamUpdate(undefined)).toBe(false);
  });

  it("gives the command the host answers to", () => {
    expect(TEAM_UPDATE_COMMAND).toBe("jht upgrade");
  });
});
