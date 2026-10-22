/**
 * The site's side of the team settings (phase 6): what it reads from team_state,
 * how it tells «waiting» from «applied», and what it sends to the door.
 *
 * The lists must be the box's and the schema's: a role or a class the site
 * offers and the box refuses would be a setting that never applies.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EFFORTS,
  MODEL_CLASSES,
  SETTINGS_ROLES,
  WEEKDAYS,
  loadDesired,
  readDesired,
  refusalKey,
  roleModelsChanged,
  roleModelsToSend,
  saveTeamSettings,
  settingsStatus,
} from "./team-settings";
import {
  EFFORTS as BOX_EFFORTS,
  MODEL_CLASSES as BOX_MODEL_CLASSES,
  ROLES as BOX_ROLES,
  WEEKDAYS as BOX_WEEKDAYS,
} from "../../cli/src/lib/team-settings.js";
import { AGENT_ROLES } from "../../shared/config/schema";

const OFFICE = {
  timezone: "Europe/Rome",
  windows: [
    { days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" },
  ],
};

describe("the lists", () => {
  it("are the box's and the schema's", () => {
    expect([...SETTINGS_ROLES]).toEqual(BOX_ROLES);
    expect([...SETTINGS_ROLES].sort()).toEqual([...AGENT_ROLES].sort());
    expect([...MODEL_CLASSES]).toEqual(BOX_MODEL_CLASSES);
    expect([...EFFORTS]).toEqual(BOX_EFFORTS);
    expect([...WEEKDAYS]).toEqual(BOX_WEEKDAYS);
  });
});

describe("readDesired", () => {
  it("reads the desire, the stamps and the roles", () => {
    const d = readDesired({
      desired_settings: {
        working_hours: OFFICE,
        role_models: { scout: { model: "luna", effort: "low" } },
      },
      desired_settings_at: "2026-10-22T10:00:00+00:00",
      settings_applied_at: "2026-10-22T10:00:05Z",
    });
    expect(d).toEqual({
      workingHours: OFFICE,
      roleModels: { scout: { model: "luna", effort: "low" } },
      desiredAt: "2026-10-22T10:00:00+00:00",
      appliedAt: "2026-10-22T10:00:05Z",
    });
  });

  it("tells «never asked» (undefined) from «asked 24/7» (null)", () => {
    expect(
      readDesired({ desired_settings: { role_models: {} } }).workingHours,
    ).toBeUndefined();
    expect(
      readDesired({ desired_settings: { working_hours: null } }).workingHours,
    ).toBeNull();
  });

  it("keeps only the roles, classes and efforts of the lists", () => {
    const d = readDesired({
      desired_settings: {
        role_models: {
          scout: { model: "gpt-5.6-luna", effort: "high" },
          intruso: { model: "sol" },
          critico: "sol",
        },
      },
    });
    expect(d.roleModels).toEqual({ scout: { effort: "high" } });
  });

  it("does not read working hours with a day out of the list", () => {
    const bad = {
      timezone: "UTC",
      windows: [{ days: ["mon", "funday"], start: "09:00", end: "18:00" }],
    };
    expect(
      readDesired({ desired_settings: { working_hours: bad } }).workingHours,
    ).toBeUndefined();
  });

  it("reads nothing from a missing or broken row", () => {
    for (const row of [
      null,
      undefined,
      "x",
      [],
      { desired_settings: "x", desired_settings_at: "ieri" },
    ]) {
      expect(readDesired(row)).toEqual({
        workingHours: undefined,
        roleModels: {},
        desiredAt: null,
        appliedAt: null,
      });
    }
    expect(
      readDesired({
        desired_settings: {
          working_hours: { timezone: "UTC", windows: [{ days: "mon" }] },
        },
      }).workingHours,
    ).toBeUndefined();
  });
});

describe("settingsStatus", () => {
  it("none, pending, applied", () => {
    expect(settingsStatus(null, null)).toBe("none");
    expect(settingsStatus(null, "2026-10-22T10:00:00Z")).toBe("none");
    expect(settingsStatus("2026-10-22T10:00:00Z", null)).toBe("pending");
    expect(settingsStatus("2026-10-22T10:00:00Z", "2026-10-22T09:59:59Z")).toBe(
      "pending",
    );
    expect(settingsStatus("2026-10-22T10:00:00Z", "2026-10-22T10:00:00Z")).toBe(
      "applied",
    );
  });

  it("compares instants, not strings: Z and +00:00 are the same", () => {
    expect(
      settingsStatus("2026-10-22T10:00:00.5+00:00", "2026-10-22T10:00:00.500Z"),
    ).toBe("applied");
    expect(
      settingsStatus("2026-10-22T12:00:00+02:00", "2026-10-22T10:00:01Z"),
    ).toBe("applied");
  });
});

describe("roleModelsToSend", () => {
  it("sends again the roles the site set before, and the ones changed now", () => {
    const saved = {
      capitano: { model: "sol" as const },
      scout: { model: "terra" as const, effort: "low" as const },
    };
    const edited = {
      ...saved,
      scout: { model: "luna" as const },
      critico: { effort: "high" as const },
    };
    expect(roleModelsToSend(saved, edited)).toEqual({
      capitano: { model: "sol" },
      scout: { model: "luna" },
      critico: { effort: "high" },
    });
  });

  it("a role put back on the default goes as {}, once: never a role the site did not touch", () => {
    const saved = { scout: { model: "luna" as const }, mentor: {} };
    const edited = { scout: {}, mentor: {} };
    // scout changed now → {}; mentor was already {} and is not sent again (it would wipe a desktop setting)
    expect(roleModelsToSend(saved, edited)).toEqual({ scout: {} });
    expect(roleModelsToSend({}, {})).toEqual({});
  });

  it("knows when something changed", () => {
    expect(
      roleModelsChanged(
        { scout: { model: "luna" } },
        { scout: { model: "luna" } },
      ),
    ).toBe(false);
    expect(roleModelsChanged({}, { scout: {} })).toBe(false);
    expect(roleModelsChanged({}, { scout: { effort: "low" } })).toBe(true);
  });

  it("fits the door's size for the action, with every role set (params_max_bytes 1536)", () => {
    const all = Object.fromEntries(
      SETTINGS_ROLES.map((r) => [r, { model: "terra", effort: "medium" }]),
    );
    expect(
      new TextEncoder().encode(JSON.stringify({ role_models: all })).length,
    ).toBeLessThan(1536);
    const week = {
      timezone: "America/Argentina/ComodRivadavia",
      windows: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => ({
        days: [d],
        start: "22:00",
        end: "07:30",
      })),
    };
    expect(
      new TextEncoder().encode(JSON.stringify({ working_hours: week })).length,
    ).toBeLessThan(1536);
  });
});

describe("talking to the site", () => {
  const reply = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response;

  it("asks the door with one key in params, and reads its answer", async () => {
    const fetchImpl = vi.fn(async () =>
      reply(200, { ok: true, state: "queued" }),
    );
    expect(
      await saveTeamSettings({ working_hours: null }, fetchImpl as never),
    ).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/team/settings");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      params: { working_hours: null },
    });
  });

  it("gives back the door's refusal code, or a code of its own", async () => {
    expect(
      await saveTeamSettings({ role_models: {} }, (async () =>
        reply(401, { ok: false, error: "reauth_required" })) as never),
    ).toEqual({ ok: false, code: "reauth_required" });
    expect(
      await saveTeamSettings({ role_models: {} }, (async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("html");
        },
      })) as never),
    ).toEqual({ ok: false, code: "http_502" });
    expect(
      await saveTeamSettings({ role_models: {} }, (async () => {
        throw new TypeError("offline");
      }) as never),
    ).toEqual({ ok: false, code: "network" });
    expect(
      await saveTeamSettings({ role_models: {} }, (async () =>
        reply(200, { ok: false })) as never),
    ).toEqual({ ok: false, code: "http_200" });
  });

  it("reads the desire from the site's own team_state route", async () => {
    const fetchImpl = vi.fn(async () =>
      reply(200, {
        state: {
          desired_settings: { working_hours: null },
          desired_settings_at: "2026-10-22T10:00:00Z",
        },
      }),
    );
    const d = await loadDesired(fetchImpl as never);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/team-state");
    expect(d?.workingHours).toBeNull();
    expect(await loadDesired((async () => reply(500, {})) as never)).toBeNull();
    expect(
      await loadDesired((async () => {
        throw new Error("x");
      }) as never),
    ).toBeNull();
  });

  it("names the refusals the page explains, the rest is generic", () => {
    expect(refusalKey("reauth_required")).toBe("reauth_required");
    expect(refusalKey("rate_limited")).toBe("rate_limited");
    expect(refusalKey("invalid_params")).toBe("invalid_params");
    expect(refusalKey("level_mismatch")).toBe("generic");
    expect(refusalKey("")).toBe("generic");
  });
});
