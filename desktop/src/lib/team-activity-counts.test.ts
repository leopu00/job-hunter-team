import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTeamActivity,
  buildTeamActivityFromCounts,
  normActor,
  TEAM_ACTIVITY_ROLES,
  TIMELINE_LIMIT,
  type TeamActivityCounts,
  type TeamActivityEvent,
  type TeamActivityRole,
} from "@/lib/team-activity";
import { readDesktopVpsTeamActivity } from "./existing-team-positions";
import { setLocalTeamData } from "./local-team-data";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

afterEach(() => {
  setLocalTeamData(null);
  native.invoke.mockReset();
});

type Raw = { role: TeamActivityRole; actor: string | null; ts: string; pid: string };

/** A history of events as the team's database holds them: raw instance ids, a few with no id, mixed case. */
function history(): Raw[] {
  const actors = ["scout-1", "Scout-2", " scout-1 ", null, "scorer-1", "SCORER-2", "critico", ""];
  const out: Raw[] = [];
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const two = (value: number) => String(value).padStart(2, "0");
  for (let i = 0; i < 400; i++) {
    const role = TEAM_ACTIVITY_ROLES[next() % TEAM_ACTIVITY_ROLES.length];
    const day = 1 + (next() % 28);
    const ts = `2026-${next() % 2 ? "10" : "09"}-${two(day)}T${two(i % 24)}:${two(next() % 60)}:${two((i * 13) % 60)}Z`;
    out.push({ role, actor: actors[next() % actors.length], ts, pid: String(1 + (next() % 30)) });
  }
  // one ts per event, so that «newest first» has a single answer
  return out.filter((ev, i, all) => all.findIndex((other) => other.ts === ev.ts) === i);
}

/** What the reader in the team's container sends back for `events` and a range: counts made at the source. */
function countedAtTheSource(events: Raw[], from: string, to: string): TeamActivityCounts {
  const inside = events.filter((ev) => ev.ts.slice(0, 10) >= from && ev.ts.slice(0, 10) <= to);
  const daily = new Map<string, { role: string; actor: string | null; day: string; n: number }>();
  for (const ev of inside) {
    const key = `${ev.role}|${ev.actor}|${ev.ts.slice(0, 10)}`;
    const row = daily.get(key) ?? { role: ev.role, actor: ev.actor, day: ev.ts.slice(0, 10), n: 0 };
    row.n++;
    daily.set(key, row);
  }
  const seen = new Map<string, { role: string; actor: string | null; last: string }>();
  for (const ev of events) {
    const key = `${ev.role}|${ev.actor}`;
    const row = seen.get(key);
    if (!row || ev.ts > row.last) seen.set(key, { role: ev.role, actor: ev.actor, last: ev.ts });
  }
  const newest = [...inside].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, TIMELINE_LIMIT);
  const meta: TeamActivityCounts["meta"] = {};
  for (const ev of newest.slice(0, 40)) meta[ev.pid] = { legacy_id: 1000 + Number(ev.pid), title: `Role ${ev.pid}`, company: `Co ${Number(ev.pid) % 4}` };
  return { daily: [...daily.values()], newest, seen: [...seen.values()], meta };
}

const strip = (activity: ReturnType<typeof buildTeamActivity>) => ({
  ...activity,
  generatedAt: "",
  actors: [...activity.actors].sort((a, b) => `${a.role} ${a.actor}`.localeCompare(`${b.role} ${b.actor}`)),
});

describe("the activity counted at the source is the activity counted from every event", () => {
  it.each([
    ["a range inside the history", "2026-09-10", "2026-10-05"],
    ["a range with days of no event", "2026-09-29", "2026-10-12"],
    ["a range outside the history", "2026-01-01", "2026-01-31"],
    ["a single day", "2026-10-20", "2026-10-20"],
  ])("%s", (_name, from, to) => {
    const events = history();
    const everyEvent: TeamActivityEvent[] = events.map((ev) => ({ role: ev.role, actor: normActor(ev.role, ev.actor), ts: ev.ts, pid: ev.pid }));
    const expected = buildTeamActivity(everyEvent, from, to);
    const got = buildTeamActivityFromCounts(countedAtTheSource(events, from, to), from, to);
    expect(strip(got)).toEqual({
      ...strip(expected),
      // the feed is enriched with the position the event touched; the timeline is not
      recent: expected.recent.map((ev) => ({ ...ev, title: `Role ${ev.pid}`, company: `Co ${Number(ev.pid!) % 4}`, legacyId: 1000 + Number(ev.pid) })),
    });
    // there is something to compare in the first three
    if (from === "2026-09-10") expect(got.totalAll).toBeGreaterThan(50);
    if (from === "2026-01-01") expect(got.totalAll).toBe(0);
  });

  it("ignores a row of a role it does not know, a day outside the range and a count that is not a number", () => {
    const got = buildTeamActivityFromCounts(
      {
        daily: [
          { role: "scout", actor: "scout-1", day: "2026-10-02", n: 3 },
          { role: "intruder", actor: "x", day: "2026-10-02", n: 9 },
          { role: "scout", actor: "scout-1", day: "2026-11-02", n: 9 },
          { role: "scout", actor: "scout-1", day: "2026-10-03", n: -1 },
          { role: "scout", actor: "scout-1", day: "2026-10-03", n: 1.5 },
        ],
        newest: [{ role: "intruder", actor: null, ts: "2026-10-02T00:00:00Z", pid: null }],
        seen: [],
        meta: {},
      },
      "2026-10-01",
      "2026-10-05",
    );
    expect(got.totalAll).toBe(3);
    expect(got.actors.map((a) => a.actor)).toEqual(["scout-1"]);
    expect(got.timeline).toEqual([]);
  });
});

describe("the bridge's read of the activity", () => {
  const range = ["2026-10-05", "2026-10-15"] as const;

  it("is not asked outside the team of this computer: an existing team keeps what it read", async () => {
    expect(await readDesktopVpsTeamActivity(...range)).toEqual({ source: "not_desktop" });
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("asks the native read for the closed range, and takes only an answer of the shape it expects", async () => {
    setLocalTeamData("local:abc");
    native.invoke.mockResolvedValueOnce({ ok: true, data: { daily: [], newest: [], seen: [], meta: {} } });
    expect(await readDesktopVpsTeamActivity(...range)).toEqual({ source: "vps", data: { daily: [], newest: [], seen: [], meta: {} } });
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "team_activity", from: range[0], to: range[1] } });
    native.invoke.mockResolvedValueOnce({ ok: true, data: { daily: [], newest: [] } });
    expect(await readDesktopVpsTeamActivity(...range)).toEqual({ source: "unavailable", code: "desktop_bad_reply" });
    native.invoke.mockResolvedValueOnce({ ok: false, error: "local_team_not_running", kind: "application" });
    expect(await readDesktopVpsTeamActivity(...range)).toEqual({ source: "unavailable", code: "local_team_not_running" });
  });
});
