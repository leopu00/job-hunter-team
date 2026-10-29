import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), isTauri: () => true }));

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

beforeEach(() => invoke.mockReset());

describe("what the chat knows of the team to explain its silence", () => {
  it("takes the hours, the burst and every fact the box gives", async () => {
    invoke.mockResolvedValue(reply({
      burst: { active: false },
      quiet: { budget: { usagePct: 97.5, resetAtUnix: 1790000000 }, containment: true, providerReady: false },
    }));
    expect(await loadQuietFacts()).toEqual({
      hours: HOURS,
      burstActive: false,
      budget: { usagePct: 97.5, resetAtUnix: 1790000000 },
      containment: true,
      providerReady: false,
    });
  });

  it("leaves out a fact the box does not give, so it is not read as «all is well»", async () => {
    invoke.mockResolvedValue(reply({ burst: { active: true, until: "2026-10-30T02:00:00+00:00", untilLocal: "03:00" }, quiet: { containment: false } }));
    const facts = await loadQuietFacts();
    expect(facts).toEqual({ hours: HOURS, burstActive: true, containment: false });
    expect(facts && "budget" in facts).toBe(false);
    expect(facts && "providerReady" in facts).toBe(false);
  });

  it("gives nothing when the team does not answer", async () => {
    invoke.mockResolvedValue({ ok: false, error: "team_settings_unavailable" });
    expect(await loadQuietFacts()).toBeNull();
    invoke.mockRejectedValue(new Error("down"));
    expect(await loadQuietFacts()).toBeNull();
  });
});
