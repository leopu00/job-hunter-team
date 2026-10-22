/**
 * W7 — what the website does with the user's session is told to the user out
 * of band, on the box: an application authorised, a team order added or
 * changed, the team started, stopped or restarted. The website can be used by
 * whoever holds the session; the notice reaches the user where the website does
 * not (Telegram when linked, and a row in the app's panel, mirrored in the chat).
 *
 * The pull and the directive sync run for real against a box database built
 * with the real schema (shared/skills/_db.py), and the notice runs for real
 * (web_action_notice.py → jht-notify-user): the row it leaves is what the user
 * sees. Telegram is not linked here (no jht-telegram-send on the PATH).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const repo = join(__dirname, "../../..");
const dirs: string[] = [];
const saved: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined) {
  if (!(name in saved)) saved[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    delete saved[name];
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A box: JHT_HOME with cloud.json and a jobs.db with the real schema and one position. */
function box() {
  const home = mkdtempSync(join(tmpdir(), "jht-web-notice-"));
  dirs.push(home);
  setEnv("JHT_HOME", home);
  setEnv("JHT_DB", join(home, "jobs.db"));
  // Telegram is not linked here: no jht-telegram-send on the PATH.
  setEnv("PATH", (process.env.PATH || "").split(":").filter((p) => !p.includes("_tools")).join(":"));
  writeFileSync(
    join(home, "cloud.json"),
    JSON.stringify({ enabled: true, base_url: "https://cloud.example.test", token: "jht_sync_synthetic-test-token" }),
  );
  const dbPath = join(home, "jobs.db");
  execFileSync(
    "python3",
    [
      "-c",
      "import sqlite3,sys; sys.path.insert(0, sys.argv[1]); import _db; c = sqlite3.connect(sys.argv[2]); " +
        "c.row_factory = sqlite3.Row; _db.ensure_schema(c); " +
        "c.execute(\"INSERT INTO positions (id, title, company, status) VALUES (7, 'Engineer', 'Example Ltd', 'ready')\"); c.commit()",
      join(repo, "shared", "skills"),
      dbPath,
    ],
    { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  return { home, dbPath };
}

function notices(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  const rows = db
    .prepare(
      "SELECT related_position_id, source_id, source_action, source_payload, body FROM pending_user_messages " +
        "WHERE source_action = 'web_action_notice' ORDER BY id",
    )
    .all() as Array<Record<string, unknown>>;
  db.close();
  return rows.map((r) => ({ ...r, payload: JSON.parse(String(r.source_payload)) }));
}

function stubFetch(answer: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) =>
      new Response(JSON.stringify(answer(String(url), init)), { status: 200, headers: { "Content-Type": "application/json" } }),
    ),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

async function pull(dbPath: string, positions: Record<string, unknown>[]) {
  stubFetch(() => ({ ok: true, positions, applications: [], cursor: "2026-09-12T10:00:00.000Z" }));
  vi.resetModules();
  const { handlePullDesiredState } = await import("../../../cli/src/commands/cloud.js");
  await handlePullDesiredState({ db: dbPath, silent: true });
}

const FROM_WEB = {
  legacy_id: 7,
  apply_requested: true,
  apply_requested_at: "2026-09-12T09:30:00+00:00",
  apply_requested_by: "user_web",
};

describe("an application authorised from the website", () => {
  it("is told to the user when the box takes it, once, with the position's number and nothing else", async () => {
    const { dbPath } = box();
    await pull(dbPath, [FROM_WEB]);
    const rows = notices(dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ code: "apply_authorized_from_web", position_id: 7 });
    expect(rows[0]!.related_position_id).toBe(7);
    expect(String(rows[0]!.body)).not.toMatch(/Engineer|Example/);
    // the cursor can bring the same row back: still one notice
    await pull(dbPath, [FROM_WEB]);
    expect(notices(dbPath)).toHaveLength(1);
    // a new authorisation of the same position, at a new instant, is a new notice
    await pull(dbPath, [{ ...FROM_WEB, apply_requested_at: "2026-09-12T11:00:00+00:00" }]);
    expect(notices(dbPath)).toHaveLength(2);
  });

  it("no authorisation from the website reaches the box without its notice (sentinel)", async () => {
    const { dbPath } = box();
    await pull(dbPath, [FROM_WEB]);
    const db = new DatabaseSync(dbPath);
    const authorised = db
      .prepare("SELECT id, apply_requested_at FROM positions WHERE apply_requested = 1 AND apply_requested_by = 'user_web'")
      .all() as Array<{ id: number; apply_requested_at: string }>;
    db.close();
    expect(authorised).toHaveLength(1);
    const told = new Set(notices(dbPath).map((r) => r.related_position_id));
    for (const row of authorised) expect(told.has(row.id), `position ${row.id}`).toBe(true);
  });

  it("an authorisation given on the box itself, or a withdrawal, is not one", async () => {
    const { dbPath } = box();
    const db = new DatabaseSync(dbPath);
    db.exec(
      "UPDATE positions SET apply_requested = 1, apply_requested_at = '2026-09-12T10:00:00.000Z', apply_requested_by = 'user_local' WHERE id = 7",
    );
    db.close();
    // the cloud brings back the box's own authorisation (same instant, older): nothing to tell
    await pull(dbPath, [{ ...FROM_WEB, apply_requested_at: "2026-09-12T09:00:00+00:00", apply_requested_by: "user_local" }]);
    // a withdrawal from the website
    await pull(dbPath, [{ legacy_id: 7, apply_requested: false, apply_requested_at: "2026-09-12T12:00:00+00:00", apply_requested_by: null }]);
    expect(notices(dbPath)).toEqual([]);
  });
});

async function directiveSync(dbPath: string, directives: Record<string, unknown>[]) {
  stubFetch((_url, init) =>
    (init?.method || "GET") === "GET" ? { directives, cursor: "2026-09-12T10:00:00.000Z" } : { ok: true, id_map: [] },
  );
  vi.resetModules();
  const { handleDirectiveSync } = await import("../../../cli/src/commands/cloud.js");
  await handleDirectiveSync({ db: dbPath, silent: true, full: true });
}

const ORDER = {
  id: 501,
  body: "Only remote positions",
  kind: "order",
  status: "active",
  sort_order: 0,
  created_by: "user",
  created_at: "2026-09-12T09:00:00+00:00",
  updated_at: "2026-09-12T09:00:00+00:00",
};

describe("a team order from the website", () => {
  it("a new one and a changed one are told, the same one pulled again is not", async () => {
    const { dbPath } = box();
    await directiveSync(dbPath, [ORDER]);
    expect(notices(dbPath).map((r) => r.payload)).toEqual([{ code: "directive_changed_from_web" }]);
    await directiveSync(dbPath, [ORDER]);
    expect(notices(dbPath)).toHaveLength(1);
    await directiveSync(dbPath, [{ ...ORDER, body: "Only remote positions, and in Europe", updated_at: "2026-09-12T10:00:00+00:00" }]);
    await directiveSync(dbPath, [{ ...ORDER, body: "Only remote positions, and in Europe", status: "archived", updated_at: "2026-09-12T11:00:00+00:00" }]);
    expect(notices(dbPath)).toHaveLength(3);
    // what none of it carries: the order's own words
    for (const row of notices(dbPath)) expect(String(row.body)).not.toContain("remote");
  });

  it("an order the cloud marks as written by the desktop is not one", async () => {
    const { dbPath } = box();
    await directiveSync(dbPath, [{ ...ORDER, origin: "desktop" }]);
    expect(notices(dbPath)).toEqual([]);
  });
});

describe("the team started, stopped or restarted from the website", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const NOW = Date.parse("2026-10-22T12:00:00Z");

  async function converge(row: Record<string, unknown>, ok = true) {
    const dir = mkdtempSync(join(tmpdir(), "jht-web-notice-guard-"));
    dirs.push(dir);
    stubFetch(() => ({ ok: true }));
    vi.resetModules();
    const { reconcile } = await import("../../../cli/src/lib/team-state-reconciler.js");
    const { createDoneStore } = await import("../../../cli/src/lib/team-command-guard.js");
    const told: Array<{ code: string; key: string }> = [];
    const result = await reconcile("https://site", "tok", { user_id: OWNER, desired_changed_at: new Date(NOW - 30_000).toISOString(), ...row }, {
      ownerId: OWNER,
      serverNow: () => NOW,
      done: createDoneStore(join(dir, "done.json")),
      exec: async () => ({ ok, code: ok ? 0 : 1, stdout: "", stderr: ok ? "" : "failed" }),
      notice: async (n: { code: string; key: string }) => {
        told.push(n);
        return { notified: true };
      },
    });
    return { result, told };
  }

  it("each action that ran is told, with its own code", async () => {
    const start = await converge({ should_run: true, is_running: false });
    expect(start.result).toBe("started");
    expect(start.told.map((t) => t.code)).toEqual(["team_started_from_web"]);
    const stop = await converge({ should_run: false, is_running: true });
    expect(stop.result).toBe("stopped");
    expect(stop.told.map((t) => t.code)).toEqual(["team_stopped_from_web"]);
    const restart = await converge({ should_run: true, is_running: true, restart_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(restart.result).toBe("restarted");
    expect(restart.told).toEqual([{ code: "team_restarted_from_web", key: "restart:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
  });

  it("an action that failed or was refused is not told as done", async () => {
    expect((await converge({ should_run: true, is_running: false }, false)).told).toEqual([]);
    expect((await converge({ should_run: true, is_running: false, user_id: "22222222-2222-4222-8222-222222222222" })).told).toEqual([]);
  });

  it("an emergency stop from the website is told", async () => {
    stubFetch(() => ({ ok: true }));
    vi.resetModules();
    const { reconcileEmergencyStop } = await import("../../../cli/src/lib/team-state-reconciler.js");
    const { createDoneStore } = await import("../../../cli/src/lib/team-command-guard.js");
    const dir = mkdtempSync(join(tmpdir(), "jht-web-notice-stop-"));
    dirs.push(dir);
    const told: Array<{ code: string; key: string }> = [];
    const result = await reconcileEmergencyStop(
      { enabled: true, base_url: "https://site", token: "tok", user_id: OWNER },
      { user_id: OWNER, should_run: false, is_running: true, emergency_stop_requested_at: "2026-10-22T11:00:00.000Z", emergency_stop_completed_at: null },
      {
        done: createDoneStore(join(dir, "done.json")),
        exec: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
        notice: async (n: { code: string; key: string }) => {
          told.push(n);
          return { notified: true };
        },
      },
    );
    expect(result).toMatchObject({ action: "stopped" });
    expect(told).toEqual([{ code: "team_stopped_from_web", key: `emergency-stop:${Date.parse("2026-10-22T11:00:00.000Z")}` }]);
  });
});
