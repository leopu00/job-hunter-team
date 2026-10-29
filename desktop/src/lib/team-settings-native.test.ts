import { describe, expect, it, vi } from "vitest";
import { burstTimeIsValid, pickTeamSettings, readTeamSettings, startBurst, stopBurst, workingHoursAreValid, writeTeamSettings } from "./team-settings-native";

// The page's door to the team's hours and role models (T-gap voce 2). Synthetic values only.
const LISTS = {
  roles: ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor", "closer"],
  models: ["sol", "terra", "luna"],
  efforts: ["low", "medium", "high"],
  weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  min_window_hours: 4,
};
const HOURS = { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue"], start: "09:00", end: "18:00" }] };
const reply = (extra: Record<string, unknown> = {}) => ({
  ok: true, target: "local", connectionKey: "k1", working_hours: HOURS, role_models: { scout: { model: "luna", effort: "low" } }, lists: LISTS, ...extra,
});

describe("the reply of the native command", () => {
  it("is read into the shape the page uses", () => {
    expect(pickTeamSettings(reply())).toEqual({
      ok: true,
      settings: { target: "local", connectionKey: "k1", workingHours: HOURS, roleModels: { scout: { model: "luna", effort: "low" } }, effective: null, provider: null, classApplies: null },
    });
    expect(pickTeamSettings(reply({ working_hours: null, role_models: {}, target: "vps" }))).toEqual({
      ok: true, settings: { target: "vps", connectionKey: "k1", workingHours: null, roleModels: {}, effective: null, provider: null, classApplies: null },
    });
  });

  it("reads what the launcher would use per role, and says «not available» when the reply does not carry it whole", () => {
    const roles = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor", "closer"];
    const effective = Object.fromEntries(roles.map((role) => [role, { model: "terra", modelName: "gpt-5.6-terra", effort: "high", from: "default" }]));
    effective.scout = { model: "luna", modelName: "gpt-5.6-luna", effort: "low", from: "config" };
    const read = pickTeamSettings(reply({ effective, provider: "codex", classApplies: true }));
    expect(read).toMatchObject({ ok: true, settings: { provider: "codex", classApplies: true, effective: { scout: { model: "luna", modelName: "gpt-5.6-luna", effort: "low", from: "config" } } } });
    const without = (patch: Record<string, unknown>) => ({ ...effective, scout: { ...effective.scout, ...patch } });
    for (const broken of [undefined, null, {}, [], { ...effective, closer: undefined }, without({ model: "sun" }), without({ effort: "max" }), without({ from: "guess" }), without({ modelName: "has space" }), without({ modelName: "x".repeat(41) }), without({ modelName: 5 })]) {
      expect(pickTeamSettings(reply({ effective: broken })), JSON.stringify(broken)).toMatchObject({ ok: true, settings: { effective: null } });
    }
    expect(pickTeamSettings(reply({ provider: "other", classApplies: "yes" }))).toMatchObject({ ok: true, settings: { provider: null, classApplies: null } });
  });

  it("is an error, never a default, when anything is off the closed shape", () => {
    for (const broken of [
      null, [], "x", {}, reply({ ok: undefined }), reply({ target: "cloud" }), reply({ connectionKey: "" }), reply({ connectionKey: 4 }),
      reply({ working_hours: 5 }), reply({ working_hours: { timezone: "UTC" } }), reply({ working_hours: { timezone: "UTC", windows: [{ days: [], start: "09:00", end: "18:00" }] } }),
      reply({ working_hours: { timezone: "UTC", windows: [{ days: ["mon"], start: "9:00", end: "18:00" }] } }),
      reply({ working_hours: { timezone: "UTC", windows: [], extra: 1 } }),
      reply({ role_models: { cuoco: { model: "luna" } } }), reply({ role_models: { scout: { model: "gpt" } } }), reply({ role_models: { scout: { effort: "max" } } }),
      reply({ role_models: { scout: { model: "luna", temperature: 1 } } }), reply({ role_models: [] }),
      reply({ lists: { ...LISTS, roles: ["capitano"] } }), reply({ lists: { ...LISTS, models: ["luna", "terra", "sol"] } }), reply({ lists: { ...LISTS, min_window_hours: 2 } }), reply({ lists: null }),
    ]) {
      expect(pickTeamSettings(broken), JSON.stringify(broken)).toEqual({ ok: false, error: "team_settings_unavailable" });
    }
  });

  it("keeps the native refusals the page can say, and calls any other one `other`", () => {
    for (const error of ["team_settings_read_only", "team_settings_value_invalid", "existing_team_runtime_outdated", "existing_team_runtime_target_changed", "own_vps_claim_required", "ssh_unavailable"]) {
      expect(pickTeamSettings({ ok: false, error })).toEqual({ ok: false, error });
    }
    expect(pickTeamSettings({ ok: false, error: "<b>something_new</b>" })).toEqual({ ok: false, error: "other" });
    expect(pickTeamSettings({ ok: false })).toEqual({ ok: false, error: "other" });
  });
});

describe("read and write", () => {
  it("read asks the closed op and nothing else; a throw is unavailable", async () => {
    const call = vi.fn(async () => reply());
    expect((await readTeamSettings(call)).ok).toBe(true);
    expect(call).toHaveBeenCalledWith({ op: "read" });
    expect(await readTeamSettings(async () => { throw new Error("ssh"); })).toEqual({ ok: false, error: "team_settings_unavailable" });
  });

  it("write sends only what changes, with the key, and shows what the box answers", async () => {
    const call = vi.fn(async () => reply({ role_models: { scout: { model: "terra" } } }));
    const result = await writeTeamSettings({ roleModels: { scout: { model: "sol" } } }, "k1", call);
    expect(call).toHaveBeenCalledWith({ op: "write", settings: { role_models: { scout: { model: "sol" } } }, connectionKey: "k1" });
    // what the box holds, not what was sent
    expect(result).toMatchObject({ ok: true, settings: { roleModels: { scout: { model: "terra" } } } });
    await writeTeamSettings({ workingHours: null }, "k2", call);
    expect(call).toHaveBeenLastCalledWith({ op: "write", settings: { working_hours: null }, connectionKey: "k2" });
    await writeTeamSettings({ workingHours: HOURS as never, roleModels: { mentor: {} } }, "k3", call);
    expect(call).toHaveBeenLastCalledWith({ op: "write", settings: { working_hours: HOURS, role_models: { mentor: {} } }, connectionKey: "k3" });
    expect(await writeTeamSettings({}, "k", async () => { throw new Error("x"); })).toEqual({ ok: false, error: "team_settings_unavailable" });
  });
});

describe("workingHoursAreValid", () => {
  const window = { days: ["mon", "tue"], start: "09:00", end: "18:00" };
  it("takes what the native command takes", () => {
    expect(workingHoursAreValid(null)).toBe(true);
    expect(workingHoursAreValid({ timezone: "Europe/Rome", windows: [window as never] })).toBe(true);
    expect(workingHoursAreValid({ timezone: "UTC", windows: [] })).toBe(true);
    // across midnight is valid
    expect(workingHoursAreValid({ timezone: "UTC", windows: [{ days: ["fri"], start: "22:00", end: "08:00" }] })).toBe(true);
  });

  it("refuses what it would not, the same cases team_settings.rs refuses", () => {
    const bad = [
      { timezone: "", windows: [] },
      { timezone: "x y", windows: [] },
      { timezone: "UTC", windows: [{ ...window, days: [] }] },
      { timezone: "UTC", windows: [{ ...window, days: ["mon", "mon"] }] },
      { timezone: "UTC", windows: [window, { ...window, days: ["mon"] }] },
      { timezone: "UTC", windows: [{ ...window, days: ["funday"] }] },
      { timezone: "UTC", windows: [{ ...window, start: "9:00" }] },
      { timezone: "UTC", windows: [{ ...window, start: "25:00" }] },
      { timezone: "UTC", windows: [{ ...window, end: "24:00" }] },
      { timezone: "UTC", windows: [{ ...window, end: "09:00" }] },
      { timezone: "UTC" },
      { windows: [] },
      [],
      "24/7",
    ];
    for (const hours of bad) expect(workingHoursAreValid(hours as never), JSON.stringify(hours)).toBe(false);
  });
});

describe("the burst («work flat out until HH:MM»)", () => {
  const RUNNING = { active: true, until: "2026-10-30T02:00:00+00:00", untilLocal: "03:00" };

  it("is read in its closed shape, and a box that does not say has no burst key (never «none»)", () => {
    expect(pickTeamSettings(reply({ burst: RUNNING }))).toMatchObject({ ok: true, settings: { burst: RUNNING } });
    expect(pickTeamSettings(reply({ burst: { active: false } }))).toMatchObject({ ok: true, settings: { burst: { active: false } } });
    for (const broken of [undefined, null, "on", {}, { active: "yes" }, { active: false, until: RUNNING.until }, { active: true },
      { ...RUNNING, until: "tomorrow" }, { ...RUNNING, untilLocal: "3am" }, { ...RUNNING, extra: 1 }]) {
      const read = pickTeamSettings(reply({ burst: broken }));
      expect(read, JSON.stringify(broken)).toMatchObject({ ok: true });
      expect("burst" in (read as { settings: object }).settings, JSON.stringify(broken)).toBe(false);
    }
  });

  it("starts with the time and the key, and stops with the key", async () => {
    const call = vi.fn(async () => reply({ burst: RUNNING }));
    const started = await startBurst("03:00", "k1", call);
    expect(call).toHaveBeenCalledWith({ op: "burst_start", until: "03:00", connectionKey: "k1" });
    expect(started).toMatchObject({ ok: true, settings: { burst: RUNNING } });
    await stopBurst("k1", call);
    expect(call).toHaveBeenLastCalledWith({ op: "burst_stop", connectionKey: "k1" });
  });

  it("answers with a closed error when the native side refuses or fails", async () => {
    expect(await startBurst("03:00", "k1", async () => ({ ok: false, error: "team_settings_burst_too_far" }))).toEqual({ ok: false, error: "team_settings_burst_too_far" });
    expect(await startBurst("03:00", "k1", async () => ({ ok: false, error: "team_settings_burst_too_soon" }))).toEqual({ ok: false, error: "team_settings_burst_too_soon" });
    expect(await stopBurst("k1", async () => { throw new Error("boom"); })).toEqual({ ok: false, error: "team_settings_unavailable" });
  });

  it("accepts only a time of day", () => {
    for (const ok of ["00:00", "03:00", "23:59"]) expect(burstTimeIsValid(ok)).toBe(true);
    for (const bad of ["", "3:00", "24:00", "03:60", "03:00:00", "0300", " 03:00"]) expect(burstTimeIsValid(bad)).toBe(false);
  });
});
