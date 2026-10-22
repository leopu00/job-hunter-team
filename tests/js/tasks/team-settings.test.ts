/**
 * Phase 6 on the box: the settings the site asks for (working hours, model and
 * effort per role) reach jht.config.json only through closed lists, on the
 * paired user's row, once per version, never from the future.
 *
 * reconcileSettings runs for real on a config file in a temporary folder; the
 * network is fake. The lists are checked against the config schema the app
 * and the site validate with, so the box never accepts what the schema refuses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EFFORTS,
  MODEL_CLASSES,
  ROLES,
  applySettings,
  settingsRefusal,
  validSettings,
  validWorkingHours,
} from "../../../cli/src/lib/team-settings.js";
import { reconcileSettings } from "../../../cli/src/lib/team-state-reconciler.js";
import { readRendezvousState } from "../../../cli/src/commands/cloud.js";
import { AGENT_ROLES, RoleModelSchema, WorkingHoursSchema } from "../../../shared/config/schema";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-22T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const OFFICE = { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }] };

describe("the settings' closed lists", () => {
  it.each([
    ["office hours", OFFICE],
    ["24/7 (null)", null],
    ["no windows", { timezone: "UTC", windows: [] }],
    ["past midnight", { timezone: "Asia/Tokyo", windows: [{ days: ["sat"], start: "22:00", end: "04:00" }] }],
  ])("accepts working hours: %s", (_label, wh) => {
    expect(validWorkingHours(wh)).toBe(true);
  });

  it.each([
    ["a timezone that does not exist", { ...OFFICE, timezone: "Mars/Olympus" }],
    ["a timezone with a path in it", { ...OFFICE, timezone: "../../etc" }],
    ["a day twice", { timezone: "UTC", windows: [{ days: ["mon"], start: "09:00", end: "18:00" }, { days: ["mon"], start: "19:00", end: "23:30" }] }],
    ["a block under four hours", { timezone: "UTC", windows: [{ days: ["mon"], start: "09:00", end: "12:00" }] }],
    ["start equal to end", { timezone: "UTC", windows: [{ days: ["mon"], start: "09:00", end: "09:00" }] }],
    ["an hour that is not HH:MM", { timezone: "UTC", windows: [{ days: ["mon"], start: "9:00", end: "18:00" }] }],
    ["an unknown day", { timezone: "UTC", windows: [{ days: ["funday"], start: "09:00", end: "18:00" }] }],
    ["no days", { timezone: "UTC", windows: [{ days: [], start: "09:00", end: "18:00" }] }],
    ["an extra key", { ...OFFICE, script: "rm -rf /" }],
    ["an extra key in a window", { timezone: "UTC", windows: [{ days: ["mon"], start: "09:00", end: "18:00", note: "x" }] }],
    ["eight windows", { timezone: "UTC", windows: Array.from({ length: 8 }, () => ({ days: ["mon"], start: "09:00", end: "18:00" })) }],
  ])("refuses working hours with %s", (_label, wh) => {
    expect(validWorkingHours(wh)).toBe(false);
  });

  it("never accepts working hours the config schema refuses", () => {
    const samples = [
      OFFICE,
      { timezone: "UTC", windows: [] },
      { timezone: "UTC", windows: [{ days: ["mon"], start: "09:00", end: "12:00" }] },
      { timezone: "UTC", windows: [{ days: ["mon"], start: "09:00", end: "09:00" }] },
      { timezone: "UTC", windows: [{ days: ["mon"], start: "09:00", end: "18:00" }, { days: ["mon"], start: "19:00", end: "23:30" }] },
      { timezone: "UTC", windows: [{ days: ["sun"], start: "20:00", end: "01:00" }] },
      { timezone: "UTC", windows: [{ days: [], start: "09:00", end: "18:00" }] },
    ];
    for (const wh of samples) {
      if (validWorkingHours(wh)) expect(WorkingHoursSchema.safeParse(wh).success, JSON.stringify(wh)).toBe(true);
    }
  });

  it("has the roles, classes and efforts of the config schema", () => {
    expect([...ROLES].sort()).toEqual([...AGENT_ROLES].sort());
    expect(RoleModelSchema.shape.model.unwrap().options).toEqual(MODEL_CLASSES);
    expect(RoleModelSchema.shape.effort.unwrap().options).toEqual(EFFORTS);
  });

  it.each([
    [{ role_models: { scout: { model: "luna", effort: "medium" } } }, true],
    [{ role_models: {} }, true],
    [{ working_hours: OFFICE, role_models: { capitano: { model: "terra" } } }, true],
    [{}, false],
    [{ providers: { openai: {} } }, false],
    [{ role_models: { scout: { model: "gpt-5.6-luna" } } }, false],
    [{ role_models: { scot: { model: "luna" } } }, false],
    [{ role_models: { scout: { model: "luna", efort: "low" } } }, false],
    [{ working_hours: OFFICE, api_key: "x" }, false],
    ["working_hours", false],
  ])("validSettings(%j) is %s", (desired, ok) => {
    expect(validSettings(desired) !== null).toBe(ok);
  });

  it("moves only team.working_hours and team.role_models", () => {
    const config = { active_provider: "openai", providers: { openai: { api_key: "k" } }, team: { local_scorer: { enabled: false } } };
    const next = applySettings(config, { working_hours: OFFICE, role_models: { scout: { model: "luna" } } });
    expect(next).toEqual({ ...config, team: { local_scorer: { enabled: false }, working_hours: OFFICE, role_models: { scout: { model: "luna" } } } });
    expect(config.team).toEqual({ local_scorer: { enabled: false } });
    expect(applySettings(next, { working_hours: null }).team).toEqual({ local_scorer: { enabled: false }, role_models: { scout: { model: "luna" } } });
  });

  it("merges role_models role by role: a role set on the desktop and not sent stays", () => {
    const config = { team: { role_models: { capitano: { model: "sol", effort: "high" }, scout: { model: "terra" } } } };
    const next = applySettings(config, { role_models: { scout: { model: "luna", effort: "low" }, critico: { effort: "medium" } } });
    expect(next.team.role_models).toEqual({
      capitano: { model: "sol", effort: "high" },
      scout: { model: "luna", effort: "low" },
      critico: { effort: "medium" },
    });
    expect(config.team.role_models).toEqual({ capitano: { model: "sol", effort: "high" }, scout: { model: "terra" } });
  });

  it("replaces the whole entry of a role it sends: a field not sent goes back to the default", () => {
    const config = { team: { role_models: { scout: { model: "luna", effort: "high" } } } };
    expect(applySettings(config, { role_models: { scout: { model: "terra" } } }).team.role_models).toEqual({ scout: { model: "terra" } });
  });

  it("an empty entry puts the role back on the default, and no roles left drops role_models", () => {
    const config = { team: { local_scorer: { enabled: false }, role_models: { capitano: { model: "sol" }, scout: { model: "luna" } } } };
    const one = applySettings(config, { role_models: { scout: {} } });
    expect(one.team.role_models).toEqual({ capitano: { model: "sol" } });
    expect(applySettings(one, { role_models: { capitano: {} } }).team).toEqual({ local_scorer: { enabled: false } });
    expect(applySettings({}, { role_models: { scout: {} } }).team).toEqual({});
  });

  it("an empty role_models changes nothing", () => {
    const config = { team: { role_models: { capitano: { model: "sol" } } } };
    expect(applySettings(config, { role_models: {} }).team.role_models).toEqual({ capitano: { model: "sol" } });
  });
});

describe("settingsRefusal", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    user_id: OWNER,
    desired_settings: { role_models: { scout: { model: "luna" } } },
    desired_settings_at: at(-30_000),
    ...over,
  });
  const ctx = { ownerId: OWNER, serverNow: NOW, lastApplied: null as number | null };

  it.each([
    [row(), null],
    [row({ desired_settings: null, desired_settings_at: null }), "nothing_desired"],
    [row({ user_id: OTHER }), "not_owner"],
    [row({ desired_settings_at: null }), "no_settings_time"],
    [row({ desired_settings_at: at(2 * 60_000) }), "requested_in_future"],
    [row({ desired_settings: { role_models: { scout: { model: "gpt" } } } }), "invalid_settings"],
    // no age limit: a version from last week is the user's latest desire
    [row({ desired_settings_at: at(-7 * 24 * 3600_000) }), null],
  ])("%j → %s", (state, reason) => {
    expect(settingsRefusal(state, ctx)).toBe(reason);
  });

  it("refuses every version when the box does not know its user, and older or equal versions", () => {
    expect(settingsRefusal(row(), { ...ctx, ownerId: null })).toBe("owner_unknown");
    expect(settingsRefusal(row(), { ...ctx, lastApplied: NOW - 30_000 })).toBe("already_applied");
    expect(settingsRefusal(row(), { ...ctx, lastApplied: NOW })).toBe("already_applied");
    expect(settingsRefusal(row(), { ...ctx, lastApplied: NOW - 60_000 })).toBeNull();
  });
});

describe("reconcileSettings on the box", () => {
  let dir: string;
  let patches: Array<Record<string, unknown>>;
  const CONFIG = { enabled: true, base_url: "https://site", token: "tok", user_id: OWNER };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "team-settings-"));
    patches = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body?: string }) => {
        patches.push(JSON.parse(init.body || "{}"));
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  const paths = () => ({ configPath: join(dir, "jht.config.json"), appliedPath: join(dir, "applied.json"), serverNow: NOW });
  const state = (over: Record<string, unknown> = {}) => ({
    user_id: OWNER,
    desired_settings: { working_hours: OFFICE },
    desired_settings_at: at(-30_000),
    ...over,
  });
  const config = () => JSON.parse(readFileSync(join(dir, "jht.config.json"), "utf-8"));

  it("applies a version once, keeps the rest of the config, and tells the site", async () => {
    writeFileSync(join(dir, "jht.config.json"), JSON.stringify({ active_provider: "openai", providers: { openai: { api_key: "k" } } }));
    expect(await reconcileSettings(CONFIG, state(), paths())).toEqual({ applied: true });
    expect(config()).toEqual({ active_provider: "openai", providers: { openai: { api_key: "k" } }, team: { working_hours: OFFICE } });
    expect(patches).toEqual([{ settings_applied_at: at(-30_000) }]);
    // the same version again, also after a restart of the box: nothing
    expect(await reconcileSettings(CONFIG, state(), paths())).toEqual({ applied: false, skipped: "already_applied" });
    // a newer version: applied
    const newer = state({ desired_settings: { working_hours: null, role_models: { scout: { model: "luna" } } }, desired_settings_at: at(-1000) });
    expect(await reconcileSettings(CONFIG, newer, paths())).toEqual({ applied: true });
    expect(config().team).toEqual({ role_models: { scout: { model: "luna" } } });
  });

  it("writes the config private", async () => {
    await reconcileSettings(CONFIG, state(), paths());
    if (process.platform !== "win32") {
      const { statSync } = await import("node:fs");
      expect(statSync(join(dir, "jht.config.json")).mode & 0o077).toBe(0);
    }
  });

  it.each([
    ["another user's row", { user_id: OTHER }],
    ["a version from the future", { desired_settings_at: at(2 * 60_000) }],
    ["a value out of the lists", { desired_settings: { role_models: { scout: { model: "gpt-5.6-luna" } } } }],
    ["a key out of the lists", { desired_settings: { working_hours: OFFICE, providers: {} } }],
    ["no stamp", { desired_settings_at: null }],
  ])("does not touch the config for %s", async (_label, over) => {
    writeFileSync(join(dir, "jht.config.json"), '{"keep":true}');
    const result = await reconcileSettings(CONFIG, state(over), paths());
    expect(result.applied).toBe(false);
    expect(readFileSync(join(dir, "jht.config.json"), "utf-8")).toBe('{"keep":true}');
    expect(existsSync(join(dir, "applied.json"))).toBe(false);
    expect(patches).toEqual([]);
  });

  it("does not apply when the box does not know its user", async () => {
    expect(await reconcileSettings({ ...CONFIG, user_id: undefined }, state(), paths())).toMatchObject({ refused: "owner_unknown" });
    expect(existsSync(join(dir, "jht.config.json"))).toBe(false);
  });

  it("never overwrites a config it cannot read", async () => {
    writeFileSync(join(dir, "jht.config.json"), "{ half a json");
    expect(await reconcileSettings(CONFIG, state(), paths())).toMatchObject({ refused: "config_unreadable" });
    expect(readFileSync(join(dir, "jht.config.json"), "utf-8")).toBe("{ half a json");
    if (process.platform !== "win32" && process.getuid?.() !== 0) {
      writeFileSync(join(dir, "jht.config.json"), "{}");
      chmodSync(join(dir, "jht.config.json"), 0o000);
      expect(await reconcileSettings(CONFIG, state(), paths())).toMatchObject({ refused: "config_unreadable" });
      chmodSync(join(dir, "jht.config.json"), 0o600);
    }
  });
});

describe("the rendezvous read before and after migration 099", () => {
  it("asks for the settings columns, and after a refusal goes on without them for an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const asked: string[][] = [];
    let has099 = false;
    const reader = {
      async readTeamState(columns: string[]) {
        asked.push(columns);
        if (columns.includes("desired_settings") && !has099) throw new Error("400 column does not exist");
        return { user_id: OWNER };
      },
    };
    const CONFIG = { enabled: true, base_url: "https://site", token: "tok", user_id: OWNER };
    await readRendezvousState(CONFIG, { reader });
    await readRendezvousState(CONFIG, { reader });
    // one refused try, then the read without the columns, twice
    expect(asked.map((c) => c.includes("desired_settings"))).toEqual([true, false, false]);
    has099 = true;
    vi.setSystemTime(NOW + 60 * 60 * 1000);
    await readRendezvousState(CONFIG, { reader });
    expect(asked.at(-1)).toContain("desired_settings_at");
    vi.useRealTimers();
  });
});
