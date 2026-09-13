/**
 * L'autorizzazione alla candidatura deve TORNARE A CASA. [JHT-CLOSER]
 *
 * L'operatore sta su una VPS e flagga dalla dashboard web: il click nasce sul
 * cloud. Se non scende al box, il CLOSER non parte mai — e il sintomo non è un
 * errore, è un silenzio: l'utente ha autorizzato, il team non fa niente, e
 * nessuno dei due sa perché. È lo stesso difetto di
 * `[APPLIED-STATE-NEVER-COMES-HOME]` (#186) preso dal verso opposto: là era
 * l'esito a non rientrare, qui è il permesso.
 *
 * Cosa guardano questi test, e cosa no:
 *
 * - la corsia `pull-desired-state` porta a casa il flag **e il suo autore**.
 *   L'autore non è un extra: `shared/skills/apply_gate.py` rifiuta
 *   un'autorizzazione il cui `apply_requested_by` non nomina un canale utente,
 *   quindi una corsia che portasse il booleano e lasciasse indietro il nome
 *   produrrebbe permessi che il box scarta senza dire perché;
 * - il cursore avanza su `apply_requested_at`. È l'unico timestamp che può
 *   cambiare DA SOLO in un tick (l'utente flagga una posizione e basta): fuori
 *   dalla lista dei cursori, quel tick non farebbe avanzare niente e la stessa
 *   finestra tornerebbe per sempre;
 * - le tre colonne sono nominate nelle DUE select gemelle (route Vercel e
 *   lettore diretto) e nella lista del push. Si sono già separate una volta
 *   (#187 aggiunse `response` solo da un lato), quindi il pin è esplicito.
 *
 * Non è provato qui il rifiuto: quello vive in `tests/test_apply_gate.py`, che
 * è dove sta il cancello. Questi test provano che il cancello riceva il dato
 * su cui deve decidere.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const repo = join(__dirname, "../../..");
const dirs: string[] = [];
let previousHome: string | undefined;

/** Lo schema minimo che la corsia tocca: l'ombra del DDL vero, non il DDL. */
const SCHEMA = `
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT,
    last_actor TEXT,
    write_requested INTEGER DEFAULT 0, write_requested_at TEXT,
    write_request_kind TEXT,
    geocode_requested INTEGER DEFAULT 0, geocode_requested_at TEXT,
    recheck_requested INTEGER DEFAULT 0, recheck_requested_at TEXT,
    salary_precise_requested INTEGER DEFAULT 0, salary_precise_requested_at TEXT,
    apply_requested INTEGER DEFAULT 0, apply_requested_at TEXT,
    apply_requested_by TEXT,
    user_excluded_reason TEXT, user_excluded_note TEXT, user_excluded_at TEXT,
    user_excluded_prev_status TEXT
  );
  CREATE TABLE applications (id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE);
  CREATE TABLE position_state_transitions (
    id INTEGER PRIMARY KEY, position_id INTEGER,
    from_state TEXT, to_state TEXT, by_agent TEXT, notes TEXT
  );
`;

function box(cursore?: Record<string, string>) {
  previousHome = process.env.JHT_HOME;
  const home = mkdtempSync(join(tmpdir(), "jht-closer-apply-"));
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
  if (cursore) {
    writeFileSync(
      join(home, ".cloud-pull-cursor.json"),
      JSON.stringify(cursore),
    );
  }
  const dbPath = join(home, "jobs.db");
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  db.exec(
    "INSERT INTO positions (id, title, company, status) " +
      "VALUES (7, 'Backend Engineer', 'Esempio Srl', 'ready')",
  );
  db.close();
  return { home, dbPath };
}

/** Fa girare un pull con una risposta finta e restituisce la riga locale. */
async function pull(
  dbPath: string,
  positions: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            positions,
            applications: [],
            cursor: "2026-09-12T10:00:00.000Z",
            ...extra,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
  const { handlePullDesiredState } = await import(
    "../../../cli/src/commands/cloud.js"
  );
  await handlePullDesiredState({ db: dbPath, silent: true });
  const db = new DatabaseSync(dbPath);
  const row = db
    .prepare(
      "SELECT apply_requested, apply_requested_at, apply_requested_by " +
        "FROM positions WHERE id = 7",
    )
    .get() as Record<string, unknown>;
  db.close();
  return row;
}

const AUTORIZZATA = {
  legacy_id: 7,
  apply_requested: true,
  apply_requested_at: "2026-09-12T09:30:00+00:00",
  apply_requested_by: "user_web",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  if (previousHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = previousHome;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("il permesso deciso sul web arriva al box", () => {
  it("scrive flag, istante e AUTORE", async () => {
    const { dbPath } = box();
    expect(await pull(dbPath, [AUTORIZZATA])).toEqual({
      apply_requested: 1,
      apply_requested_at: "2026-09-12T09:30:00+00:00",
      apply_requested_by: "user_web",
    });
  });

  it("porta l'autore e non solo il flag", async () => {
    // Il caso che un test scritto sul solo booleano lascerebbe passare: la
    // corsia applica `apply_requested = 1` e dimentica CHI. Il gate rifiuta
    // quella riga, il CLOSER non parte, e il log dice «non autorizzata» su una
    // posizione che l'utente ha autorizzato davvero.
    const { dbPath } = box();
    const row = await pull(dbPath, [AUTORIZZATA]);
    expect(
      row.apply_requested_by,
      "il flag e' sceso senza il suo autore: il gate lo scartera'",
    ).toBe("user_web");
  });

  it("porta a casa anche la REVOCA", async () => {
    // Senza il verso opposto, un utente che si pente dal sito mentre il box è
    // fermo si ritroverebbe la candidatura partita al riavvio. È lo stesso
    // motivo per cui il pull filtra largo invece di chiedere solo i flag accesi.
    const { dbPath } = box();
    const db = new DatabaseSync(dbPath);
    db.exec(
      "UPDATE positions SET apply_requested = 1, " +
        "apply_requested_at = '2026-09-12T09:30:00+00:00', " +
        "apply_requested_by = 'user_web' WHERE id = 7",
    );
    db.close();
    expect(
      await pull(dbPath, [
        {
          legacy_id: 7,
          apply_requested: false,
          apply_requested_at: "2026-09-12T09:45:00+00:00",
          apply_requested_by: null,
        },
      ]),
    ).toEqual({
      apply_requested: 0,
      apply_requested_at: "2026-09-12T09:45:00+00:00",
      apply_requested_by: null,
    });
  });

  it("una riga gia' allineata non viene riscritta", async () => {
    // Il pull gira a ogni tick del daemon: riscrivere una riga identica
    // fa scattare il trigger su `updated_at` e rimette la stessa riga nel
    // delta del push successivo, all'infinito.
    const { dbPath } = box();
    await pull(dbPath, [AUTORIZZATA]);
    // `vi.spyOn` su un metodo gia' spiato restituisce LO STESSO mock, quindi
    // senza questo azzeramento le righe del primo pull finirebbero nel
    // conteggio del secondo e il test passerebbe misurando il giro sbagliato.
    const spia = vi.spyOn(console, "log").mockImplementation(() => {});
    spia.mockClear();
    await pull(dbPath, [AUTORIZZATA]);
    const righe = spia.mock.calls.map((c) => String(c[0])).join("\n");
    expect(righe, righe).not.toMatch(/1 positions updated/);
  });
});

describe("il cursore avanza sul solo permesso", () => {
  // ⚠️ Questo blocco DEVE passare dal lettore diretto, non dalla route Vercel.
  // Il massimo fra i timestamp lo calcola il client solo su quel ramo; sul
  // ramo Vercel il cursore arriva già fatto dal server (`body.cursor`). Un
  // test scritto sul ramo Vercel resterebbe verde anche togliendo
  // `apply_requested_at` dalla lista — cioè misurerebbe il finto server invece
  // del codice, ed è esattamente com'era scritto la prima volta.
  it("un tick in cui e' cambiato SOLO apply_requested_at fa avanzare il cursore", async () => {
    const { home, dbPath } = box({ since: "2026-09-11T00:00:00.000Z" });
    const precedente = process.env.JHT_SUPABASE_DIRECT;
    process.env.JHT_SUPABASE_DIRECT = "1";
    writeFileSync(
      join(home, "cloud.json"),
      JSON.stringify({
        enabled: true,
        base_url: "https://cloud.example.test",
        token: "jht_sync_synthetic-test-token",
        supabase_url: "https://example.supabase.co",
        supabase_anon_key: "anon",
        supabase_refresh_token: "refresh",
        user_id: "synthetic-test-user",
      }),
    );
    try {
      vi.stubGlobal("fetch", async (url: unknown) => {
        const u = String(url);
        const rispondi = (rows: unknown) => ({
          ok: true,
          status: 200,
          json: async () => rows,
        });
        if (u.includes("/auth/v1/token")) {
          return rispondi({ access_token: "tok", expires_in: 3600 });
        }
        if (u.includes("/rest/v1/positions")) return rispondi([AUTORIZZATA]);
        return rispondi([]);
      });
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.resetModules();
      const { handlePullDesiredState } = await import(
        "../../../cli/src/commands/cloud.js"
      );
      await handlePullDesiredState({ db: dbPath, silent: true });
      const cursore = JSON.parse(
        readFileSync(join(home, ".cloud-pull-cursor.json"), "utf-8"),
      );
      expect(
        cursore.since,
        "il cursore non e' avanzato: la stessa finestra tornera' a ogni tick",
      ).toBe("2026-09-12T09:30:00+00:00");
    } finally {
      if (precedente === undefined) delete process.env.JHT_SUPABASE_DIRECT;
      else process.env.JHT_SUPABASE_DIRECT = precedente;
    }
  });
});

describe("la risposta al form vale come nuova autorizzazione", () => {
  it("aggiorna reply, autore e istante nella stessa transazione locale", async () => {
    const { home, dbPath } = box();
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE pending_user_messages (
        id INTEGER PRIMARY KEY, agent TEXT, body TEXT, kind TEXT,
        related_position_id INTEGER, source_action TEXT, source_payload TEXT,
        user_reply TEXT, user_reply_at TEXT, acknowledged_at TEXT
      );
      INSERT INTO pending_user_messages (
        id, agent, body, kind, related_position_id, source_action, source_payload
      ) VALUES (
        3, 'closer', 'Fixture question', 'question', 7,
        'closer_application_answer',
        '{"version":1,"position_id":7,"key":"work_mode","label":"Work mode?","field_type":"radio","options":["Remote","Hybrid"]}'
      );
      UPDATE positions SET apply_requested = 1,
        apply_requested_at = '2026-09-12T09:00:00.000Z',
        apply_requested_by = 'user_web' WHERE id = 7;
    `);
    db.close();
    vi.resetModules();
    const { replyPendingMessageLocal } = await import(
      "../../../web/lib/pending-message-reply-local"
    );

    expect(replyPendingMessageLocal("3", "Remote")).toBe(true);

    const observed = new DatabaseSync(dbPath);
    const row = observed
      .prepare(
        `SELECT m.user_reply, m.user_reply_at, p.apply_requested,
                p.apply_requested_at, p.apply_requested_by
           FROM pending_user_messages m
           JOIN positions p ON p.id = m.related_position_id
          WHERE m.id = 3`,
      )
      .get() as Record<string, unknown>;
    observed.close();
    expect(row.user_reply).toBe("Remote");
    expect(row.user_reply_at).toBe(row.apply_requested_at);
    expect(row.apply_requested).toBe(1);
    expect(row.apply_requested_by).toBe("user_local");
    expect(Date.parse(String(row.apply_requested_at))).toBeGreaterThan(
      Date.parse("2026-09-12T09:00:00.000Z"),
    );
  });

  it("rifiuta una scelta non esatta senza consumare risposta o permesso", async () => {
    const { dbPath } = box();
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE pending_user_messages (
        id INTEGER PRIMARY KEY, agent TEXT, body TEXT, kind TEXT,
        related_position_id INTEGER, source_action TEXT, source_payload TEXT,
        user_reply TEXT, user_reply_at TEXT, acknowledged_at TEXT
      );
      INSERT INTO pending_user_messages (
        id, agent, body, kind, related_position_id, source_action, source_payload
      ) VALUES (
        5, 'closer', 'Fixture question', 'question', 7,
        'closer_application_answer',
        '{"version":1,"position_id":7,"key":"work_mode","label":"Work mode?","field_type":"radio","options":["Remote","Hybrid"]}'
      );
    `);
    db.close();
    vi.resetModules();
    const { replyPendingMessageLocal } = await import(
      "../../../web/lib/pending-message-reply-local"
    );

    expect(() => replyPendingMessageLocal("5", "remote")).toThrow(
      "closer_answer_not_exact_option",
    );

    const observed = new DatabaseSync(dbPath);
    const row = observed
      .prepare(
        `SELECT m.user_reply, p.apply_requested, p.apply_requested_at
           FROM pending_user_messages m
           JOIN positions p ON p.id = m.related_position_id
          WHERE m.id = 5`,
      )
      .get() as Record<string, unknown>;
    observed.close();
    expect(row).toEqual({
      user_reply: null,
      apply_requested: 0,
      apply_requested_at: null,
    });
  });

  it("il path cloud registra lo stesso permesso come user_web", () => {
    const src = leggi("web/app/api/pending-messages/[id]/reply/route.ts");
    expect(src).toContain('apply_requested_by: "user_web"');
    expect(src).toContain("application_reauthorisation_not_observed");
  });

  it("una normale risposta in chat non autorizza candidature", async () => {
    const { home, dbPath } = box();
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE pending_user_messages (
        id INTEGER PRIMARY KEY, agent TEXT, body TEXT, kind TEXT,
        related_position_id INTEGER, source_action TEXT, source_payload TEXT,
        user_reply TEXT, user_reply_at TEXT, acknowledged_at TEXT
      );
      INSERT INTO pending_user_messages (
        id, agent, body, kind, related_position_id
      ) VALUES (4, 'assistente', 'Fixture chat', 'question', 7);
    `);
    db.close();
    vi.resetModules();
    const { replyPendingMessageLocal } = await import(
      "../../../web/lib/pending-message-reply-local"
    );

    expect(replyPendingMessageLocal("4", "Va bene")).toBe(true);

    const observed = new DatabaseSync(dbPath);
    const position = observed
      .prepare(
        "SELECT apply_requested, apply_requested_at, apply_requested_by " +
          "FROM positions WHERE id = 7",
      )
      .get() as Record<string, unknown>;
    observed.close();
    expect(position).toEqual({
      apply_requested: 0,
      apply_requested_at: null,
      apply_requested_by: null,
    });
  });
});

// ── I pin sulle sorgenti ─────────────────────────────────────────────────────
//
// Le due select desired-state sono GEMELLE (la route Vercel e il lettore
// diretto) e si sono gia' separate una volta. Un test che esercitasse solo la
// strada percorsa dal finto server non si accorgerebbe della divergenza: la
// domanda giusta e' «tutte e due la nominano?», e si pone alla sorgente.

const leggi = (p: string) => readFileSync(join(repo, p), "utf-8");

describe("le tre colonne sono nominate ovunque servano", () => {
  it("la select del lettore diretto le chiede", () => {
    const src = leggi("cli/src/lib/supabase-direct.js");
    for (const col of [
      "apply_requested",
      "apply_requested_at",
      "apply_requested_by",
    ]) {
      expect(src, `supabase-direct non chiede ${col}`).toContain(col);
    }
  });

  it("il lettore diretto filtra anche su apply_requested_at", () => {
    // Senza questo termine nell'OR, una posizione flaggata e basta non
    // rientrerebbe MAI nella finestra del pull diretto.
    expect(leggi("cli/src/lib/supabase-direct.js")).toContain(
      "apply_requested_at.gt.",
    );
  });

  it("la select gemella sulla route Vercel le chiede", () => {
    const src = leggi("web/app/api/cloud-sync/pull-desired-state/route.ts");
    expect(src).toContain(
      "apply_requested, apply_requested_at, apply_requested_by",
    );
  });

  it("il push le manda su", () => {
    const cli = leggi("cli/src/commands/cloud.js");
    expect(cli).toContain("'apply_requested', 'apply_requested_at', 'apply_requested_by'");
    const route = leggi("web/app/api/cloud-sync/push/route.ts");
    expect(route).toContain("apply_requested_by: p.apply_requested_by ?? null");
  });

  it("il push tollera un jobs.db che non ha ancora la colonna", () => {
    // Regola B01: nominarla senza guardia farebbe fallire la SELECT, cioe'
    // l'INTERO push di un box appena aggiornato — non solo questo flag.
    expect(leggi("cli/src/commands/cloud.js")).toContain(
      "sqliteHasColumn(db, 'positions', 'apply_requested')",
    );
  });

  it("la route che accende il flag scrive sempre l'autore", () => {
    const src = leggi(
      "web/app/api/positions/[legacyId]/apply-request/route.ts",
    );
    expect(src).toContain("apply_requested_by");
    // Il vocabolario e' quello che il gate accetta, e nient'altro.
    expect(src).toContain('"user_web"');
    expect(src).toContain('"user_local"');
    expect(src).not.toContain("agent_closer");
  });

  it("la route autorizza solo una posizione ready", () => {
    // Autorizzare prima di `ready` significa autorizzare l'invio di un CV che
    // non e' ancora stato scritto.
    const src = leggi(
      "web/app/api/positions/[legacyId]/apply-request/route.ts",
    );
    expect(src).toContain('const AUTHORISABLE_STATUS = "ready"');
    // La guardia deve stare su ENTRAMBI i rami: quello locale e quello
    // cloud-only, che e' proprio quello dell'operatore su VPS.
    expect(src.match(/AUTHORISABLE_STATUS/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
