/**
 * The daily cap counts two shapes of time in one query — a live defect of the
 * product, pinned here until the product fixes it (24/09).
 *
 * `_sent_today` in `shared/skills/apply_gate.py` — and the port that copies it,
 * `closer.ts` — counts what the automation sent today from three sources, in one
 * UNION, and the three do not agree on what "today" is:
 *
 *     applications:  date(applied_at)              = date('now','localtime')
 *     email:         date(send_started_at,'local') = date('now','localtime')
 *     reservations:  date(reserved_at,'local')     = date('now','localtime')
 *
 * The rows are UTC (SQLite's `CURRENT_TIMESTAMP`, and every writer of the
 * column), so the first branch compares a UTC date with a LOCAL date. In the
 * hours where those are different days — 00:00-02:00 in Rome, the whole evening
 * from 20:00 for a negative offset — a send made minutes ago is not counted by
 * that branch, while the other two count it.
 *
 * What saves the wall today is the reservations branch: the real send path
 * (`apply_flow.py`, `email_application.py`) reserves a slot before sending, and
 * that branch converts the column. Measured, both zones, with the real gate
 * (24/09): with the reservation the queue answers `daily_cap_reached` in Rome
 * and in UTC alike; WITHOUT it — a send recorded by a path that did not reserve,
 * or a database from before `apply_cap_reservations` — the same data answers
 * `daily_cap_reached` in UTC and `queue_ready`, `sent_today: 0`, in Rome. The
 * person's wall then depends on the machine's zone and the hour, which is not a
 * wall.
 *
 * The test below fixes the hour instead of waiting for it: the predicates are
 * evaluated in a child process with the zone forced and the instant written
 * out, so the mismatch is measured the same way at any time of day. When the
 * product converts that first branch too, these assertions flip, and that is
 * the point of pinning them.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RUNTIME } from "./helpers/python-skills.ts";

/**
 * The two predicate forms of `_sent_today`, on one row and one `now`, in a zone
 * of our choosing. A child process because SQLite reads the zone from the
 * environment at start, and the point here is to compare zones.
 */
function counted(tz: string, row: string, now: string): { applicationsBranch: number; otherBranches: number; localNow: string } {
  const script =
    `const { DatabaseSync } = require("node:sqlite");` +
    `const db = new DatabaseSync(":memory:");` +
    `const r = db.prepare("SELECT date(?) = date(?, 'localtime') AS a, date(?, 'localtime') = date(?, 'localtime') AS b, date(?, 'localtime') AS n")` +
    `.get(${JSON.stringify(row)}, ${JSON.stringify(now)}, ${JSON.stringify(row)}, ${JSON.stringify(now)}, ${JSON.stringify(now)});` +
    `process.stdout.write(JSON.stringify(r));`;
  const out = execFileSync(process.execPath, ["-e", script], { env: { PATH: process.env["PATH"] ?? "", TZ: tz }, encoding: "utf8" });
  const parsed = JSON.parse(out) as { a: number; b: number; n: string };
  return { applicationsBranch: parsed.a, otherBranches: parsed.b, localNow: parsed.n };
}

describe("the daily cap's two shapes of time (live defect, pinned)", () => {
  it("does not count a send of minutes ago in the first hours of a local day (Rome, +02:00)", () => {
    // 01:00 local on the 24th is 23:00Z on the 23rd; the send was at 00:30 local.
    const seen = counted("Europe/Rome", "2026-09-23 22:30:00", "2026-09-23 23:00:00");
    expect(seen.localNow).toBe("2026-09-24");
    // The branch that reads the column as stored: the row's UTC date is the 23rd, so "not today".
    expect(seen.applicationsBranch).toBe(0);
    // The branches that convert it: the same instant IS today. One UNION, two answers.
    expect(seen.otherBranches).toBe(1);
  });

  it("does not count the whole evening where the offset is negative (New York, -04:00)", () => {
    // 22:00 local on the 23rd is 02:00Z on the 24th; the send was at 20:00 local.
    const seen = counted("America/New_York", "2026-09-24 00:00:00", "2026-09-24 02:00:00");
    expect(seen.localNow).toBe("2026-09-23");
    expect(seen.applicationsBranch).toBe(0);
    expect(seen.otherBranches).toBe(1);
    // Four hours of every day, not two: from 20:00 local to midnight.
    expect(counted("America/New_York", "2026-09-24 00:01:00", "2026-09-24 00:02:00").applicationsBranch).toBe(0);
  });

  it("agrees with itself where the offset is zero, which is why nobody saw this", () => {
    const seen = counted("UTC", "2026-09-23 22:30:00", "2026-09-23 23:00:00");
    expect(seen.applicationsBranch).toBe(1);
    expect(seen.otherBranches).toBe(1);
  });

  it("holds the mismatch in both sources, so a fix on one side cannot pass unnoticed", () => {
    const port = readFileSync(join(RUNTIME, "src", "parity", "skills", "closer.ts"), "utf8");
    const script = readFileSync(join(RUNTIME, "..", "..", "shared", "skills", "apply_gate.py"), "utf8");
    // The port copies the script: the same unconverted column on the applications branch.
    expect(port).toContain("date(applied_at) = date('now', 'localtime')");
    expect(script).toContain("AND date(applied_at) = date('now', 'localtime')");
    // And the same conversion on the other two, which is the shape the fix takes.
    expect(port).toContain("date(reserved_at, 'localtime') = date('now', 'localtime')");
    expect(script).toContain("date(reserved_at, 'localtime') = date('now', 'localtime')");
  });
});
