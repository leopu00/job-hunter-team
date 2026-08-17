/**
 * #163 — il giro completo della coda messaggi, client vero contro route vera.
 *
 * Gli altri test guardano una metà per volta: qui le due metà si parlano. Il
 * `fetch` del CLI non va in rete, chiama la `POST` della route, e in mezzo c'è
 * un finto Supabase che imita le DUE cose che sul campo hanno rotto il
 * protocollo:
 *
 * - la MERGE è asimmetrica di proposito (mig 057 e 060): sui campi che il
 *   cloud sa e il box no fa COALESCE, quindi un timbro messo dal web non
 *   viene cancellato dal NULL del box;
 * - la RESA dei valori non è quella che il client ha mandato. PostgREST apre
 *   la sessione con `extra_float_digits = 0`, quindi `chat_ts` (double
 *   precision) torna con quindici cifre significative, e i `timestamptz`
 *   tornano in forma ISO con `+00:00`.
 *
 * Senza quelle due imitazioni il finto cloud direbbe sempre di sì, e questo
 * test sarebbe una tautologia: passerebbe anche col difetto dentro.
 *
 * Quello che si misura non è «i test passano», ma il fatto che il push
 * ARRIVI IN FONDO: prima del fix il client trasformava il 200 del server in un
 * 422 inventato, si fermava sul chunk dei messaggi e tutto ciò che veniva dopo
 * — il profilo — non partiva mai. 4305 tick di fila.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dirs: string[] = [];
let previousHome: string | undefined;

/** Le righe come le tiene il cloud, per `legacy_id`. */
let cloudRows = new Map<number, Record<string, unknown>>();

/** La resa di un timestamptz da parte di PostgREST. */
function postgrestInstant(value: unknown) {
  if (typeof value !== "string" || value === "") return null;
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    value,
  );
  const ms = Date.parse(naive ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(ms)
    ? null
    : new Date(ms).toISOString().replace("Z", "+00:00");
}

/**
 * La resa di un `double precision` con `extra_float_digits = 0`: quindici
 * cifre significative, che NON è la forma che ritorna identica. Misurato sul
 * cloud: 1786999449.694782 esce 1786999449.69478.
 */
function postgrestDouble(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toPrecision(15));
}

const coalesce = (incoming: unknown, existing: unknown) =>
  incoming == null ? (existing ?? null) : incoming;

/** La merge della migrazione 057/060, nella sua parte che conta qui. */
function mergeIntoCloud(row: Record<string, unknown>) {
  const legacyId = Number(row.legacy_id);
  const existing = cloudRows.get(legacyId) ?? {};
  cloudRows.set(legacyId, {
    legacy_id: legacyId,
    agent: row.agent,
    body: row.body,
    kind: row.kind,
    author: row.author === "user" ? "user" : (existing.author ?? row.author),
    chat_ts: postgrestDouble(coalesce(row.chat_ts, existing.chat_ts)),
    related_position_id: coalesce(
      row.related_position_id,
      existing.related_position_id,
    ),
    delivered_via: coalesce(row.delivered_via, existing.delivered_via),
    delivered_at: postgrestInstant(
      coalesce(row.delivered_at, existing.delivered_at),
    ),
    agent_seen_reply_at: postgrestInstant(
      coalesce(row.agent_seen_reply_at, existing.agent_seen_reply_at),
    ),
  });
}

const admin = {
  from: (table: string) => {
    const builder: any = {
      _in: [] as number[],
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      in(_column: string, values: number[]) {
        builder._in = values;
        return builder;
      },
      upsert() {
        return builder;
      },
      update() {
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then(ok: any, ko: any) {
        const data =
          table === "pending_user_messages"
            ? [...cloudRows.values()].filter((row) =>
                builder._in.includes(Number(row.legacy_id)),
              )
            : [];
        return Promise.resolve({ data, error: null }).then(ok, ko);
      },
    };
    return builder;
  },
  rpc: vi.fn(async (name: string, args: any) => {
    if (name === "upsert_pending_user_messages_merge") {
      for (const row of args.p_rows) mergeIntoCloud(row);
      return { data: args.p_rows.length, error: null };
    }
    if (name === "sync_candidate_profile_atomic") {
      return {
        data: { applied: true, content_hash: "synthetic" },
        error: null,
      };
    }
    return { data: null, error: null };
  }),
};

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: vi.fn(async () => ({
    ok: true,
    data: {
      userId: "00000000-0000-0000-0000-000000000073",
      tokenId: "synthetic-token-id",
      admin,
    },
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

const { POST } = await import("@/app/api/cloud-sync/push/route");

const SCHEMA = `
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, company_id INTEGER,
    url TEXT, location TEXT, remote_type TEXT, status TEXT, notes TEXT,
    source TEXT, jd_text TEXT, jd_summary TEXT, requirements TEXT,
    found_by TEXT, found_at TEXT, deadline TEXT, last_checked TEXT,
    last_actor TEXT, salary_declared_min INTEGER, salary_declared_max INTEGER,
    salary_declared_currency TEXT, salary_estimated_min INTEGER,
    salary_estimated_max INTEGER, salary_estimated_currency TEXT,
    salary_estimated_source TEXT, write_requested INTEGER,
    write_requested_at TEXT, geocode_requested INTEGER,
    geocode_requested_at TEXT, recheck_requested INTEGER,
    recheck_requested_at TEXT, salary_precise_requested INTEGER,
    salary_precise_requested_at TEXT, salary_precise TEXT, role_family TEXT,
    loc_city TEXT, loc_region TEXT, loc_country TEXT, loc_country_code TEXT,
    loc_continent TEXT, work_mode TEXT, work_country TEXT,
    work_country_code TEXT, location_notes TEXT, is_multi_location INTEGER,
    office_lat REAL, office_lon REAL, office_address TEXT,
    office_geocoded INTEGER, office_verified INTEGER, expires_at TEXT,
    is_open INTEGER, last_open_check TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER UNIQUE,
    cv_path TEXT, cv_pdf_path TEXT, cl_path TEXT, cl_pdf_path TEXT,
    status TEXT, critic_score REAL, critic_verdict TEXT, critic_notes TEXT,
    critic_round INTEGER, written_at TEXT, applied_at TEXT, applied_via TEXT,
    response TEXT, response_at TEXT, written_by TEXT, reviewed_by TEXT,
    critic_reviewed_at TEXT, applied INTEGER, cv_drive_id TEXT,
    cl_drive_id TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE scores (
    id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER,
    experience_fit INTEGER, salary_fit INTEGER, stack_match INTEGER,
    remote_fit INTEGER, strategic_fit INTEGER, breakdown TEXT, notes TEXT,
    scored_by TEXT, scored_at TEXT, updated_at TEXT
  );
  -- Copiata da shared/skills/_db.py: ts ha il DEFAULT, e senza quello il push
  -- aborta per identità mancante — un rosso del fixture che sembra un difetto
  -- del prodotto.
  CREATE TABLE pending_user_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL,
    body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'notification',
    author TEXT NOT NULL DEFAULT 'agent', chat_ts REAL,
    related_position_id INTEGER, delivered_via TEXT, delivered_at TIMESTAMP,
    acknowledged_at TIMESTAMP, user_reply TEXT, user_reply_at TIMESTAMP,
    agent_seen_reply_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

/**
 * Tre messaggi, e ognuno è uno dei modi in cui il giro si rompeva.
 * 1 — chat_ts con più cifre di quante il cloud ne renda;
 * 2 — consegnato dal web: il timbro esiste solo di là;
 * 3 — riga qualunque, per vedere che il caso normale non regredisca.
 */
const RIGHE = `
  INSERT INTO pending_user_messages
    (id, agent, body, kind, author, chat_ts, delivered_via, delivered_at,
     created_at)
  VALUES
    (382, 'SCOUT', 'Synthetic one', 'notification', 'agent',
     1786999449.694782, 'telegram', '2026-08-17 20:44:09',
     '2026-08-17 20:44:09'),
    (383, 'ASSISTENTE', 'Synthetic two', 'question', 'agent',
     1783904198.586839, NULL, NULL, '2026-08-17 20:45:00'),
    (384, 'MENTOR', 'Synthetic three', 'digest', 'agent',
     NULL, 'telegram', '2026-08-17 20:46:00', '2026-08-17 20:46:00');
`;

function box() {
  previousHome = process.env.JHT_HOME;
  const home = mkdtempSync(join(tmpdir(), "jht-messages-round-trip-"));
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
  // Niente profilo: il suo percorso passa da una catena di tabelle che questo
  // finto cloud non imita, e un rosso di li' non parlerebbe dei messaggi.
  const dbPath = join(home, "jobs.db");
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA + RIGHE);
  db.close();
  return { home, dbPath };
}

/** Il ponte: il CLI crede di parlare con la rete, e parla con la route. */
function collegaClientEServer() {
  const inviate: Array<{ tabelle: string[]; stato: number }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body || "{}");
      const risposta = await POST(
        new Request("http://localhost/api/cloud-sync/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }) as any,
      );
      inviate.push({
        tabelle: Object.keys(JSON.parse(body)),
        stato: risposta.status,
      });
      return risposta;
    }),
  );
  return inviate;
}

beforeEach(() => {
  cloudRows = new Map();
});

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

describe("#163 — la coda dei messaggi arriva in fondo, e il convoglio prosegue", () => {
  it("un tick completo conferma tutte le righe e lascia passare ciò che segue", async () => {
    const { dbPath } = box();
    // Il timbro che solo il cloud conosce: è il caso che rendeva la
    // condizione falsa per costruzione.
    cloudRows.set(383, {
      legacy_id: 383,
      agent: "ASSISTENTE",
      body: "Synthetic two",
      kind: "question",
      author: "agent",
      chat_ts: postgrestDouble(1783904198.586839),
      related_position_id: null,
      delivered_via: "web",
      delivered_at: "2026-08-17T20:45:30+00:00",
      agent_seen_reply_at: null,
    });
    const inviate = collegaClientEServer();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    const esito = await handlePush({ db: dbPath, full: true });

    expect(esito).toMatchObject({ ok: true });
    // Nessuna richiesta rifiutata: il 422 di #163 non veniva dalla rete, se lo
    // fabbricava il client dopo un 200. Qui si guarda proprio quello.
    expect(inviate.every((r) => r.stato === 200)).toBe(true);
    // Il chunk dei messaggi è partito UNA volta sola: se la ricevuta non
    // combacia il client bisziona e reinvia, quindi più richieste sulla
    // stessa tabella sono il sintomo del difetto.
    expect(
      inviate.filter((r) => r.tabelle.includes("pending_user_messages")),
    ).toHaveLength(1);
    // Le tre righe risultano confermate, non "mandate": e' la differenza fra
    // un push che arriva in fondo e uno che si ferma con la coda intatta.
    expect(esito).toMatchObject({ ok: true, quarantined: 0 });
    expect(cloudRows.size).toBe(3);
  });

  it("al tick successivo il cloud non contraddice più niente", async () => {
    // Il secondo giro è quello che sul campo si ripeteva 4305 volte: le righe
    // tornano su per progetto (questa tabella è full-push), ma DEVONO essere
    // confermate di nuovo, non rifiutate perché nel frattempo il cloud ha
    // imparato qualcosa in più.
    const { dbPath } = box();
    const inviate = collegaClientEServer();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await handlePush({ db: dbPath, full: true });
    // Fra un tick e l'altro il postino del web timbra una consegna che il box
    // non vedrà mai.
    cloudRows.set(384, {
      ...(cloudRows.get(384) as Record<string, unknown>),
      agent_seen_reply_at: "2026-08-17T21:00:00+00:00",
    });
    const secondo = await handlePush({ db: dbPath, full: true });

    expect(secondo).toMatchObject({ ok: true });
    expect(inviate.every((r) => r.stato === 200)).toBe(true);
    expect(
      inviate.filter((r) => r.tabelle.includes("pending_user_messages")),
    ).toHaveLength(2);
  });
});
