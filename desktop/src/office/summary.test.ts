import { describe, expect, it } from "vitest";
import { officeSummary, type SummaryAgent } from "./summary";

const a = (name: string, state: SummaryAgent["state"], drawn = true): SummaryAgent => ({ name, state, drawn });

describe("officeSummary", () => {
  it("counts the agents by state, work first and then who is stopped, in the person's language", () => {
    const team = [a("SCOUT-1", "lavora"), a("SCOUT-2", "bloccato"), a("SCORER-1", "lavora"), a("SCRITTORE-1", "aspetta_umano"), a("CRITICO", "idle")];
    expect(officeSummary(team, "en")).toBe("▶ working 2 · ⏸ blocked 1 · ✋ waiting for you 1 · ○ idle 1");
    expect(officeSummary(team, "it")).toBe("▶ lavora 2 · ⏸ bloccato 1 · ✋ aspetta te 1 · ○ libero 1");
  });

  it("names the agents the office has no seat for, which would otherwise vanish in silence", () => {
    expect(officeSummary([a("SCOUT-1", "lavora"), a("CLOSER-1", "lavora", false), a("dottore", null, false)], "en")).toBe(
      "▶ working 2 — Not in the office: CLOSER-1, DOTTORE.",
    );
  });

  it("counts no state the team does not say, and says nothing when there is nothing to say", () => {
    expect(officeSummary([a("SCOUT-1", null), a("SCOUT-2", "sconosciuto")], "en")).toBeNull();
    expect(officeSummary([], "en")).toBeNull();
  });
});
