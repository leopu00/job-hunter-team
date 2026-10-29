import { describe, expect, it } from "vitest";
import { pickTeamSettings, readTeamSettings } from "../../lib/team-settings-native";
import { loadQuietFacts } from "./quiet-facts";

const LISTS = {
  roles: ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor", "closer"],
  models: ["sol", "terra", "luna"],
  efforts: ["low", "medium", "high"],
  weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  min_window_hours: 4,
};
const HOURS = { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue"], start: "09:00", end: "18:00" }] };
const reply = (extra: Record<string, unknown> = {}) => ({
  ok: true, target: "local", connectionKey: "k1", working_hours: HOURS, role_models: {}, lists: LISTS, ...extra,
});

// The native answer as the page's door reads it, then the facts the chat takes from it.
const asked = (answer: unknown) => loadQuietFacts(() => readTeamSettings(async () => answer));

describe("what the chat knows of the team to explain its silence", () => {
  it("takes the hours, the burst and every fact the box gives", async () => {
    const answer = reply({
      burst: { active: false },
      quiet: { budget: { usagePct: 97.5, resetAtUnix: 1790000000 }, containment: true, providerReady: false },
    });
    expect(pickTeamSettings(answer).ok).toBe(true);
    expect(await asked(answer)).toEqual({
      hours: HOURS,
      burstActive: false,
      budget: { usagePct: 97.5, resetAtUnix: 1790000000 },
      containment: true,
      providerReady: false,
    });
  });

  it("leaves out a fact the box does not give, so it is not read as «all is well»", async () => {
    const facts = await asked(reply({ burst: { active: true, until: "2026-10-30T02:00:00+00:00", untilLocal: "03:00" }, quiet: { containment: false } }));
    expect(facts).toEqual({ hours: HOURS, burstActive: true, containment: false });
    expect(facts && "budget" in facts).toBe(false);
    expect(facts && "providerReady" in facts).toBe(false);
  });

  it("gives nothing when the team does not answer", async () => {
    expect(await asked({ ok: false, error: "team_settings_unavailable" })).toBeNull();
    expect(await asked("garbage")).toBeNull();
    expect(await loadQuietFacts(() => readTeamSettings(async () => { throw new Error("down"); }))).toBeNull();
  });
});
