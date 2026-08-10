import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

// better-sqlite3 non è una dipendenza di tests/js: lo prendiamo da web/, che
// è dove vive (e che la CI installa già per i test con alias `@`). Aggiungerlo
// qui significherebbe compilare un secondo binding nativo per usare la stessa
// libreria.
const requireFromWeb = createRequire(
  join(__dirname, "../../../web/package.json"),
);
const Database = requireFromWeb("better-sqlite3");

/**
 * O-37 — in locale l'ordinamento su una colonna "derivata" riordinava solo
 * la pagina che stavi guardando.
 *
 * `getPositionsLocal` ordina in SQL soltanto le chiavi presenti in
 * POSITION_SORT_COLUMNS; per tutte le altre l'ORDER BY cadeva sul default
 * (found_at DESC), il LIMIT/OFFSET tagliava LÌ, e solo dopo il sort in JS
 * rimetteva in ordine — cioè rimetteva in ordine le righe sbagliate.
 * Ordinando "CV scritto il" crescente, in cima non arrivavano i più vecchi
 * ma i più vecchi FRA i primi N per data di rilevazione.
 *
 * Nessun test poteva vederlo perché è un difetto che compare solo quando le
 * righe sono più del limite: con quattro posizioni di prova sta tutto in una
 * pagina e l'ordine sembra giusto.
 *
 * Il ramo cloud non ha mai avuto il problema: lì il taglio è fatto dopo.
 */
let home: string;
let getPositionsLocal: typeof import("@/lib/local-queries").getPositionsLocal;

// 30 posizioni: found_at CRESCENTE con l'id, written_at DECRESCENTE. Le due
// chiavi sono in ordine opposto apposta — così un taglio fatto su found_at
// non può contenere per caso le righe giuste per written_at.
const N = 30;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "jht-sort-"));
  process.env.JHT_HOME = home;

  const db = new Database(join(home, "jobs.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      legacy_id INTEGER, title TEXT, company TEXT, location TEXT,
      remote_type TEXT, source TEXT, found_by TEXT, found_at TIMESTAMP,
      status TEXT, notes TEXT, last_checked TIMESTAMP, role_family TEXT,
      loc_country TEXT, loc_city TEXT, url TEXT,
      salary_declared_min INTEGER, salary_declared_max INTEGER,
      salary_declared_currency TEXT, salary_estimated_min INTEGER,
      salary_estimated_max INTEGER, salary_estimated_currency TEXT,
      salary_estimated_source TEXT
    );
    CREATE TABLE scores (
      position_id INTEGER, total_score INTEGER, stack_match INTEGER,
      remote_fit INTEGER, salary_fit INTEGER, strategic_fit INTEGER,
      scored_at TIMESTAMP, scored_by TEXT
    );
    CREATE TABLE applications (
      position_id INTEGER, written_at TIMESTAMP, written_by TEXT,
      critic_reviewed_at TIMESTAMP, reviewed_by TEXT, applied_at TIMESTAMP,
      response_at TIMESTAMP, critic_score REAL, critic_verdict TEXT
    );
    CREATE TABLE position_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, status TEXT
    );
  `);
  const insP = db.prepare(
    "INSERT INTO positions (title, company, found_at, status, source) VALUES (?, 'ACME', ?, 'ready', 'linkedin')",
  );
  const insA = db.prepare(
    "INSERT INTO applications (position_id, written_at) VALUES (?, ?)",
  );
  for (let i = 0; i < N; i++) {
    const day = String(i + 1).padStart(2, "0");
    const invDay = String(N - i).padStart(2, "0");
    const r = insP.run(`pos-${i}`, `2026-03-${day}T09:00:00Z`);
    insA.run(r.lastInsertRowid, `2026-04-${invDay}T09:00:00Z`);
  }
  db.close();

  ({ getPositionsLocal } = await import("@/lib/local-queries"));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("ordinamento + paginazione in locale", () => {
  it("con un limite, in cima arrivano davvero i più vecchi", () => {
    const page = getPositionsLocal(home, {
      sort: "written_at",
      dir: "asc",
      limit: 5,
    });
    // I 5 written_at più vecchi in assoluto sono 01→05 aprile, cioè le
    // posizioni inserite per ULTIME (found_at più recente): esattamente
    // quelle che un taglio su found_at DESC... conserva. Usiamo il verso
    // opposto per un controllo che non possa passare per caso.
    expect(page).toHaveLength(5);
    expect(page.map((p) => p.written_at)).toEqual([
      "2026-04-01T09:00:00Z",
      "2026-04-02T09:00:00Z",
      "2026-04-03T09:00:00Z",
      "2026-04-04T09:00:00Z",
      "2026-04-05T09:00:00Z",
    ]);
  });

  it("e in fondo i più recenti", () => {
    const page = getPositionsLocal(home, {
      sort: "written_at",
      dir: "desc",
      limit: 5,
    });
    expect(page.map((p) => p.written_at)).toEqual([
      "2026-04-30T09:00:00Z",
      "2026-04-29T09:00:00Z",
      "2026-04-28T09:00:00Z",
      "2026-04-27T09:00:00Z",
      "2026-04-26T09:00:00Z",
    ]);
  });

  it("la seconda pagina continua la prima, non ricomincia", () => {
    const first = getPositionsLocal(home, {
      sort: "written_at",
      dir: "asc",
      limit: 5,
    });
    const second = getPositionsLocal(home, {
      sort: "written_at",
      dir: "asc",
      limit: 5,
      offset: 5,
    });
    expect(second.map((p) => p.written_at)).toEqual([
      "2026-04-06T09:00:00Z",
      "2026-04-07T09:00:00Z",
      "2026-04-08T09:00:00Z",
      "2026-04-09T09:00:00Z",
      "2026-04-10T09:00:00Z",
    ]);
    // Nessuna riga compare in tutte e due le pagine.
    const ids = new Set(first.map((p) => p.id));
    expect(second.some((p) => ids.has(p.id))).toBe(false);
  });

  it("vale anche per le colonne SQL, che non devono regredire", () => {
    const page = getPositionsLocal(home, {
      sort: "found_at",
      dir: "asc",
      limit: 3,
    });
    expect(page.map((p) => p.found_at)).toEqual([
      "2026-03-01T09:00:00Z",
      "2026-03-02T09:00:00Z",
      "2026-03-03T09:00:00Z",
    ]);
  });
});
