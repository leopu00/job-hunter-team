// #186 — lo stato delle candidature non torna dal cloud alla macchina.
//
// Misurato su una VPS gia' alla 0.3.9: l'Assistente dice all'utente di aver
// inviato 2 candidature, il numero vero e' 19. Cloud: 19 positions `applied`.
// SQLite sul box: 2. Il click sul sito scrive sul cloud e quel dato non
// rientra mai — quindi non e' un difetto di visualizzazione ma di INPUT: il
// team ragiona su 2 righe invece di 20, e non sa di non sapere.
//
// La corsia di ritorno esiste gia' e funziona: `pull-desired-state` porta
// indietro l'esclusione decisa sul web. La candidatura e' la stessa identica
// classe di cosa — un'azione dell'utente presa dal browser — e non ci e' mai
// stata messa. Questi test descrivono il ritorno mancante.
//
// Perche' la regola sta in `shared/` e non qui accanto: la decide anche la
// route che scrive (`mark-applied`), e due copie della stessa regola divergono
// al primo cambio. Stesso motivo di `shared/cloud/receipt-ids.js`.
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const Database = requireFromWeb("better-sqlite3");

const APPLIED_VIA_USER = "user_manual";

// Lo schema minimo che la corsia tocca. Non e' il DDL vero (lo possiede il
// container, `shared/skills/_db.py`): e' la sua ombra ristretta ai campi che
// questa corsia legge e scrive, come fanno gli altri test di questa cartella.
const SCHEMA = `
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT,
    status TEXT, last_actor TEXT
  );
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE,
    status TEXT DEFAULT 'draft', applied INTEGER DEFAULT 0,
    applied_at TEXT, applied_via TEXT, cv_path TEXT, cv_pdf_path TEXT,
    -- L'esito (#187): il DDL vero le ha da sempre, e da quando la corsia le
    -- legge l'ombra deve averle anche qui — un'ombra piu' stretta del
    -- lettore fa fallire il test per il motivo sbagliato.
    response TEXT, response_at TEXT, interview_round INTEGER,
    critic_notes TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE scores (position_id INTEGER UNIQUE, total_score INTEGER);
  CREATE TABLE position_state_transitions (
    id INTEGER PRIMARY KEY, position_id INTEGER,
    from_state TEXT, to_state TEXT, by_agent TEXT, notes TEXT
  );
`;

type Db = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number };
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Record<string, unknown>[];
  };
  close(): void;
};

const home = mkdtempSync(join(tmpdir(), "jht-applied-backflow-"));
let db: Db;
let dbSeq = 0;

function openFresh(): Db {
  const fresh = new Database(join(home, `jobs-${dbSeq++}.db`)) as Db;
  fresh.exec(SCHEMA);
  return fresh;
}

/** Una posizione lavorata dal team, non ancora candidata. */
function seedPosition(id: number, status = "ready") {
  db.prepare(
    "INSERT INTO positions (id, title, company, status) VALUES (?, 'Ruolo', 'Azienda', ?)",
  ).run(id, status);
  db.prepare("INSERT INTO scores (position_id, total_score) VALUES (?, 80)").run(
    id,
  );
}

/** La riga che il cloud restituisce per una candidatura mandata dall'utente. */
function cloudApplied(legacyId: number, at = "2026-08-17T09:00:00.000Z") {
  return {
    legacy_id: legacyId,
    applied: true,
    applied_at: at,
    applied_via: APPLIED_VIA_USER,
    status: "applied",
    updated_at: at,
  };
}

beforeEach(() => {
  db = openFresh();
});

describe("#186 — la decisione: cosa fare di una candidatura che arriva dal cloud", () => {
  it("candidatura dell'utente su una posizione che il box crede da lavorare → si applica", async () => {
    const { decideAppliedBackflow } = await import(
      "../../../shared/cloud/applied-action.js"
    );
    const verdict = decideAppliedBackflow({
      cloud: { applied: true, appliedVia: APPLIED_VIA_USER },
      local: { status: "ready", applied: false, appliedVia: null },
    });
    expect(verdict.action).toBe("apply");
  });

  it("la stessa riga al giro dopo non fa niente: la corsia gira ogni 5 minuti", async () => {
    const { decideAppliedBackflow } = await import(
      "../../../shared/cloud/applied-action.js"
    );
    const verdict = decideAppliedBackflow({
      cloud: { applied: true, appliedVia: APPLIED_VIA_USER },
      local: { status: "applied", applied: true, appliedVia: APPLIED_VIA_USER },
    });
    expect(verdict.action).toBe("skip");
  });

  it("una candidatura MANDATA DAL TEAM non si tocca da qui, in nessuno dei due versi", async () => {
    const { decideAppliedBackflow } = await import(
      "../../../shared/cloud/applied-action.js"
    );
    // Scriverla sarebbe raccontare al team una cosa falsa sul proprio lavoro:
    // e' la stessa ragione per cui la DELETE della route rifiuta con 409.
    expect(
      decideAppliedBackflow({
        cloud: { applied: false, appliedVia: null },
        local: { status: "applied", applied: true, appliedVia: "team" },
      }).action,
    ).toBe("skip");
    expect(
      decideAppliedBackflow({
        cloud: { applied: true, appliedVia: "team" },
        local: { status: "ready", applied: false, appliedVia: null },
      }).action,
    ).toBe("skip");
  });

  it("annullata sul web → si annulla anche sul box", async () => {
    const { decideAppliedBackflow } = await import(
      "../../../shared/cloud/applied-action.js"
    );
    const verdict = decideAppliedBackflow({
      cloud: { applied: false, appliedVia: null },
      local: { status: "applied", applied: true, appliedVia: APPLIED_VIA_USER },
    });
    expect(verdict.action).toBe("undo");
  });

  it("una posizione che il box non ha si salta: crearla coi soli flag la farebbe nascere zoppa", async () => {
    const { decideAppliedBackflow } = await import(
      "../../../shared/cloud/applied-action.js"
    );
    expect(
      decideAppliedBackflow({
        cloud: { applied: true, appliedVia: APPLIED_VIA_USER },
        local: null,
      }).action,
    ).toBe("skip");
  });
});

describe("#186 — l'effetto sul database del box", () => {
  it("scrive la candidatura, lo stato e la transizione, esattamente come il click locale", async () => {
    const { applyAppliedBackflow } = await import(
      "../../../cli/src/lib/applied-backflow.js"
    );
    seedPosition(643);

    const outcome = applyAppliedBackflow(db, [cloudApplied(643)]);
    expect(outcome.applied).toBe(1);

    const position = db
      .prepare("SELECT status, last_actor FROM positions WHERE id = ?")
      .get(643);
    expect(position).toMatchObject({ status: "applied", last_actor: "user" });

    const app = db
      .prepare(
        "SELECT status, applied, applied_at, applied_via FROM applications WHERE position_id = ?",
      )
      .get(643);
    expect(app).toMatchObject({
      status: "applied",
      applied: 1,
      applied_at: "2026-08-17T09:00:00.000Z",
      applied_via: APPLIED_VIA_USER,
    });

    // L'event-log e' il modo in cui la candidatura compare in «Attivita'
    // recente» accanto a quelle del team, e dice CHI l'ha decisa.
    const transition = db
      .prepare(
        "SELECT from_state, to_state, by_agent FROM position_state_transitions WHERE position_id = ?",
      )
      .get(643);
    expect(transition).toMatchObject({
      from_state: "ready",
      to_state: "applied",
      by_agent: "user",
    });
  });

  it("il secondo giro non riscrive niente e non aggiunge una seconda transizione", async () => {
    const { applyAppliedBackflow } = await import(
      "../../../cli/src/lib/applied-backflow.js"
    );
    seedPosition(643);

    applyAppliedBackflow(db, [cloudApplied(643)]);
    const second = applyAppliedBackflow(db, [cloudApplied(643)]);

    expect(second.applied).toBe(0);
    const n = db
      .prepare(
        "SELECT COUNT(*) AS n FROM position_state_transitions WHERE position_id = ?",
      )
      .get(643);
    expect(n).toMatchObject({ n: 1 });
  });

  it("l'annullamento riporta lo stato REGISTRATO nella transizione, non uno inventato", async () => {
    const { applyAppliedBackflow } = await import(
      "../../../cli/src/lib/applied-backflow.js"
    );
    seedPosition(643, "ready");
    applyAppliedBackflow(db, [cloudApplied(643)]);

    const outcome = applyAppliedBackflow(db, [
      {
        legacy_id: 643,
        applied: false,
        applied_at: null,
        applied_via: null,
        status: "ready",
        updated_at: "2026-08-17T10:00:00.000Z",
      },
    ]);

    expect(outcome.undone).toBe(1);
    expect(
      db.prepare("SELECT status FROM positions WHERE id = ?").get(643),
    ).toMatchObject({ status: "ready" });
    expect(
      db
        .prepare("SELECT applied, applied_via FROM applications WHERE position_id = ?")
        .get(643),
    ).toMatchObject({ applied: 0, applied_via: null });
  });

  it("la candidatura del team sopravvive a un cloud che la dice annullata", async () => {
    const { applyAppliedBackflow } = await import(
      "../../../cli/src/lib/applied-backflow.js"
    );
    seedPosition(643, "applied");
    db.prepare(
      `INSERT INTO applications (position_id, status, applied, applied_at, applied_via)
       VALUES (?, 'applied', 1, '2026-08-16T08:00:00.000Z', 'team')`,
    ).run(643);

    const outcome = applyAppliedBackflow(db, [
      {
        legacy_id: 643,
        applied: false,
        applied_at: null,
        applied_via: null,
        status: "ready",
        updated_at: "2026-08-17T10:00:00.000Z",
      },
    ]);

    expect(outcome.undone).toBe(0);
    expect(
      db
        .prepare("SELECT applied, applied_via FROM applications WHERE position_id = ?")
        .get(643),
    ).toMatchObject({ applied: 1, applied_via: "team" });
  });
});

// ── La classe, non il caso ────────────────────────────────────────────
//
// Il difetto di #186 non e' «manca un campo»: e' che la corsia di ritorno ha
// DUE implementazioni — la route Vercel e il lettore diretto — e una puo'
// imparare un campo che l'altra non conosce. E' gia' successo: il commento in
// `cloud.js` dichiara che la route filtra su `positions.updated_at`, colonna
// che sul cloud non esiste. Se le due proiezioni divergono, il ritorno
// funziona finche' non cambia la strada, e allora smette in silenzio.
describe("#186 — le due strade del ritorno proiettano le stesse cose", () => {
  const route = readFileSync(
    join(repo, "web/app/api/cloud-sync/pull-desired-state/route.ts"),
    "utf8",
  );
  const direct = readFileSync(
    join(repo, "cli/src/lib/supabase-direct.js"),
    "utf8",
  );

  for (const field of ["applied", "applied_via", "applied_at"]) {
    it(`la route Vercel porta indietro \`${field}\``, () => {
      expect(route).toContain(field);
    });
    it(`il lettore diretto porta indietro \`${field}\``, () => {
      expect(direct).toContain(field);
    });
  }
});

process.on("exit", () => {
  try {
    db?.close();
  } catch {
    /* gia' chiuso */
  }
  rmSync(home, { recursive: true, force: true });
});
