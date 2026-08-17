/**
 * O-97 — un push applicato a metà non è un push fallito.
 *
 * Misurato sulla VPS: il delta dal cursore è 321 posizioni ordinate per
 * `updated_at`; il primo chunk PASSA e viene scritto sul cloud, il secondo
 * riceve un 500, il push aborta. Se il checkpoint non avanza, al tick dopo si
 * ricalcola lo STESSO delta e si rispedisce il chunk già scritto — per sempre,
 * senza che nulla progredisca.
 *
 * ⚠️ Il fix ovvio è quello sbagliato: far avanzare il cursore «per sbloccare»
 * lo porterebbe oltre le righe mai tentate, che uscirebbero dal delta e non
 * verrebbero MAI più spedite — un difetto senza perdita diventerebbe perdita
 * definitiva. Il cursore può avanzare SOLO fino a ciò che è provato scritto.
 *
 * Il test guarda il file del cursore e il corpo delle richieste del tick
 * successivo: la domanda è «cosa riparte al prossimo giro», e a quella
 * risponde solo il secondo giro.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const dirs: string[] = [];
let previousHome: string | undefined;
let previousChunk: string | undefined;

/** Quattro posizioni con `updated_at` distinti: due chunk da due. */
const POSITIONS = [
  { id: 1, updated_at: "2026-08-12 09:00:00" },
  { id: 2, updated_at: "2026-08-13 09:00:00" },
  { id: 3, updated_at: "2026-08-14 09:00:00" },
  { id: 4, updated_at: "2026-08-15 09:00:00" },
];

function fixture() {
  previousHome = process.env.JHT_HOME;
  previousChunk = process.env.JHT_PUSH_POS_CHUNK;
  const home = mkdtempSync(join(tmpdir(), "jht-partial-checkpoint-"));
  dirs.push(home);
  process.env.JHT_HOME = home;
  // Il taglio del chunk è il cuore del difetto: qui è due invece di
  // settantacinque per poterlo scrivere in quattro righe di dati.
  process.env.JHT_PUSH_POS_CHUNK = "2";
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
  // Lo schema per intero: il lettore del push seleziona tutte queste colonne,
  // e una tabella ridotta fa fallire la lettura prima di arrivare alla rete —
  // cioe' proprio prima di cio' che questo test misura.
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
    "INSERT INTO positions (id,title,company,status,updated_at) VALUES (?,?,'Synthetic company','new',?)",
  );
  for (const row of POSITIONS)
    insert.run(row.id, `Synthetic role ${row.id}`, row.updated_at);
  db.close();
  return { home, dbPath };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function acknowledged(table: string, rows: Array<{ _receipt_id?: string }>) {
  return {
    receipts: { [table]: rows.map((row) => row._receipt_id) },
    [table]: { upserted: rows.length },
  };
}

/**
 * Il cloud come si comporta davvero in O-97: accetta le righe fino a `fino`,
 * e sulla prima oltre risponde 500 senza `rejection_scope`.
 *
 * Il 500 non è un guasto: è il trigger `reject_stale_applied_position_downgrade`
 * che alza `P0001`, e PostgREST mappa `P0001` su 500. Senza
 * `rejection_scope: 'row'` il client non può isolare, quindi aborta il convoglio
 * — ed è esattamente lo stato in cui la macchina è rimasta.
 */
function cloudThatRefusesAfter(fino: number, accettate: number[][]) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const table = Object.keys(body)[0];
    const rows = body[table] as Array<{ id?: number; _receipt_id?: string }>;
    if (table === "positions") {
      const ids = rows.map((row) => row.id!);
      if (ids.some((id) => id > fino)) {
        return jsonResponse({ error: "positions_upsert_failed" }, 500);
      }
      accettate.push(ids);
    }
    return jsonResponse(acknowledged(table, rows));
  });
}

function cursor(home: string) {
  try {
    return JSON.parse(
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  process.exitCode = undefined;
  if (previousHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = previousHome;
  if (previousChunk === undefined) delete process.env.JHT_PUSH_POS_CHUNK;
  else process.env.JHT_PUSH_POS_CHUNK = previousChunk;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("O-97 — checkpoint fino all'ultimo chunk confermato", () => {
  it("avanza il cursore sul chunk scritto, e non oltre", async () => {
    const { home, dbPath } = fixture();
    const accettate: number[][] = [];
    vi.stubGlobal("fetch", cloudThatRefusesAfter(2, accettate));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    const esito = await handlePush({ db: dbPath });

    expect(esito.ok).toBe(false);
    // Il chunk 1 è stato accettato: quelle due righe sono sul cloud.
    expect(accettate).toEqual([[1, 2]]);
    // Quindi il cursore deve fermarsi sul ts dell'ultima riga provata scritta.
    expect(cursor(home)?.positions).toBe("2026-08-13 09:00:00");
  });

  it("il tick dopo riparte dalle righe non tentate, non da capo", async () => {
    const { home, dbPath } = fixture();
    const primo: number[][] = [];
    vi.stubGlobal("fetch", cloudThatRefusesAfter(2, primo));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const cloud = await import("../../../cli/src/commands/cloud.js");
    await cloud.handlePush({ db: dbPath });

    // Secondo giro: il cloud ora accetta tutto (la riga che rifiutava è stata
    // sistemata). Se il cursore fosse fermo, qui ripasserebbero 1 e 2.
    const secondo: number[][] = [];
    vi.stubGlobal("fetch", cloudThatRefusesAfter(4, secondo));
    await cloud.handlePush({ db: dbPath });

    expect(secondo).toEqual([[3, 4]]);
    expect(cursor(home)?.positions).toBe("2026-08-15 09:00:00");
  });

  it("se il PRIMO chunk fallisce il cursore non si muove, e il tick dopo rimanda tutto", async () => {
    /**
     * Lo stallo osservato in produzione ha questa forma, non quella del test
     * qui sopra: se nessun chunk viene confermato non c'e' niente di provato
     * scritto, quindi il cursore resta dov'e' — che e' corretto — e il delta
     * ricomincia identico a ogni tick.
     *
     * Serve per distinguere le due ipotesi guardando un dato invece di
     * discuterne: «il chunk 1 passa e poi arriva il 500» e «il 500 arriva
     * subito» producono cursori diversi, e il cursore fermo e' compatibile
     * SOLO con il secondo.
     */
    const { home, dbPath } = fixture();
    const primo: number[][] = [];
    vi.stubGlobal("fetch", cloudThatRefusesAfter(0, primo));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const cloud = await import("../../../cli/src/commands/cloud.js");
    await cloud.handlePush({ db: dbPath });

    expect(primo).toEqual([]);
    expect(cursor(home)?.positions).toBeUndefined();

    const secondo: number[][] = [];
    vi.stubGlobal("fetch", cloudThatRefusesAfter(0, secondo));
    await cloud.handlePush({ db: dbPath });

    // Nessuna riga esce dal delta: e' un difetto senza perdita, e va tenuto
    // tale finche' non si sa QUALE riga il cloud rifiuta.
    expect(secondo).toEqual([]);
    expect(cursor(home)?.positions).toBeUndefined();
  });

  it("non scavalca una riga non tentata che condivide il timestamp", async () => {
    /**
     * Il delta si rilegge con `updated_at > cursore`: se il cursore arrivasse
     * a un ts che una riga NON tentata condivide, quella riga uscirebbe dal
     * delta e non verrebbe più spedita. È il modo esatto in cui «sbloccare il
     * cursore» diventa perdita di dati, e vale la pena tenerlo fermo con un
     * test invece che con un commento.
     */
    const { home, dbPath } = fixture();
    const db = new DatabaseSync(dbPath);
    // La riga 3 (non tentata, nel chunk che fallisce) condivide il ts con la 2.
    db.exec("UPDATE positions SET updated_at='2026-08-13 09:00:00' WHERE id=3");
    db.close();
    const accettate: number[][] = [];
    vi.stubGlobal("fetch", cloudThatRefusesAfter(2, accettate));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await handlePush({ db: dbPath });

    // Il cursore si ferma PRIMA del ts condiviso: meglio rispedire la riga 2
    // che perdere la 3.
    expect(cursor(home)?.positions).toBe("2026-08-12 09:00:00");
  });
});
