/**
 * The daily cap of the applications authorised from the website, said to the person (JHT-CLOSER).
 *
 * The box sends at most five a day for the positions whose flag the website switched on; the others stay
 * authorised and go the day after. The door lets more in (fifteen) and both limits stay as they are, so the
 * page must say what is true: «queued: it goes out tomorrow», not «authorised» as if it went on the next
 * round, and not an error.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const Database = requireFromWeb("better-sqlite3");
const React = requireFromWeb("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};

const home = mkdtempSync(join(tmpdir(), "jht-web-cap-"));
process.env.JHT_HOME = home;

// What the signals module reads to choose the shore.
const world = {
  local: false,
  workspace: null as string | null,
  supabase: true,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  error: null as unknown,
  chain: [] as Array<[string, unknown[]]>,
};
vi.mock("@/lib/auth", () => ({ isLocalRequest: async () => world.local }));
vi.mock("@/lib/demo/mode", () => ({ activeDemoPersona: async () => null }));
vi.mock("@/lib/workspace", () => ({
  getWorkspacePath: async () => world.workspace,
  workspaceHasDb: () => world.workspace !== null,
  get isSupabaseConfigured() {
    return world.supabase;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      const q: Record<string, unknown> = {};
      world.chain.push(["from", [table]]);
      for (const name of ["select", "eq", "in", "is", "gte", "limit"]) {
        q[name] = (...args: unknown[]) => {
          world.chain.push([name, args]);
          if (
            name === "eq" ||
            name === "in" ||
            name === "is" ||
            name === "gte"
          ) {
            filters.push([name, String(args[0]), args[1]]);
          }
          if (name !== "limit") return q;
          if (world.error)
            return Promise.resolve({ data: null, error: world.error });
          let rows = world.tables[table] ?? [];
          for (const [kind, column, value] of filters) {
            rows = rows.filter((row) => {
              const cell = (row as Record<string, unknown>)[column];
              if (kind === "eq") return cell === value;
              if (kind === "in") return (value as unknown[]).includes(cell);
              if (kind === "is") return (cell ?? null) === value;
              return typeof cell === "string" && cell >= String(value); // gte on ISO instants
            });
          }
          return Promise.resolve({
            data: rows.slice(0, Number(args[0])),
            error: null,
          });
        };
      }
      return q;
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: Record<string, unknown>) =>
    React.createElement("a", { href, ...rest }, children),
}));

const cap = await import("@/lib/apply-web-cap");
const signals = await import("@/lib/apply-request-signals");
const button =
  await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
const { T } =
  await import("@/app/(protected)/positions/[id]/ApplyRequestButton.i18n");
const { makeT } = await import("@/lib/i18n-dict");

const NOON = new Date(2026, 9, 23, 12, 0, 0); // local time
const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour, 0, 0).toISOString();
const authorised = { kind: "authorised" as const, at: "2026-10-23T08:00:00Z" };

describe("the cap, from the sends the website knows", () => {
  it("is reached at five sends on the user's day, not at four", () => {
    expect(cap.WEB_DAILY_CAP).toBe(5);
    expect(
      cap.webCapReached(
        [1, 2, 3, 4].map((h) => at(23, h)),
        NOON,
      ),
    ).toBe(false);
    expect(
      cap.webCapReached(
        [1, 2, 3, 4, 5].map((h) => at(23, h)),
        NOON,
      ),
    ).toBe(true);
  });

  it("counts only today: five yesterday leave today free", () => {
    expect(
      cap.webCapReached(
        [1, 2, 3, 4, 5].map((h) => at(22, h + 10)),
        NOON,
      ),
    ).toBe(false);
    expect(
      cap.webCapReached(
        [at(22, 23), at(22, 22), at(23, 1), at(23, 2), at(23, 3)],
        NOON,
      ),
    ).toBe(false);
  });

  it("ignores what is not an instant, and obeys a cap that is passed", () => {
    expect(
      cap.webCapReached(
        [
          null,
          undefined,
          "",
          "not a date",
          ...[1, 2, 3, 4].map((h) => at(23, h)),
        ],
        NOON,
      ),
    ).toBe(false);
    expect(cap.webCapReached([at(23, 1), at(23, 2)], NOON, 2)).toBe(true);
  });

  it("says «queued for tomorrow» only for an authorised position, authorised from the website, with the cap full", () => {
    const full = [1, 2, 3, 4, 5].map((h) => at(23, h));
    const base = {
      state: authorised,
      authorisedBy: "user_web",
      sentAt: full,
      now: NOON,
    };
    expect(cap.isQueuedForTomorrow(base)).toBe(true);
    // the other channels do not consume the cap, so they do not wait for it
    for (const by of [
      "user_local",
      "user_telegram",
      null,
      undefined,
      "agent_closer",
    ]) {
      expect(cap.isQueuedForTomorrow({ ...base, authorisedBy: by })).toBe(
        false,
      );
    }
    expect(cap.isQueuedForTomorrow({ ...base, sentAt: full.slice(0, 4) })).toBe(
      false,
    );
    // not while it is being sent, stopped, available or already sent
    for (const state of [
      { kind: "sending", step: "submit" },
      { kind: "stopped", reason: "x", messageId: null },
      { kind: "available" },
      { kind: "hidden" },
      { kind: "sent", at: null, via: null, withReceipt: false },
    ]) {
      expect(cap.isQueuedForTomorrow({ ...base, state: state as never })).toBe(
        false,
      );
    }
  });

  it("is the same number, origin and channels the gate uses", () => {
    const gate = readFileSync(
      join(repo, "shared/skills/apply_gate.py"),
      "utf8",
    );
    expect(Number(/^DEFAULT_MAX_WEB_PER_DAY = (\d+)/m.exec(gate)?.[1])).toBe(
      cap.WEB_DAILY_CAP,
    );
    expect(/^WEB_ORIGIN = "([a-z_]+)"/m.exec(gate)?.[1]).toBe(cap.WEB_ORIGIN);
    const rule = JSON.parse(
      readFileSync(join(repo, "shared/cloud/apply-request-rule.json"), "utf8"),
    );
    expect(cap.AUTOMATED_APPLIED_VIA).toEqual(rule.automated_applied_via);
    expect(cap.AUTOMATED_APPLIED_VIA.length).toBeGreaterThan(0);
    expect(rule.user_request_origins).toContain(cap.WEB_ORIGIN);
  });
});

describe("what the button shows", () => {
  const html = (props: Record<string, unknown>, locale = "en") =>
    renderToStaticMarkup(
      React.createElement(button.ApplyRequestView, {
        t: makeT(T, locale),
        ...props,
      }),
    );

  it("a queued one says it goes out tomorrow, is not an error, and can still be withdrawn", () => {
    const out = html({ state: authorised, queuedTomorrow: true });
    expect(out).toContain('data-queued-tomorrow="true"');
    expect(out).toContain("Queued: it goes out tomorrow");
    expect(out).toContain("5 applications");
    expect(out).toContain("not an error");
    expect(out).toContain('data-action="withdraw"');
    expect(out).not.toContain("on its next round");
    expect(out).not.toContain('role="alert"');
  });

  it("an ordinary authorised one keeps its words and carries no mark", () => {
    const out = html({ state: authorised });
    expect(out).toContain("on its next round");
    expect(out).not.toContain("data-queued-tomorrow");
  });

  it("the mark never appears on a state that is not «authorised»", () => {
    for (const state of [
      { kind: "available" },
      { kind: "sending", step: "submit" },
      { kind: "stopped", reason: "x", messageId: null },
      { kind: "sent", at: null, via: null, withReceipt: false },
    ]) {
      expect(html({ state, queuedTomorrow: true })).not.toContain(
        "data-queued-tomorrow",
      );
    }
  });

  it("is said in the seven languages, with the number filled in", () => {
    for (const locale of ["it", "en", "hu", "es", "de", "fr", "pt"]) {
      const out = html({ state: authorised, queuedTomorrow: true }, locale);
      expect(out, locale).toContain('data-queued-tomorrow="true"');
      expect(out, locale).not.toContain("{cap}");
      expect(out, locale).toContain("5");
    }
    expect(html({ state: authorised, queuedTomorrow: true }, "it")).toContain(
      "In coda: parte domani",
    );
  });

  it("before the browser knows the day (the server's render, the browser's before it mounts) it never says «tomorrow»", () => {
    const full = [1, 2, 3, 4, 5].map((h) => at(23, h));
    const args = { state: authorised, authorisedBy: "user_web", sentAt: full };
    expect(cap.queuedTomorrowAt(null, args)).toBe(false);
    expect(cap.queuedTomorrowAt(NOON, args)).toBe(true);
    expect(
      cap.queuedTomorrowAt(NOON, { ...args, authorisedBy: "user_local" }),
    ).toBe(false);
  });

  it("the container decides it in the browser, from the sends the page gave it", () => {
    const src = readFileSync(
      join(repo, "web/app/(protected)/positions/[id]/ApplyRequestButton.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /queuedTomorrowAt\(now, \{[^}]*authorisedBy[^}]*sentAt: webSentAt[^}]*\}\)/s,
    );
    expect(src).toMatch(/useEffect\(\(\) => setNow\(new Date\(\)\), \[\]\)/);
    const page = readFileSync(
      join(repo, "web/app/(protected)/positions/[id]/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(
      /authorisedBy=\{data\.position\.apply_requested_by \?\? null\}/,
    );
    expect(page).toMatch(/webSentAt=\{webSentAt\}/);
    // the extra read happens only for an authorised position that the website authorised
    expect(page).toMatch(
      /applyState\.kind === "authorised" &&\s*data\.position\.apply_requested_by === WEB_ORIGIN\s*\?\s*await getWebSendsRecent\(\)/,
    );
  });
});

describe("where the sends come from", () => {
  it("on the box: the automated sends of the last two days, of positions the website authorised", async () => {
    const dbPath = join(home, "jobs.db");
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(dbPath + suffix, { force: true });
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE positions (id INTEGER PRIMARY KEY, apply_requested_by TEXT);
      CREATE TABLE applications (id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE, applied INTEGER, applied_at TEXT, applied_via TEXT);
    `);
    const now = new Date();
    const ago = (h: number) =>
      new Date(now.getTime() - h * 3600_000).toISOString();
    const rows: Array<[number, string | null, number, string, string]> = [
      [1, "user_web", 1, ago(1), "agent_closer"], // counts
      [2, "user_web", 1, ago(30), "agent_closer_email"], // counts (email is automated too)
      [3, "user_local", 1, ago(1), "agent_closer"], // authorised from the desktop: its own cap
      [4, "user_web", 1, ago(1), "manual"], // sent by the person
      [5, "user_web", 0, ago(1), "agent_closer"], // not sent
      [6, "user_web", 1, ago(24 * 5), "agent_closer"], // too old
    ];
    for (const [id, by, applied, when, via] of rows) {
      db.prepare(
        "INSERT INTO positions (id, apply_requested_by) VALUES (?, ?)",
      ).run(id, by);
      db.prepare(
        "INSERT INTO applications (position_id, applied, applied_at, applied_via) VALUES (?, ?, ?, ?)",
      ).run(id, applied, when, via);
    }
    db.close();
    const local = await import("@/lib/local-queries");
    expect(local.getWebSendsRecentLocal(home).sort()).toEqual(
      [ago(1), ago(30)].sort(),
    );
  });

  describe("on the cloud: two plain reads", () => {
    const base = Date.now(); // one instant, so the same hour gives the same string everywhere
    const ago = (h: number) => new Date(base - h * 3600_000).toISOString();
    const app = (
      position: string,
      when: unknown,
      extra: Record<string, unknown> = {},
    ) => ({
      position_id: position,
      applied: true,
      applied_via: "agent_closer",
      applied_at: when,
      deleted_at: null,
      ...extra,
    });
    const reset = () => {
      world.local = false;
      world.workspace = null;
      world.chain = [];
      world.error = null;
      world.tables = {};
    };

    it("counts the automated sends of the last two days of positions the website authorised, and nothing else", async () => {
      reset();
      world.tables.applications = [
        app("p1", ago(1)), // counts
        app("p2", ago(30), { applied_via: "agent_closer_email" }), // counts: email is automated too
        app("p3", ago(1), { applied_via: "manual" }), // sent by the person
        app("p4", ago(1), { applied: false }), // not sent
        app("p5", ago(24 * 5)), // too old
        app("p6", ago(1)), // authorised from the desktop: its own cap
        app("p7", 7), // not an instant
        app("p8", "not a date"),
        app("p1", ago(1), { deleted_at: ago(0.5) }), // cancelled after the send: not a send any more
      ];
      world.tables.positions = [
        { id: "p1", apply_requested_by: "user_web" },
        { id: "p2", apply_requested_by: "user_web" },
        { id: "p3", apply_requested_by: "user_web" },
        { id: "p4", apply_requested_by: "user_web" },
        { id: "p5", apply_requested_by: "user_web" },
        { id: "p6", apply_requested_by: "user_local" },
        { id: "p7", apply_requested_by: "user_web" },
        { id: "p8", apply_requested_by: "user_web" },
      ];
      expect((await signals.getWebSendsRecent()).sort()).toEqual(
        [ago(1), ago(30)].sort(),
      );
      const names = world.chain.map(([n]) => n);
      expect(names).toEqual([
        "from",
        "select",
        "eq",
        "in",
        "is",
        "gte",
        "limit",
        "from",
        "select",
        "in",
        "eq",
        "limit",
      ]);
      // no dotted column name, which the schema census cannot read
      expect(JSON.stringify(world.chain)).not.toMatch(/"[a-z_]+\.[a-z_]+"/);
    });

    it("a cancelled application is not counted: the first read asks for the ones that are not deleted", async () => {
      reset();
      world.tables.applications = [
        app("p1", ago(1), { deleted_at: ago(0.5) }),
        app("p2", ago(2)),
      ];
      world.tables.positions = [
        { id: "p1", apply_requested_by: "user_web" },
        { id: "p2", apply_requested_by: "user_web" },
      ];
      expect(await signals.getWebSendsRecent()).toEqual([ago(2)]);
      expect(
        world.chain.some(
          ([n, a]) => n === "is" && a[0] === "deleted_at" && a[1] === null,
        ),
      ).toBe(true);
    });

    it("does not depend on how many positions the user has or which was touched last: it asks by id", async () => {
      reset();
      // 201 positions authorised from the website; the recent send is on the one touched longest ago
      world.tables.positions = Array.from({ length: 201 }, (_, i) => ({
        id: `p${i}`,
        apply_requested_by: "user_web",
        updated_at: new Date(base - i * 1000).toISOString(),
      }));
      world.tables.applications = [app("p200", ago(1))];
      expect(await signals.getWebSendsRecent()).toEqual([ago(1)]);
      const ask = world.chain.filter(([n]) => n === "in").map(([, a]) => a);
      expect(ask[1]).toEqual(["id", ["p200"]]);
    });

    it("asks only for what it needs: the channels, the window and a cap on the rows", async () => {
      reset();
      world.tables.applications = [app("p1", ago(1))];
      world.tables.positions = [{ id: "p1", apply_requested_by: "user_web" }];
      await signals.getWebSendsRecent();
      const by = (n: string, i = 0) =>
        world.chain.filter(([x]) => x === n).map(([, a]) => a)[i];
      expect(by("eq", 0)).toEqual(["applied", true]);
      expect(by("in", 0)).toEqual([
        "applied_via",
        [...cap.AUTOMATED_APPLIED_VIA],
      ]);
      expect(by("eq", 1)).toEqual(["apply_requested_by", "user_web"]);
      const since = Date.parse(String(by("gte")[1]));
      expect(base - since).toBeGreaterThan(47 * 3600_000);
      expect(base - since).toBeLessThan(49 * 3600_000);
      expect(Number(by("limit", 0)[0])).toBeLessThanOrEqual(100);
    });

    it("nothing sent means no second read", async () => {
      reset();
      world.tables.applications = [];
      expect(await signals.getWebSendsRecent()).toEqual([]);
      expect(world.chain.filter(([n]) => n === "from")).toHaveLength(1);
    });
  });

  it("a failing read is no sends at all: the page says «authorised», never «queued for tomorrow»", async () => {
    world.chain = [];
    world.error = { message: "boom" };
    expect(await signals.getWebSendsRecent()).toEqual([]);
    world.error = null;
    world.supabase = false;
    expect(await signals.getWebSendsRecent()).toEqual([]);
    world.supabase = true;
  });
});
