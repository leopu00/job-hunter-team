import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickTeamBudget, readTeamBudget } from "./team-budget-native";

// The door to the team's budget numbers: the closed shape, and nothing else. Synthetic values only.
// `budget_response.json` is the file the app's native side is tested to serve (src-tauri/tests/fixtures).
const fixtures = JSON.parse(readFileSync("src-tauri/tests/fixtures/budget_response.json", "utf8")) as Record<string, Record<string, any>>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const ahead = () => clone(fixtures.ahead_without_override);

function set(target: any, path: string, value: unknown) {
  const parts = path.split(".");
  let at = target;
  for (const part of parts.slice(0, -1)) at = at[part];
  at[parts[parts.length - 1]] = value;
}

describe("pickTeamBudget", () => {
  it("takes the three answers the native side serves, field for field", () => {
    expect(Object.keys(fixtures).sort()).toEqual(["ahead_without_override", "no_data", "override_lockout_risk"]);
    for (const [name, reply] of Object.entries(fixtures)) {
      const picked = pickTeamBudget(reply);
      expect(picked.ok, name).toBe(true);
      if (picked.ok) expect({ ok: true, ...picked.budget }, name).toEqual(reply);
    }
  });

  it("takes nothing known as null, never as a 0", () => {
    const picked = pickTeamBudget(fixtures.no_data);
    expect(picked.ok && picked.budget).toMatchObject({ week: null, rate: null, roles: null, sampleAt: null, verdict: { code: "no_data", brake: false, steps: 0 } });
    expect(picked.ok && picked.budget.burn.spentPts).toBeNull();
    const partial = ahead();
    partial.week.idealUsedPct = null;
    partial.week.line = null;
    partial.roles.unattributedPct = null;
    expect(pickTeamBudget(partial).ok).toBe(true);
  });

  it("refuses the whole answer for a code outside its list", () => {
    for (const [path, value] of [
      ["verdict.code", "<img src=x>"],
      ["verdict.code", "AVANTI"],
      ["week.line", "a lot"],
      ["burn.state", "on"],
      ["roles.window", "month"],
      ["roles.roles.0.role", "<script>"],
      ["brakes.0", "go slower, said the team"],
    ] as const) {
      const reply = ahead();
      set(reply, path, value);
      expect(pickTeamBudget(reply), `${path}=${value}`).toEqual({ ok: false, error: "budget_reply_unexpected" });
    }
  });

  it("refuses the whole answer for a number out of its range, of the wrong kind, or not finite", () => {
    for (const [path, value] of [
      ["week.usedPct", 1e9],
      ["week.usedPct", -1],
      ["week.usedPct", "46"],
      ["week.usedPct", Number.NaN],
      ["week.usedPct", Number.POSITIVE_INFINITY],
      ["week.resetAtUnix", 1.5],
      ["week.activeHoursToReset", 1e6],
      ["rate.wastedPct", 101],
      ["verdict.steps", 7],
      ["verdict.steps", 1.5],
      ["verdict.brake", "yes"],
      ["pauseSec", 99_999],
      ["sampleAgeMin", -1],
      ["sampleAt", "yesterday"],
      ["sampleAt", "2026-11-02T22:00:00<script>"],
      ["burn.remainingMin", 100_000],
      ["roles.roles.0.sharePct", 500],
      ["roles.roles.0.kt", null],
      ["roles.roles.0.agents", 1000],
    ] as const) {
      const reply = ahead();
      set(reply, path, value);
      expect(pickTeamBudget(reply), `${path}=${String(value)}`).toEqual({ ok: false, error: "budget_reply_unexpected" });
    }
  });

  it("refuses a field outside the closed list, in the answer or in any of its sections", () => {
    for (const path of ["note", "week.comment", "rate.comment", "burn.reason", "verdict.why", "roles.note", "roles.roles.0.title"]) {
      const reply = ahead();
      set(reply, path, "a sentence the team wrote");
      expect(pickTeamBudget(reply), path).toEqual({ ok: false, error: "budget_reply_unexpected" });
    }
    const missing = ahead();
    delete missing.pauseSec;
    expect(pickTeamBudget(missing).ok).toBe(false);
  });

  it("refuses too many roles or brakes", () => {
    const roles = ahead();
    roles.roles.roles = Array.from({ length: 21 }, () => clone(ahead().roles.roles[0]));
    expect(pickTeamBudget(roles).ok).toBe(false);
    const brakes = ahead();
    brakes.brakes = Array.from({ length: 9 }, () => "pace_ahead");
    expect(pickTeamBudget(brakes).ok).toBe(false);
  });

  it("passes a failure only as one of its closed codes", () => {
    expect(pickTeamBudget({ ok: false, error: "budget_unreadable" })).toEqual({ ok: false, error: "budget_unreadable" });
    expect(pickTeamBudget({ ok: false, error: "rm -rf / or a sentence" })).toEqual({ ok: false, error: "budget_unreadable" });
    for (const odd of [null, "a string", 3, [], {}, { ok: "yes" }]) expect(pickTeamBudget(odd)).toEqual({ ok: false, error: "budget_reply_unexpected" });
  });
});

describe("readTeamBudget", () => {
  it("asks the one native command, with no argument, and returns what it picks", async () => {
    const asked: unknown[][] = [];
    const result = await readTeamBudget(async (...args) => {
      asked.push(args);
      return fixtures.ahead_without_override;
    });
    expect(result.ok).toBe(true);
    expect(asked).toEqual([["team_budget_read"]]);
  });

  it("says the reason of the native error, by its own code, and never «the team does not offer it» for a failure", async () => {
    for (const code of ["process_timeout", "account_scope_mismatch", "runtime_missing", "invalid_request"]) {
      expect(await readTeamBudget(async () => Promise.reject({ code }))).toEqual({ ok: false, error: code });
    }
    // the chat's «cannot read the messages» is the budget's own «cannot be read»
    expect(await readTeamBudget(async () => Promise.reject({ code: "read_failed" }))).toEqual({ ok: false, error: "budget_unreadable" });
    // a throw with no code of its own (not a native error) can only be «cannot be read»
    expect(await readTeamBudget(async () => Promise.reject(new Error("invalid_request")))).toEqual({ ok: false, error: "budget_unreadable" });
    expect(await readTeamBudget(async () => Promise.reject("a sentence with spaces"))).toEqual({ ok: false, error: "budget_unreadable" });
  });

  it("says «the team does not offer it» only when the team's script says the file is missing", () => {
    expect(pickTeamBudget({ ok: false, error: "budget_unavailable" })).toEqual({ ok: false, error: "budget_unavailable" });
    expect(pickTeamBudget({ ok: false, error: "budget_unreadable" })).toEqual({ ok: false, error: "budget_unreadable" });
    expect(pickTeamBudget({ ok: false, error: "rm -rf / or a sentence" })).toEqual({ ok: false, error: "budget_unreadable" });
    expect(pickTeamBudget({ ok: false })).toEqual({ ok: false, error: "budget_unreadable" });
  });

  it("connects the chat again once when it is not connected, then reads again", async () => {
    let connected = false;
    const asked: string[] = [];
    const result = await readTeamBudget(
      async () => {
        asked.push(connected ? "read" : "read-disconnected");
        if (!connected) throw { code: "disconnected" };
        return fixtures.ahead_without_override;
      },
      async () => {
        connected = true;
        return { state: "ready" };
      },
    );
    expect(result.ok).toBe(true);
    expect(asked).toEqual(["read-disconnected", "read"]);
  });

  it("tells «not connected» when connecting again does not help, and does not loop", async () => {
    let reads = 0;
    let reconnects = 0;
    const disconnected = async () => {
      reads += 1;
      throw { code: "disconnected" };
    };
    expect(await readTeamBudget(disconnected, async () => { reconnects += 1; })).toEqual({ ok: false, error: "disconnected" });
    expect([reads, reconnects]).toEqual([2, 1]);
    reads = 0;
    reconnects = 0;
    expect(await readTeamBudget(disconnected, async () => { reconnects += 1; throw { code: "connect_failed" }; })).toEqual({ ok: false, error: "disconnected" });
    expect([reads, reconnects]).toEqual([1, 1]);
  });

  it("does not connect the chat again for any other failure", async () => {
    let reconnects = 0;
    await readTeamBudget(async () => Promise.reject({ code: "read_failed" }), async () => { reconnects += 1; });
    expect(reconnects).toBe(0);
  });

  it("takes the answer of a team with a week used but no rate yet («no data», the figures of 8 roles) whole", async () => {
    const given = JSON.parse(readFileSync("src-tauri/tests/fixtures/budget_team_week_no_rate.json", "utf8"));
    const picked = pickTeamBudget(given);
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.budget).toMatchObject({
      verdict: { code: "no_data", brake: false, steps: 0 },
      week: { usedPct: 37, remainingPct: 63, idealUsedPct: null, deviationPts: null, line: null },
      rate: null,
      pauseSec: 300,
      burn: { state: "off" },
    });
    expect(picked.budget.roles?.roles).toHaveLength(8);
    expect(await readTeamBudget(async () => given)).toEqual({ ok: true, budget: picked.budget });
  });
});
