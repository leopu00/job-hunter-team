import { describe, expect, it } from "vitest";
import { isAgentSession, NOT_IN_OFFICE_MAX, officeSummary, type SummaryAgent } from "./summary";

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

  it("names only agents' sessions, at most a few, and counts the rest", () => {
    // what a status map may hold besides agents: loops, helpers, a wrong name
    for (const name of ["doctor-watchdog", "sentinella-worker", "scout", "scout-0", "unstuck", "user", "critico-1", "x".repeat(50)])
      expect(isAgentSession(name), name).toBe(false);
    for (const name of ["CLOSER-1", "closer-12", "dottore", "MANTENITORE", "critico-s2"]) expect(isAgentSession(name), name).toBe(true);
    expect(officeSummary([a("closer-1", null, false), a("doctor-watchdog", null, false), a("unstuck", null, false)], "en")).toBe(
      "Not in the office: CLOSER-1.",
    );
    // nor counted: a loop at work is not an agent at work
    expect(officeSummary([a("scout-1", "lavora"), a("doctor-watchdog", "lavora", false)], "en")).toBe("▶ working 1");
    const many = Array.from({ length: NOT_IN_OFFICE_MAX + 2 }, (_, i) => a(`closer-${i + 1}`, null, false));
    expect(officeSummary(many, "en")).toBe("Not in the office: CLOSER-1, CLOSER-2, CLOSER-3, CLOSER-4, CLOSER-5, CLOSER-6 +2.");
  });
});
