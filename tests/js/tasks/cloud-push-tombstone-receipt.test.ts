/**
 * JHT-422 — sender e route a contatto sui tombstone.
 *
 * Il sender (cli/src/commands/cloud.js) manda una ricevuta attesa per riga e
 * accetta il 2xx solo se la route ne restituisce lo STESSO multinsieme; la
 * route (web/app/api/cloud-sync/push/route.ts) aggiunge la ricevuta di un
 * tombstone solo se il suo UPDATE ha restituito almeno una riga. Quando
 * l'UPDATE non trova la destinazione la route risponde 200 senza errore e
 * senza ricevuta, il sender sintetizza `acknowledgement_mismatch` (422 senza
 * `rejection_scope`): niente bisezione, niente quarantena, cursore fermo, e a
 * ogni giro lo stesso lotto — i tombstone sani dello stesso lotto compresi.
 *
 * Qui il sender VERO parla con la route VERA: della rete c'è solo `fetch`, del
 * database solo un finto in memoria con poche righe inventate. Le tabelle che
 * non sono tombstone ricevono un'ack sintetica: non sono l'oggetto della prova.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const userId = "00000000-0000-0000-0000-000000000422";

type CloudState = {
  positions: Map<number, { id: string; deleted_at: string | null }>;
  scores: Array<{ position_id: string; deleted_at: string | null }>;
  applications: Array<{ position_id: string; deleted_at: string | null }>;
};
let cloud: CloudState;

function newCloud(): CloudState {
  return { positions: new Map(), scores: [], applications: [] };
}
cloud = newCloud();

/** Il minimo del client Supabase che il ramo tombstone della route usa. */
function fakeSupabase() {
  return {
    from(table: string) {
      let operation = "select";
      let payload: Record<string, unknown> = {};
      const filters: Array<[string, string, unknown]> = [];
      const builder: Record<string, any> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push(["eq", column, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push(["is", column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push(["in", column, values]);
          return builder;
        },
        update(value: Record<string, unknown>) {
          operation = "update";
          payload = value;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then(ok: (value: any) => unknown, ko?: (error: unknown) => unknown) {
          const finish = async () => {
            const value = (column: string) =>
              filters.find(([, c]) => c === column)?.[2];
            if (table === "positions") {
              if (operation === "update") {
                const legacyId = value("legacy_id") as number;
                const row = cloud.positions.get(legacyId);
                if (!row) return { data: [], error: null };
                row.deleted_at = payload.deleted_at as string;
                return { data: [{ legacy_id: legacyId }], error: null };
              }
              const wanted = (value("legacy_id") as number[]) ?? [];
              return {
                data: wanted
                  .filter((id) => cloud.positions.has(id))
                  .map((id) => ({
                    id: cloud.positions.get(id)!.id,
                    legacy_id: id,
                  })),
                error: null,
              };
            }
            if (table === "scores" || table === "applications") {
              const rows = (cloud as any)[table].filter(
                (row: { position_id: string }) =>
                  row.position_id === value("position_id"),
              );
              for (const row of rows)
                row.deleted_at = payload.deleted_at as string;
              return {
                data: rows.map((row: any) => ({ position_id: row.position_id })),
                error: null,
              };
            }
            return { data: null, error: null };
          };
          return finish().then(ok, ko);
        },
      };
      return builder;
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: vi.fn(async () => ({
    ok: true,
    data: { userId, tokenId: "synthetic-token-id", admin: fakeSupabase() },
  })),
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: vi.fn(async () => ({
    allowed: true,
    retryAfterSec: 0,
  })),
}));
vi.mock("@/lib/cloud-sync/onboarding-milestones", () => ({
  teamProducedWork: vi.fn(() => false),
  firstTeamRunPatch: vi.fn(() => null),
}));
vi.mock("@/lib/team-state/sync-freshness", () => ({
  syncRequestIsPending: vi.fn(() => false),
}));

const { POST: pushPost } = await import("@/app/api/cloud-sync/push/route");

const dirs: string[] = [];
let previousHome: string | undefined;

const T1 = "2026-08-15 09:00:00";
const T2 = "2026-08-15 09:01:00";
const T3 = "2026-08-15 09:02:00";

type Tombstone = [table: string, legacyId: number, deletedAt: string];

function fixture(tombstones: Tombstone[]) {
  previousHome = process.env.JHT_HOME;
  const home = mkdtempSync(join(tmpdir(), "jht-tombstone-receipt-"));
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
    CREATE TABLE _tombstones (
      table_name TEXT, legacy_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE pending_user_messages (
      id INTEGER PRIMARY KEY, agent TEXT, body TEXT, kind TEXT,
      related_position_id INTEGER, delivered_via TEXT, delivered_at TEXT,
      acknowledged_at TEXT, user_reply TEXT, user_reply_at TEXT,
      agent_seen_reply_at TEXT, created_at TEXT
    );
    INSERT INTO pending_user_messages (id, agent, body, kind, created_at)
    VALUES (1, 'agent', 'Synthetic message', 'notification', '2026-08-15 09:05:00');
  `);
  const insert = db.prepare(
    "INSERT INTO _tombstones (table_name, legacy_id, deleted_at) VALUES (?,?,?)",
  );
  for (const row of tombstones) insert.run(...row);
  db.close();

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();

  const start = Date.UTC(2026, 7, 15, 10);
  const cycle = async (minute: number) => {
    const { maybePeriodicPush } = await import(
      "../../../cli/src/commands/cloud.js"
    );
    return maybePeriodicPush({
      db: dbPath,
      now: start + minute * 60_000,
      limits: {
        enabled: true,
        intervalMs: 60_000,
        retryMs: 60_000,
        timeoutMs: 120_000,
      },
      publishObservation: false,
      noticeRefusedToken: async () => ({ notified: false }),
      silent: true,
    });
  };
  return { home, cycle };
}

type Post = { table: string; rows: Array<Record<string, unknown>>; status: number; response: any };

/** Il cloud: la route vera per i tombstone, un'ack sintetica per il resto. */
function cloudFetch(posts: Post[], override?: (table: string) => Response | undefined) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const table = Object.keys(body)[0];
    const rows = body[table] as Array<Record<string, unknown>>;
    let response = override?.(table);
    if (!response && table === "tombstones") {
      response = await pushPost(
        new Request("http://localhost/api/cloud-sync/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: init?.body as string,
        }) as any,
      );
    }
    if (!response) {
      response = Response.json({
        receipts: { [table]: rows.map((row) => row._receipt_id) },
        [table]: { upserted: rows.length },
      });
    }
    posts.push({
      table,
      rows,
      status: response.status,
      response: await response.clone().json().catch(() => null),
    });
    return response;
  });
}

function readCursor(home: string) {
  try {
    return JSON.parse(readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"));
  } catch {
    return null;
  }
}

async function activeQuarantine() {
  const quarantine = await import("../../../cli/src/lib/cloud-push-quarantine.js");
  return quarantine.activeQuarantineEntries(quarantine.readCloudPushQuarantine());
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  process.exitCode = undefined;
  cloud = newCloud();
  if (previousHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = previousHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seedCloud() {
  // Due posizioni sul cloud, uno score per la prima.
  cloud.positions.set(1, { id: "position-uuid-1", deleted_at: null });
  cloud.positions.set(2, { id: "position-uuid-2", deleted_at: null });
  cloud.scores.push({ position_id: "position-uuid-1", deleted_at: null });
}

describe("JHT-422 — ricevute dei tombstone fra sender e route", () => {
  it("caso sano: ricevute riordinate, cursore avanzato, tabella dopo spedita, secondo giro fermo", async () => {
    seedCloud();
    // Ordine di invio per deleted_at: positions/1, scores/1, positions/2. La
    // route risponde positions prima di scores: le ricevute tornano riordinate.
    const { home, cycle } = fixture([
      ["positions", 1, T1],
      ["scores", 1, T2],
      ["positions", 2, T3],
    ]);
    const posts: Post[] = [];
    vi.stubGlobal("fetch", cloudFetch(posts));

    await expect(cycle(0)).resolves.toMatchObject({ result: { ok: true } });

    const tomb = posts.find((p) => p.table === "tombstones")!;
    expect(tomb.status).toBe(200);
    expect(tomb.response.receipts.tombstones).toHaveLength(3);
    expect(tomb.response.receipts.tombstones).not.toEqual(
      tomb.rows.map((row) => row._receipt_id),
    );
    expect(readCursor(home)?.tombstones).toBe(T3);
    expect(posts.map((p) => p.table)).toEqual(["tombstones", "pending_user_messages"]);
    expect(cloud.positions.get(1)?.deleted_at).toBe(T1);
    expect(cloud.positions.get(2)?.deleted_at).toBe(T3);
    expect(cloud.scores[0].deleted_at).toBe(T2);

    const sent = posts.length;
    await expect(cycle(1)).resolves.toMatchObject({ push: false, reason: "nothing_new" });
    expect(posts).toHaveLength(sent);
  });

  it("già applicato: il tombstone ripetuto si conferma senza quarantena", async () => {
    seedCloud();
    cloud.positions.get(1)!.deleted_at = T1;
    const { home, cycle } = fixture([["positions", 1, T1]]);
    const posts: Post[] = [];
    vi.stubGlobal("fetch", cloudFetch(posts));

    await expect(cycle(0)).resolves.toMatchObject({ result: { ok: true } });
    expect(readCursor(home)?.tombstones).toBe(T1);
    expect(await activeQuarantine()).toHaveLength(0);
  });

  describe("UPDATE a zero righe (destinazione assente sul cloud)", () => {
    // positions/9 non esiste sul cloud: l'UPDATE finisce senza errore e senza
    // righe. scores/2 ha la posizione ma nessuno score. Entrambi sono lo stato
    // che il tombstone voleva produrre: la cosa da non fare è fermare tutto il
    // lotto, compresi i tombstone sani, per sempre.
    const ROWS: Tombstone[] = [
      ["positions", 1, T1],
      ["positions", 9, T2],
      ["scores", 2, T3],
    ];

    it("route che omette una ricevuta (versione precedente durante un rollout): 422 sintetico, niente quarantena, cursore fermo, stesso lotto a ogni giro", async () => {
      seedCloud();
      const { home, cycle } = fixture(ROWS);
      const posts: Post[] = [];
      // La route di prima della correzione: ricevuta solo per le righe che
      // l'UPDATE ha trovato (qui positions/1).
      vi.stubGlobal(
        "fetch",
        cloudFetch(posts, (table) => {
          if (table !== "tombstones") return undefined;
          cloud.positions.get(1)!.deleted_at = T1;
          return Response.json({
            ok: true,
            receipts: { tombstones: [omitted.receipt] },
            tombstones: { applied: 1 },
          });
        }),
      );
      const omitted = { receipt: "" };
      const { receiptId } = await import("../../../shared/cloud/receipt-ids.js");
      omitted.receipt = receiptId("tombstones", {
        table_name: "positions",
        legacy_id: 1,
        deleted_at: T1,
      });

      const first = await cycle(0);
      expect(first).toMatchObject({ result: { ok: false } });
      const tomb = posts.filter((p) => p.table === "tombstones");
      expect(tomb).toHaveLength(1); // nessuna bisezione: il 422 sintetico non isola
      expect(tomb[0].rows).toHaveLength(3);
      expect(readCursor(home)?.tombstones ?? null).toBeNull();
      expect(await activeQuarantine()).toHaveLength(0);
      expect(posts.some((p) => p.table === "pending_user_messages")).toBe(false);
      const errors = (console.error as any).mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(errors).toContain("acknowledgement_mismatch");

      await expect(cycle(1)).resolves.toMatchObject({ result: { ok: false } });
      const again = posts.filter((p) => p.table === "tombstones");
      expect(again).toHaveLength(2);
      expect(again[1].rows.map((row) => row._receipt_id)).toEqual(
        tomb[0].rows.map((row) => row._receipt_id),
      );
    });

    it("atteso: la destinazione assente si conferma, il cursore avanza e la tabella dopo parte", async () => {
      seedCloud();
      const { home, cycle } = fixture(ROWS);
      const posts: Post[] = [];
      vi.stubGlobal("fetch", cloudFetch(posts));

      await expect(cycle(0)).resolves.toMatchObject({ result: { ok: true } });
      const tomb = posts.find((p) => p.table === "tombstones")!;
      expect(tomb.response.receipts.tombstones).toHaveLength(3);
      expect(readCursor(home)?.tombstones).toBe(T3);
      expect(posts.map((p) => p.table)).toEqual(["tombstones", "pending_user_messages"]);
      expect(await activeQuarantine()).toHaveLength(0);

      const sent = posts.length;
      await expect(cycle(1)).resolves.toMatchObject({ push: false, reason: "nothing_new" });
      expect(posts).toHaveLength(sent);
    });

    it("la posizione assente di uno score resta un rifiuto di riga (422 con rejection_scope=row) e finisce in quarantena", async () => {
      seedCloud();
      const { cycle } = fixture([
        ["positions", 1, T1],
        ["scores", 9, T2],
      ]);
      const posts: Post[] = [];
      vi.stubGlobal("fetch", cloudFetch(posts));

      const first = await cycle(0);
      expect(first).toMatchObject({ result: { ok: true, quarantinedNew: 1 } });
      const rejected = posts.filter((p) => p.status === 422);
      expect(rejected.length).toBeGreaterThan(0);
      expect(rejected[0].response).toMatchObject({
        error: "tombstone_position_not_found",
        rejection_scope: "row",
      });
      const entries = await activeQuarantine();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ table: "tombstones" });
    });
  });

  describe("controlli di distinzione", () => {
    it("200 senza array di ricevute → 502 receipt_protocol_missing, cursore fermo, nessuna quarantena", async () => {
      seedCloud();
      const { home, cycle } = fixture([["positions", 1, T1]]);
      const posts: Post[] = [];
      vi.stubGlobal(
        "fetch",
        cloudFetch(posts, (table) =>
          table === "tombstones" ? Response.json({ ok: true, tombstones: { applied: 1 } }) : undefined,
        ),
      );

      await expect(cycle(0)).resolves.toMatchObject({ result: { ok: false } });
      const errors = (console.error as any).mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(errors).toContain("receipt_protocol_missing");
      expect(readCursor(home)?.tombstones ?? null).toBeNull();
      expect(await activeQuarantine()).toHaveLength(0);
    });

    it("errore transitorio → ritento dal cursore sicuro, poi conferma", async () => {
      seedCloud();
      const { home, cycle } = fixture([
        ["positions", 1, T1],
        ["positions", 2, T2],
      ]);
      const posts: Post[] = [];
      let outage = true;
      vi.stubGlobal(
        "fetch",
        cloudFetch(posts, (table) =>
          table === "tombstones" && outage
            ? Response.json({ error: "unavailable" }, { status: 503 })
            : undefined,
        ),
      );

      await expect(cycle(0)).resolves.toMatchObject({ result: { ok: false } });
      expect(readCursor(home)?.tombstones ?? null).toBeNull();
      expect(await activeQuarantine()).toHaveLength(0);

      outage = false;
      await expect(cycle(1)).resolves.toMatchObject({ result: { ok: true } });
      expect(readCursor(home)?.tombstones).toBe(T2);
      expect(posts.filter((p) => p.table === "tombstones").at(-1)?.rows).toHaveLength(2);
    });
  });
});
