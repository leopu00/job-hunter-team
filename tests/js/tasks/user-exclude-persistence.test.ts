import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/positions/local-first-write", () => ({
  localFirstWrite: vi.fn(),
}));
vi.mock("@/lib/demo/data", () => ({ isDemoLegacyId: vi.fn(() => false) }));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: vi.fn(async () => false),
}));

import {
  applyCloud,
  applyLocal,
} from "@/app/api/positions/[legacyId]/user-exclude/route";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const webRequire = createRequire(path.join(ROOT, "web/package.json"));
const Database = webRequire(
  "better-sqlite3",
) as typeof import("better-sqlite3");

function localDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY,
      status TEXT,
      user_excluded_reason TEXT,
      user_excluded_note TEXT,
      user_excluded_at TEXT,
      user_excluded_prev_status TEXT,
      last_actor TEXT
    );
    CREATE TABLE position_state_transitions (
      id INTEGER PRIMARY KEY,
      position_id INTEGER,
      from_state TEXT,
      to_state TEXT,
      by_agent TEXT,
      notes TEXT
    );
    INSERT INTO positions (id, status) VALUES (1170, 'scored');
  `);
  return db;
}

describe("user exclusion on the local source of truth", () => {
  it("persists the canonical state and remains idempotent", () => {
    const db = localDb();
    try {
      expect(applyLocal(db, 1170, "exclude", "not_interested")).toMatchObject({
        ok: true,
        outcome: {
          status: "excluded",
          user_excluded_reason: "not_interested",
          user_excluded_prev_status: "scored",
        },
      });

      expect(applyLocal(db, 1170, "exclude", "company")).toMatchObject({
        ok: true,
        outcome: {
          status: "excluded",
          user_excluded_reason: "company",
          user_excluded_prev_status: "scored",
        },
      });
      expect(
        db
          .prepare("SELECT count(*) AS n FROM position_state_transitions")
          .get(),
      ).toEqual({ n: 1 });

      expect(applyLocal(db, 1170, "unexclude")).toMatchObject({
        ok: true,
        outcome: {
          status: "scored",
          user_excluded_reason: null,
          user_excluded_prev_status: null,
        },
      });
    } finally {
      db.close();
    }
  });

  it("rolls the position update back when the transition write fails", () => {
    const db = localDb();
    try {
      db.exec(`
        CREATE TRIGGER reject_transition
        BEFORE INSERT ON position_state_transitions
        BEGIN
          SELECT RAISE(ABORT, 'transition unavailable');
        END;
      `);
      expect(() => applyLocal(db, 1170, "exclude", "not_interested")).toThrow(
        "transition unavailable",
      );
      expect(
        db.prepare("SELECT status FROM positions WHERE id = 1170").get(),
      ).toEqual({ status: "scored" });
    } finally {
      db.close();
    }
  });
});

type DbResult = { data: unknown; error: { message: string } | null };

function cloudDb(selectResult: DbResult, updateResult: DbResult) {
  const calls = {
    table: [] as string[],
    filters: [] as Array<[string, unknown]>,
    update: null as Record<string, unknown> | null,
  };
  let writing = false;
  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn((value: Record<string, unknown>) => {
      writing = true;
      calls.update = value;
      return builder;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      calls.filters.push([column, value]);
      return builder;
    }),
    maybeSingle: vi.fn(async () => (writing ? updateResult : selectResult)),
  };
  return {
    calls,
    client: {
      from: vi.fn((table: string) => {
        calls.table.push(table);
        return builder;
      }),
    },
  };
}

describe("user exclusion on the Supabase source of truth", () => {
  it("scopes both reads and writes to the authenticated tenant", async () => {
    const db = cloudDb(
      {
        data: { status: "scored", user_excluded_prev_status: null },
        error: null,
      },
      {
        data: {
          status: "excluded",
          user_excluded_reason: "not_interested",
          user_excluded_prev_status: "scored",
        },
        error: null,
      },
    );

    await expect(
      applyCloud(
        db.client as never,
        "authenticated-user",
        1170,
        "exclude",
        "not_interested",
      ),
    ).resolves.toMatchObject({
      ok: true,
      outcome: {
        status: "excluded",
        user_excluded_prev_status: "scored",
      },
    });
    expect(db.calls.update).toMatchObject({
      status: "excluded",
      user_excluded_reason: "not_interested",
      user_excluded_prev_status: "scored",
    });
    expect(db.calls.filters).toEqual([
      ["user_id", "authenticated-user"],
      ["legacy_id", 1170],
      ["user_id", "authenticated-user"],
      ["legacy_id", 1170],
    ]);
  });

  it("does not attempt an update when the tenant-scoped row is absent", async () => {
    const db = cloudDb(
      { data: null, error: null },
      { data: null, error: null },
    );
    await expect(
      applyCloud(
        db.client as never,
        "authenticated-user",
        1170,
        "exclude",
        "company",
      ),
    ).resolves.toMatchObject({ ok: false, status: 404 });
    expect(db.calls.update).toBeNull();
  });

  it("does not report success when the update fails or matches no row", async () => {
    const current = {
      data: { status: "scored", user_excluded_prev_status: null },
      error: null,
    };
    const failed = cloudDb(current, {
      data: null,
      error: { message: "write rejected" },
    });
    await expect(
      applyCloud(
        failed.client as never,
        "authenticated-user",
        1170,
        "exclude",
        "company",
      ),
    ).resolves.toMatchObject({ ok: false, status: 500 });

    const vanished = cloudDb(current, { data: null, error: null });
    await expect(
      applyCloud(
        vanished.client as never,
        "authenticated-user",
        1170,
        "exclude",
        "company",
      ),
    ).resolves.toMatchObject({ ok: false, status: 404 });
  });
});
