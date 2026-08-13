/** O-66 — il cloud converge senza aspettare che qualcuno prema Sync now. */
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decidePeriodicPush,
  nextPeriodicCheckState,
  nextPeriodicPushState,
  periodicPushLimits,
  periodicPushObservation,
  periodicPushStatusLine,
  readPeriodicPushState,
  runPeriodicPushCycle,
  savePeriodicPushState,
} from "../../../cli/src/lib/periodic-push.js";

const T0 = Date.UTC(2026, 7, 12, 15, 0, 0);
const MIN = 60_000;
const iso = (value: number) => new Date(value).toISOString();
const limits = periodicPushLimits({});
const signature = (count = 2) => ({
  positions: { n: count, max: "2026-08-12 15:00:00" },
  profile: null,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("policy del push periodico", () => {
  it("ha cadenza, retry e timeout finiti e configurabili", () => {
    expect(limits).toMatchObject({
      enabled: true,
      intervalMs: 15 * MIN,
      retryMs: MIN,
      timeoutMs: 2 * MIN,
    });
    expect(
      periodicPushLimits({
        JHT_PERIODIC_PUSH_SEC: "3",
        JHT_PERIODIC_PUSH_RETRY_SEC: "2",
        JHT_PERIODIC_PUSH_TIMEOUT_SEC: "4",
      }),
    ).toMatchObject({ intervalMs: 3000, retryMs: 2000, timeoutMs: 4000 });
  });

  it("al primo controllo legge la firma e parte se ci sono dati locali", () => {
    expect(decidePeriodicPush({ now: T0, state: {}, limits })).toMatchObject({
      push: false,
      needsSignature: true,
    });
    expect(
      decidePeriodicPush({
        now: T0,
        state: {},
        limits,
        signature: signature(),
      }),
    ).toMatchObject({ push: true, reason: "local_changes" });
  });

  it("non chiama il cloud quando la firma non è cambiata", () => {
    expect(
      decidePeriodicPush({
        now: T0,
        state: { signature: signature(), last_check_at: iso(T0 - 20 * MIN) },
        limits,
        signature: signature(),
      }),
    ).toMatchObject({ push: false, reason: "nothing_new", checked: true });
  });

  it("un successo impone la cadenza normale", () => {
    const state = nextPeriodicPushState({
      state: {},
      now: T0,
      signature: signature(),
      result: { ok: true, skipped: 0 },
      source: "periodic",
    });
    expect(state).toMatchObject({
      status: "completed",
      last_success_at: iso(T0),
      consecutive_failures: 0,
      signature: signature(),
    });
    expect(
      decidePeriodicPush({ now: T0 + 14 * MIN, state, limits }),
    ).toMatchObject({ push: false, reason: "cadence" });
  });

  it("un fallimento resta visibile e viene ritentato dopo il retry breve", () => {
    const state = nextPeriodicPushState({
      state: { signature: signature(1) },
      now: T0,
      signature: signature(2),
      result: { ok: false, timedOut: true, skipped: 0 },
      source: "periodic",
    });
    expect(state).toMatchObject({
      status: "timeout",
      consecutive_failures: 1,
      signature: signature(1),
    });
    expect(periodicPushStatusLine(state)).toContain("retry is automatic");
    expect(
      decidePeriodicPush({ now: T0 + 59_000, state, limits }),
    ).toMatchObject({ push: false, reason: "cadence" });
    expect(
      decidePeriodicPush({
        now: T0 + MIN,
        state,
        limits,
        signature: signature(2),
      }),
    ).toMatchObject({ push: true, reason: "local_changes" });
  });

  it("un controllo senza novità persiste il momento osservato", () => {
    expect(
      nextPeriodicCheckState({
        state: { status: "completed" },
        now: T0,
        signature: signature(),
        reason: "nothing_new",
      }),
    ).toMatchObject({
      status: "idle",
      last_check_at: iso(T0),
      signature: signature(),
    });
  });

  it("pubblica solo current/errore e timestamp, mai la firma locale", () => {
    const observation = periodicPushObservation({
      state: nextPeriodicPushState({
        state: {},
        now: T0,
        signature: signature(42),
        result: { ok: true, skipped: 0 },
        source: "periodic",
      }),
    });
    expect(observation).toEqual({
      cloud_push_status: "current",
      cloud_push_checked_at: iso(T0),
    });
    expect(JSON.stringify(observation)).not.toContain("positions");
  });

  it("pubblica solo il conteggio aggregato delle quarantene e non lo perde a riposo", () => {
    const partial = nextPeriodicPushState({
      state: {},
      now: T0,
      signature: signature(42),
      result: { ok: true, skipped: 2, quarantined: 2 },
      source: "periodic",
    });
    expect(partial).toMatchObject({
      status: "partial",
      quarantined_count: 2,
    });
    const idleCheck = nextPeriodicCheckState({
      state: partial,
      now: T0 + MIN,
      signature: signature(42),
      reason: "nothing_new",
    });
    expect(idleCheck.status).toBe("partial");
    expect(periodicPushObservation({ state: idleCheck })).toEqual({
      cloud_push_status: "quarantined:2",
      cloud_push_checked_at: iso(T0 + MIN),
    });
    expect(
      JSON.stringify(periodicPushObservation({ state: idleCheck })),
    ).not.toContain("signature");
    expect(periodicPushStatusLine(idleCheck)).toContain(
      "2 quarantined record(s)",
    );
  });
});

describe("esecuzione bounded", () => {
  it("passa un AbortSignal al writer e rende persistente il timeout", async () => {
    const saved: Record<string, unknown>[] = [];
    const outcome = await runPeriodicPushCycle({
      now: T0,
      limits: { ...limits, timeoutMs: 5 },
      state: {},
      readSignature: () => signature(),
      push: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
      save: async (state) => {
        saved.push(state);
        return true;
      },
    });

    expect(outcome.result).toMatchObject({ ok: false, timedOut: true });
    expect(outcome.state).toMatchObject({
      status: "timeout",
      consecutive_failures: 1,
    });
    expect(saved).toHaveLength(1);
  });

  it("pubblica il recovery quando la quarantena sparisce senza nuovi dati", async () => {
    const observations: Array<Record<string, unknown>> = [];
    const saved: Array<Record<string, unknown>> = [];
    const { maybePeriodicPush } =
      await import("../../../cli/src/commands/cloud.js");
    const outcome = await maybePeriodicPush({
      now: T0,
      limits,
      state: {
        status: "partial",
        quarantined_count: 2,
        last_check_at: iso(T0 - 1_000),
      },
      readQuarantineCount: async () => 0,
      save: async (state: Record<string, unknown>) => {
        saved.push(state);
        return true;
      },
      publishObservation: async (value: Record<string, unknown>) => {
        observations.push(value);
        return true;
      },
      silent: true,
    });

    expect(outcome.state).toMatchObject({
      status: "idle",
      quarantined_count: 0,
      last_reason: "quarantine_recovered",
    });
    expect(saved).toHaveLength(1);
    expect(observations).toEqual([
      {
        cloud_push_status: "current",
        cloud_push_checked_at: iso(T0),
      },
    ]);
  });
});

describe("effetto reale sul percorso Sync now", () => {
  it("invia ogni nuova posizione col writer autorevole e il cursor evita duplicati", async () => {
    const previousHome = process.env.JHT_HOME;
    const home = mkdtempSync(join(tmpdir(), "jht-periodic-effect-"));
    const dbPath = join(home, "jobs.db");
    const statePath = join(home, "periodic-state.json");
    try {
      process.env.JHT_HOME = home;
      writeFileSync(
        join(home, "cloud.json"),
        JSON.stringify({
          enabled: true,
          base_url: "https://cloud.example.test",
          token: "jht_sync_synthetic-test-token",
        }),
      );
      const db = new DatabaseSync(dbPath);
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
      const insert = db.prepare(
        "INSERT INTO positions (id, title, company, updated_at) VALUES (?, ?, 'Example', ?)",
      );
      insert.run(1, "First role", "2026-08-12 15:00:00");
      db.close();

      const payloads: Array<Record<string, unknown>> = [];
      const observations: Array<Record<string, unknown>> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body || "{}"));
          if (String(url).endsWith("/api/team-state")) {
            observations.push(body);
            return new Response(JSON.stringify({ state: body }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          payloads.push(body);
          return new Response(
            JSON.stringify({
              receipts: {
                positions: Array.isArray(body.positions)
                  ? body.positions.map((row: any) => row._receipt_id)
                  : [],
              },
              positions: {
                upserted: Array.isArray(body.positions)
                  ? body.positions.length
                  : 0,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }),
      );
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.resetModules();
      const { maybePeriodicPush } =
        await import("../../../cli/src/commands/cloud.js");
      const testLimits = { ...limits, intervalMs: MIN };

      await expect(
        maybePeriodicPush({
          db: dbPath,
          statePath,
          now: T0,
          limits: testLimits,
          silent: true,
        }),
      ).resolves.toMatchObject({ result: { ok: true, skipped: 0 } });

      const db2 = new DatabaseSync(dbPath);
      db2
        .prepare(
          "INSERT INTO positions (id, title, company, updated_at) VALUES (?, ?, 'Example', ?)",
        )
        .run(2, "Second role", "2026-08-12 15:01:00");
      db2.close();
      await maybePeriodicPush({
        db: dbPath,
        statePath,
        now: T0 + MIN,
        limits: testLimits,
        silent: true,
      });
      await maybePeriodicPush({
        db: dbPath,
        statePath,
        now: T0 + 2 * MIN,
        limits: testLimits,
        silent: true,
      });

      expect(
        payloads.map((body) =>
          (body.positions as Array<{ id: number }> | undefined)?.map(
            (position) => position.id,
          ),
        ),
      ).toEqual([[1], [2]]);
      expect(observations).toEqual([
        {
          cloud_push_status: "current",
          cloud_push_checked_at: iso(T0),
        },
        {
          cloud_push_status: "current",
          cloud_push_checked_at: iso(T0 + MIN),
        },
        {
          cloud_push_status: "current",
          cloud_push_checked_at: iso(T0 + 2 * MIN),
        },
      ]);
      expect(readPeriodicPushState(statePath)).toMatchObject({
        status: "idle",
        signature: { positions: { n: 2 } },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
      rmSync(home, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env.JHT_HOME;
      else process.env.JHT_HOME = previousHome;
      process.exitCode = undefined;
    }
  });
});

describe("stato osservabile su disco", () => {
  it("scrive JSON 0600 e lo rilegge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jht-periodic-push-"));
    const file = join(dir, "state.json");
    try {
      const state = { status: "failed", last_attempt_at: iso(T0) };
      await expect(savePeriodicPushState(state, file)).resolves.toBe(true);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(state);
      expect(readPeriodicPushState(file)).toEqual(state);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
