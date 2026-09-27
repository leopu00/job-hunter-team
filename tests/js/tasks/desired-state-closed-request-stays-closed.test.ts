/**
 * Una richiesta dell'utente chiusa sul box resta chiusa. (27/09)
 *
 * Il daemon, a ogni tick, fa PRIMA il pull desired-state e POI il push. Il
 * pull prendeva dal cloud i flag di richiesta (geocode, write, recheck,
 * salary_precise) cosi' com'erano, e la riga cloud rientra nel pull a ogni
 * tick: il push precedente ne sposta `updated_at`. Quando l'ANALISTA chiudeva
 * un geocoding, il tick dopo il pull rimetteva la richiesta vecchia del cloud
 * prima che il push portasse su la chiusura, e il push la rimandava su accesa.
 * Su una VPS l'ANALISTA ha rifatto cosi' la stessa posizione due volte, e
 * nessuna richiesta di geocoding (nemmeno il bottone della dashboard) si
 * chiudeva mai.
 *
 * La regola e' quella che l'autorizzazione alla candidatura aveva gia': vince
 * il cloud solo con un istante strettamente piu' recente. Questi test fanno
 * girare i tick veri (pull poi push) contro un cloud finto che fa quello che
 * fa la route di push: salva i flag e l'istante che il box gli manda, e li
 * rende nel formato di Postgres.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

const dirs: string[] = [];
let previousHome: string | undefined;

/** I flag di richiesta, ognuno con il suo istante. */
const FLAGS = [
  ["geocode_requested", "geocode_requested_at"],
  ["write_requested", "write_requested_at"],
  ["recheck_requested", "recheck_requested_at"],
  ["salary_precise_requested", "salary_precise_requested_at"],
] as const;

/** La richiesta dell'utente, come la scrive SQLite (UTC, senza fuso). */
const REQUESTED_AT = "2026-09-27 14:54:03";

function box() {
  previousHome = process.env.JHT_HOME;
  const home = mkdtempSync(join(tmpdir(), "jht-request-closed-"));
  dirs.push(home);
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
  // Le colonne che il lettore del push e il pull nominano: una tabella ridotta
  // fa fallire la lettura prima della rete, cioe' prima di cio' che si misura.
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
      write_requested INTEGER DEFAULT 0, write_requested_at TEXT,
      write_request_kind TEXT,
      geocode_requested INTEGER DEFAULT 0, geocode_requested_at TEXT,
      recheck_requested INTEGER DEFAULT 0, recheck_requested_at TEXT,
      salary_precise_requested INTEGER DEFAULT 0,
      salary_precise_requested_at TEXT,
      apply_requested INTEGER DEFAULT 0, apply_requested_at TEXT,
      apply_requested_by TEXT,
      salary_precise TEXT, role_family TEXT, loc_city TEXT, loc_region TEXT,
      loc_country TEXT, loc_country_code TEXT, loc_continent TEXT,
      work_mode TEXT, work_country TEXT, work_country_code TEXT,
      location_notes TEXT, is_multi_location INTEGER, office_lat REAL,
      office_lon REAL, office_address TEXT, office_geocoded INTEGER,
      office_verified INTEGER, expires_at TEXT, is_open INTEGER,
      last_open_check TEXT, user_excluded_reason TEXT,
      user_excluded_note TEXT, user_excluded_at TEXT,
      user_excluded_prev_status TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE position_state_transitions (
      id INTEGER PRIMARY KEY, position_id INTEGER,
      from_state TEXT, to_state TEXT, by_agent TEXT, notes TEXT, ts TEXT
    );
  `);
  db.exec(
    "INSERT INTO positions (id, title, company, status, updated_at) " +
      "VALUES (1, 'AI Software Engineer', 'Synthetic company', 'scored', '2026-09-27 14:54:03')",
  );
  db.close();
  return { dbPath };
}

/** Come Postgres rende un `timestamptz` salvato da una stringa senza fuso. */
function asPostgres(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value);
  return /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(text)
    ? text
    : `${text.replace(" ", "T")}+00:00`;
}

/**
 * Il cloud: una riga, che il push sovrascrive con cio' che il box manda (come
 * la route `cloud-sync/push`) e che il pull rende a ogni tick (come fa ogni
 * riga che il push ha appena toccato).
 */
function fakeCloud(row: Record<string, unknown>) {
  const cloud = { legacy_id: 1, ...row };
  const fetchFn = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("pull-desired-state")) {
      return json({
        ok: true,
        positions: [{ ...cloud }],
        applications: [],
        cursor: "2026-09-27T15:00:00.000Z",
      });
    }
    const body = JSON.parse(String(init?.body || "{}"));
    const table = Object.keys(body)[0];
    const rows = (body[table] || []) as Array<Record<string, unknown>>;
    if (table === "positions") {
      for (const pushed of rows.filter((r) => r.id === 1)) {
        for (const [flag, at] of FLAGS) {
          cloud[flag] = pushed[flag] === 1 || pushed[flag] === true;
          cloud[at] = asPostgres(pushed[at]);
        }
      }
    }
    return json({
      receipts: { [table]: rows.map((r) => r._receipt_id) },
      [table]: { upserted: rows.length },
    });
  });
  return { cloud, fetchFn };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Un tick del daemon, nel suo ordine: prima il pull, poi il push. */
async function ticks(dbPath: string, fetchFn: ReturnType<typeof vi.fn>, n: number) {
  vi.stubGlobal("fetch", fetchFn);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  const sync = await import("../../../cli/src/commands/cloud.js");
  for (let i = 0; i < n; i++) {
    await sync.handlePullDesiredState({ db: dbPath, silent: true });
    await sync.handlePush({ db: dbPath });
  }
}

function local(dbPath: string, flag: string, at: string) {
  const db = new DatabaseSync(dbPath);
  const row = db
    .prepare(`SELECT ${flag} AS flag, ${at} AS at FROM positions WHERE id = 1`)
    .get() as { flag: number; at: string | null };
  db.close();
  return row;
}

function write(dbPath: string, sql: string) {
  const db = new DatabaseSync(dbPath);
  db.exec(sql);
  db.close();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  process.exitCode = undefined;
  if (previousHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = previousHome;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("una richiesta chiusa sul box resta chiusa, tick dopo tick", () => {
  it.each(FLAGS)(
    "%s: chiusa sul box, il cloud con la richiesta vecchia non la riaccende",
    async (flag, at) => {
      const { dbPath } = box();
      // La richiesta e' gia' salita: box e cloud la conoscono uguale.
      write(dbPath, `UPDATE positions SET ${flag} = 1, ${at} = '${REQUESTED_AT}' WHERE id = 1`);
      const { cloud, fetchFn } = fakeCloud({ [flag]: true, [at]: asPostgres(REQUESTED_AT) });
      // Il box la chiude come fa db_update: flag a 0, l'istante della
      // richiesta resta. La riga cambia, quindi rientra nel push.
      write(
        dbPath,
        `UPDATE positions SET ${flag} = 0, updated_at = '2026-09-27 15:18:31' WHERE id = 1`,
      );

      await ticks(dbPath, fetchFn, 3);

      expect(local(dbPath, flag, at).flag, "il pull ha riaperto la richiesta chiusa").toBe(0);
      expect(cloud[flag], "la chiusura non e' mai arrivata sul cloud").toBe(false);
    },
  );

  it("una richiesta nuova dal web, piu' recente della chiusura, riapre la coda", async () => {
    const { dbPath } = box();
    write(
      dbPath,
      `UPDATE positions SET geocode_requested = 0, geocode_requested_at = '${REQUESTED_AT}', ` +
        "office_geocoded = 1 WHERE id = 1",
    );
    // «Ricalcola» dal web: il cloud ha una richiesta con un istante nuovo.
    const { fetchFn } = fakeCloud({
      geocode_requested: true,
      geocode_requested_at: "2026-09-27T16:00:00.000Z",
    });
    await ticks(dbPath, fetchFn, 2);
    expect(local(dbPath, "geocode_requested", "geocode_requested_at")).toEqual({
      flag: 1,
      at: "2026-09-27T16:00:00.000Z",
    });
  });

  it("un annullamento dal web, piu' recente della richiesta, la spegne", async () => {
    const { dbPath } = box();
    write(
      dbPath,
      `UPDATE positions SET geocode_requested = 1, geocode_requested_at = '${REQUESTED_AT}' WHERE id = 1`,
    );
    const { fetchFn } = fakeCloud({
      geocode_requested: false,
      geocode_requested_at: "2026-09-27T15:10:00.000Z",
    });
    await ticks(dbPath, fetchFn, 2);
    expect(local(dbPath, "geocode_requested", "geocode_requested_at").flag).toBe(0);
  });

  it("lo stesso istante scritto in due formati non riscrive la riga", async () => {
    // SQLite scrive senza fuso, il cloud rende '+00:00': e' la stessa
    // richiesta. Riletta come ora locale del processo, sembrava diversa, e il
    // pull riscriveva tutte le righe a ogni tick. Un fuso diverso da UTC,
    // perche' in CI (UTC) le due letture coinciderebbero per caso.
    const previousTz = process.env.TZ;
    process.env.TZ = "Europe/Rome";
    onTestFinished(() => {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    });
    const { dbPath } = box();
    write(
      dbPath,
      `UPDATE positions SET geocode_requested = 1, geocode_requested_at = '${REQUESTED_AT}' WHERE id = 1`,
    );
    const { fetchFn } = fakeCloud({ geocode_requested: true, geocode_requested_at: asPostgres(REQUESTED_AT) });
    await ticks(dbPath, fetchFn, 1);
    expect(local(dbPath, "geocode_requested", "geocode_requested_at")).toEqual({ flag: 1, at: REQUESTED_AT });
  });
});
