/**
 * A position applied on the box whose application never arrives complete.
 *
 * The push route writes it without its applied status, acks it and lists it in
 * `positions.awaiting_application`; the box's cursor moves on and the cloud
 * keeps it unpublished. Before, it went to quarantine, where it could be seen:
 * now the only trace is that list, so the box counts the rounds a position
 * stays in it and warns once when they reach the threshold.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AWAITING_APPLICATION_WARN_ROUNDS,
  finishAwaitingRound,
  observeAwaitingResponse,
  readAwaitingApplication,
  saveAwaitingApplication,
} from "../../../cli/src/lib/cloud-push-awaiting.js";

const dirs: string[] = [];
let previousHome: string | undefined;

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "jht-push-awaiting-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  process.exitCode = undefined;
  if (previousHome !== undefined) {
    process.env.JHT_HOME = previousHome;
    previousHome = undefined;
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A push round as performPush makes it: positions, then applications. */
function round(
  state: { rounds: Record<string, number> },
  positions: { sent: number[]; awaiting: number[] },
  appliedByApplications: number[] = [],
) {
  observeAwaitingResponse(
    state,
    "positions",
    positions.sent.map((id) => ({ id })),
    { positions: { awaiting_application: positions.awaiting, applied: [] } },
  );
  observeAwaitingResponse(state, "applications", [], {
    positions: { awaiting_application: [], applied: appliedByApplications },
  });
  return finishAwaitingRound(state);
}

describe("positions awaiting their application", () => {
  it("one published by the applications request of the same round is not counted", () => {
    const state = { rounds: {} };
    const result = round(state, { sent: [73], awaiting: [73] }, [73]);
    expect(result).toEqual({ warn: false, stuck: [] });
    expect(state.rounds).toEqual({});
  });

  it(`one whose application never arrives warns once, at round ${AWAITING_APPLICATION_WARN_ROUNDS}`, () => {
    const state = { rounds: {} };
    // Round 1 sends it; the cursor then moves on and it is never sent again.
    const results = [round(state, { sent: [74], awaiting: [74] })];
    for (let i = 1; i < AWAITING_APPLICATION_WARN_ROUNDS + 2; i += 1) {
      results.push(round(state, { sent: [], awaiting: [] }));
    }
    const warned = results.flatMap((result, index) =>
      result.warn ? [index + 1] : [],
    );
    expect(warned).toEqual([AWAITING_APPLICATION_WARN_ROUNDS]);
    expect(results[AWAITING_APPLICATION_WARN_ROUNDS - 1].stuck).toEqual([74]);
  });

  it("one sent again and no longer awaiting (published, or not applied any more) stops waiting", () => {
    const state = { rounds: {} };
    round(state, { sent: [75, 76], awaiting: [75, 76] });
    round(state, { sent: [75], awaiting: [] });
    expect(Object.keys(state.rounds)).toEqual(["76"]);
  });

  it("the count survives the process, and nothing waiting writes no file", () => {
    const path = join(tempDir(), "awaiting.json");
    expect(saveAwaitingApplication({ rounds: {} }, path)).toBe(true);
    expect(existsSync(path)).toBe(false);

    const state = { rounds: {} };
    round(state, { sent: [77], awaiting: [77] });
    expect(saveAwaitingApplication(state, path)).toBe(true);
    expect(readAwaitingApplication(path)).toEqual({ rounds: { "77": 1 } });
  });
});

describe("the push warns about them, through the real writer", () => {
  function fixture() {
    previousHome = process.env.JHT_HOME;
    const home = tempDir();
    process.env.JHT_HOME = home;
    writeFileSync(
      join(home, "cloud.json"),
      JSON.stringify({
        enabled: true,
        base_url: "https://cloud.example.test",
        token: "jht_sync_synthetic-test-token",
      }),
    );
    const dbPath = join(home, "jobs.db");
    const db = new DatabaseSync(dbPath);
    // The whole schema the push reader selects from positions.
    db.exec(`
      CREATE TABLE positions (
        id INTEGER PRIMARY KEY, title TEXT, company TEXT, company_id INTEGER,
        url TEXT, location TEXT, remote_type TEXT, status TEXT, notes TEXT,
        source TEXT, jd_text TEXT, jd_summary TEXT, requirements TEXT,
        found_by TEXT, found_at TEXT, deadline TEXT, last_checked TEXT,
        last_actor TEXT, salary_declared_min INTEGER,
        salary_declared_max INTEGER, salary_declared_currency TEXT,
        salary_estimated_min INTEGER, salary_estimated_max INTEGER,
        salary_estimated_currency TEXT, salary_estimated_source TEXT,
        write_requested INTEGER, write_requested_at TEXT,
        geocode_requested INTEGER, geocode_requested_at TEXT,
        recheck_requested INTEGER, recheck_requested_at TEXT,
        salary_precise_requested INTEGER, salary_precise_requested_at TEXT,
        salary_precise TEXT, role_family TEXT, loc_city TEXT, loc_region TEXT,
        loc_country TEXT, loc_country_code TEXT, loc_continent TEXT,
        work_mode TEXT, work_country TEXT, work_country_code TEXT,
        location_notes TEXT, is_multi_location INTEGER, office_lat REAL,
        office_lon REAL, office_address TEXT, office_geocoded INTEGER,
        office_verified INTEGER, expires_at TEXT, is_open INTEGER,
        last_open_check TEXT, created_at TEXT, updated_at TEXT
      );
    `);
    db.prepare(
      "INSERT INTO positions (id,title,company,status,updated_at) VALUES (81,'Synthetic role','Synthetic company','applied','2026-09-20 09:00:00')",
    ).run();
    db.close();
    return { home, dbPath };
  }

  it(`acked positions that stay awaiting are named once, after ${AWAITING_APPLICATION_WARN_ROUNDS} rounds`, async () => {
    const { home, dbPath } = fixture();
    // The cloud acks every row and lists every position as awaiting: the
    // application never arrives complete.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<{ id?: number; _receipt_id?: string }>;
        return new Response(
          JSON.stringify({
            receipts: { [table]: rows.map((row) => row._receipt_id) },
            positions: {
              upserted: table === "positions" ? rows.length : 0,
              awaiting_application:
                table === "positions" ? rows.map((row) => row.id) : [],
              applied: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    const warnings: number[] = [];
    for (let i = 1; i <= AWAITING_APPLICATION_WARN_ROUNDS + 1; i += 1) {
      errors.mockClear();
      const result = await handlePush({ db: dbPath });
      expect(result.ok).toBe(true);
      if (
        errors.mock.calls.some((call) =>
          String(call[0]).includes("still unpublished on the cloud"),
        )
      ) {
        warnings.push(i);
      }
    }

    expect(warnings).toEqual([AWAITING_APPLICATION_WARN_ROUNDS]);
    const persisted = JSON.parse(
      readFileSync(join(home, ".cloud-push-awaiting.json"), "utf8"),
    );
    expect(persisted.rounds).toEqual({
      "81": AWAITING_APPLICATION_WARN_ROUNDS + 1,
    });
  });
});
