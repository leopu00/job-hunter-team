/**
 * Test unitari — la nota privata e la seconda chiave (vitest)
 *
 * O-33 ha cambiato la chiave di `position_user_notes` da `(position_id)` a
 * `(position_id, origin)`, perché quando la stessa nota diverge fra box e sito
 * si tengono ENTRAMBI i testi. Il cambio di chiave non rompe niente a
 * compile-time: rompe a runtime, e in due modi che nessun test funzionale
 * esistente vedeva.
 *
 * 1. `ON CONFLICT(position_id)` su una tabella la cui chiave è composta non è
 *    un upsert che si comporta male, è `OperationalError: ON CONFLICT clause
 *    does not match any PRIMARY KEY or UNIQUE constraint`. Salvare una nota dal
 *    sito lanciava 500. È già successo: il ramo che portava O-33 era marcato
 *    NOT FOR MERGE proprio per questo, ed è finito in master comunque.
 *
 * 2. Una SELECT senza `WHERE origin = ...` torna una riga QUALSIASI fra le due
 *    che la nuova chiave permette — scelta dall'ordine fisico della tabella.
 *    La pagina mostrerebbe la nota dell'altra superficie e il salvataggio
 *    sembrerebbe non aver fatto niente.
 *
 * La semantica SQLite è già provata in Python (tests/test_note_origin_migration
 * .py, tests/test_position_user_notes.py). Quello che nessuno guardava sono i
 * SORGENTI TypeScript, che parlano con la stessa tabella da un altro
 * linguaggio: qui si asserisce su quelli. Un writer nuovo aggiunto senza
 * pensare a `origin` non farebbe fallire nessun test funzionale — scriverebbe
 * soltanto nella riga sbagliata, in silenzio.
 *
 * O-33 (seconda metà) ha aggiunto la casa cloud — `public.position_user_notes`,
 * mig 069 — e quindi un writer e un lettore nuovi, che la scansione qui sotto
 * raccoglie da sola. La tabella cloud HA `origin`, in chiave, benché oggi ci
 * scriva solo il sito: la colonna non è lì per il presente ma perché i due
 * pezzi che restano (un mirror box→cloud e il ritorno delle righe 'web' nel box
 * via `jht cloud restore`) porterebbero lì la seconda superficie, e allora la
 * chiave andrebbe cambiata su una tabella che nel frattempo contiene le note di
 * qualcuno. Averla dal primo giorno costa una colonna e una riga di filtro.
 * Conseguenza per questi test: la regola «chi nomina la tabella nomina anche
 * origin» vale su TUTTE E DUE le sponde, senza eccezioni da spiegare.
 *
 * Il comportamento del ramo cloud (upsert, delete, 404) sta in
 * tests/js/tasks/user-note-cloud.test.ts: qui si guardano i sorgenti, là si
 * esegue il codice.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = join(__dirname, "../../..");
const WEB = join(REPO, "web");
const TABLE = "position_user_notes";

const SKIP = new Set([
  "node_modules",
  ".next",
  "public",
  "out",
  "coverage",
  ".turbo",
]);

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

/** I file del web che toccano la tabella, qualunque siano. Deliberatamente
 * scoperti scandendo l'albero e non elencati a mano: un elenco a mano non si
 * accorge del file aggiunto domani, che è il caso da proteggere.
 *
 * Scansione UNA volta, e al caricamento del modulo: leggere 571 file costa
 * ~1,7s a macchina scarica, e con la suite intera in parallelo su Windows
 * sfondava il timeout di 5s del singolo test — tre volte, una per test. Un
 * test che diventa rosso per contesa di disco insegna soltanto a non fidarsi
 * dei rossi. Qui il costo si paga in collection, che non ha quel budget, e
 * l'albero non cambia mentre la suite gira. */
const TOUCHING: { path: string; body: string }[] = sources(WEB)
  .map((path) => ({ path, body: readFileSync(path, "utf-8") }))
  .filter(({ body }) => body.includes(TABLE));

function filesTouchingTheTable(): { path: string; body: string }[] {
  return TOUCHING;
}

describe("nota privata — nessuno tocca la tabella ignorando `origin`", () => {
  it("trova davvero dei file, altrimenti il test non sta provando niente", () => {
    // Senza questa asserzione un refactor che rinomina la tabella renderebbe
    // tutti i test qui sotto verdi su un insieme vuoto.
    expect(filesTouchingTheTable().length).toBeGreaterThan(0);
  });

  it("ogni file che nomina la tabella nomina anche `origin`", () => {
    const unaware = filesTouchingTheTable()
      .filter(({ body }) => !body.includes("origin"))
      .map(({ path }) => relative(REPO, path));
    expect(unaware).toEqual([]);
  });
});

describe("la route che scrive la nota", () => {
  const ROUTE = join(
    WEB,
    "app/api/positions/[legacyId]/user-note/route.ts",
  );
  const body = () => readFileSync(ROUTE, "utf-8");

  it("non fa nascere la tabella nella forma pre-O-33", () => {
    // `ensureTable` è un CREATE IF NOT EXISTS che gira su un jobs.db qualsiasi:
    // se dichiarasse ancora `position_id INTEGER PRIMARY KEY` la route creerebbe
    // la forma vecchia su un DB nuovo, e la migrazione del box dovrebbe poi
    // ricrearla — con dentro le note di qualcuno.
    const ddl = body();
    expect(ddl).toContain("PRIMARY KEY (position_id, origin)");
    expect(ddl).not.toMatch(/position_id\s+INTEGER\s+PRIMARY\s+KEY/);
  });

  it("l'upsert nella forma nuova dichiara il conflitto sulla chiave completa", () => {
    expect(body()).toContain("ON CONFLICT(position_id, origin)");
  });

  it("guarda com'è fatta la tabella invece di dare per scontata la forma nuova", () => {
    // Fra l'aggiornamento del codice e il primo giro delle migrazioni del box
    // c'è una finestra reale in cui la colonna non esiste ancora: è la finestra
    // in cui O-16 ha già fatto perdere a un utente quello che aveva scritto.
    // Chi scrive deve accorgersene, non presumere.
    expect(body()).toContain("PRAGMA table_info(position_user_notes)");
  });
});

describe("il ramo cloud della route (O-33)", () => {
  const ROUTE = join(WEB, "app/api/positions/[legacyId]/user-note/route.ts");
  const body = () => readFileSync(ROUTE, "utf-8");

  it("dichiara il conflitto sulla chiave completa anche sul cloud", () => {
    // Su Postgres `onConflict` su una coppia che non ha un vincolo unico non è
    // un upsert impreciso: è un errore della query. Stesso difetto del
    // `ON CONFLICT(position_id)` su SQLite, un linguaggio più in là.
    expect(body()).toContain('onConflict: "user_id,position_id,origin"');
  });

  it("le due superfici hanno due costanti, e il cloud usa la sua", () => {
    const src = body();
    expect(src).toContain('const ORIGIN_BOX = "box"');
    expect(src).toContain('const ORIGIN_WEB = "web"');
    // Il ramo local scrive 'box' anche quando l'utente sta usando il sito: a
    // box acceso è SQLite la source of truth, e marcare 'web' renderebbe la
    // nota del box non più editabile da qui.
    expect(src).toContain("ORIGIN_BOX, body)");
    expect(src).toContain("origin: ORIGIN_WEB");
  });

  it("cancella solo la riga della propria superficie", () => {
    // Cancellare la riga 'box' dal sito sarebbe cancellare un testo che
    // l'utente non ha davanti agli occhi.
    expect(body()).toContain('.eq("origin", ORIGIN_WEB)');
  });

  it("non racconta più un rilascio che deve arrivare", () => {
    const src = body();
    expect(src).not.toContain("prossimo aggiornamento");
    // Il 503 di questo ramo non esiste più: a box spento c'è dove scrivere.
    expect(src).not.toContain("status: 503");
  });
});

describe("il lettore cloud della nota", () => {
  const QUERIES = join(WEB, "lib/queries.ts");
  const body = () => readFileSync(QUERIES, "utf-8");

  it("popola userNote anche nel percorso Supabase", () => {
    // Il difetto che questo test previene è esattamente lo stato pre-O-33:
    // `userNote` era nel tipo di ritorno ma nessuno lo riempiva sul ramo
    // cloud, quindi a box spento il pannello si apriva SEMPRE vuoto — anche
    // dopo un salvataggio andato a buon fine.
    const src = body();
    expect(src).toContain('.from("position_user_notes")');
    expect(src).toContain("userNote:");
  });

  it("filtra sulla superficie da cui legge", () => {
    expect(body()).toContain('.eq("origin", "web")');
  });
});

describe("la migration cloud (069)", () => {
  const MIG = join(
    REPO,
    "supabase/migrations/069_position_user_notes.sql",
  );
  const body = () => readFileSync(MIG, "utf-8");

  it("mette origin in chiave, come il lato box", () => {
    const sql = body();
    expect(sql).toContain("primary key (user_id, position_id, origin)");
    expect(sql).toMatch(/check \(origin in \('box', 'web'\)\)/);
  });

  it("cancella con l'utente e con la posizione", () => {
    const sql = body();
    expect(sql).toContain("references auth.users(id) on delete cascade");
    expect(sql).toContain("references public.positions(id) on delete cascade");
  });

  it("ha RLS e le quattro policy own, update compresa", () => {
    const sql = body();
    expect(sql).toContain("enable row level security");
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(sql).toContain(`position_user_notes_${op}_own`);
    }
    // Un upsert ha bisogno sia di insert sia di update: con tre policy su
    // quattro la prima riscrittura fallirebbe, non la prima scrittura.
    expect(sql).toContain("for update to public using");
  });

  it("usa la forma init-plan delle policy (mig 053)", () => {
    // `auth.uid()` nudo viene ri-valutato per ogni riga.
    const sql = body();
    expect(sql).toContain("(select auth.uid()) = user_id");
    expect(sql).not.toMatch(/[^(]auth\.uid\(\) = user_id/);
  });

  it("è idempotente", () => {
    const sql = body();
    expect(sql).toContain("create table if not exists");
    expect(sql).toContain("create index if not exists");
    expect((sql.match(/drop policy if exists/g) ?? []).length).toBe(4);
    expect(sql).toContain("drop trigger if exists");
  });
});

describe("la pagina che legge la nota", () => {
  const QUERIES = join(WEB, "lib/local-queries.ts");
  const body = () => readFileSync(QUERIES, "utf-8");

  it("filtra sulla superficie da cui legge", () => {
    expect(body()).toContain("origin = 'box'");
  });

  it("sa leggere anche un jobs.db non ancora migrato", () => {
    // Il fallback senza filtro non è difensivismo: senza di lui la query
    // filtrata solleverebbe sulla forma vecchia e un `catch` che torna `null`
    // farebbe SPARIRE dalla pagina una nota che c'è.
    const src = body();
    const start = src.indexOf("function readUserNote");
    expect(start).toBeGreaterThan(-1);
    const fn = src.slice(start, src.indexOf("\n}", start));
    expect(fn).toContain("origin = 'box'");
    expect(fn).toMatch(/WHERE position_id = \?"/);
  });
});

describe("i messaggi che O-33 rende falsi", () => {
  const UI = join(WEB, "app/(protected)/positions/[id]/UserNote.tsx");
  const body = () => readFileSync(UI, "utf-8");

  /** Solo la tabella delle traduzioni, non tutto il file: il commento in testa
   *  CITA di proposito le tre versioni sbagliate del messaggio, ed è la memoria
   *  di come è andata. Cercare le frasi vecchie nel file intero renderebbe
   *  rosso quel commento e la lezione verrebbe cancellata per far passare un
   *  test. Ciò che deve essere vero è quello che l'utente LEGGE. */
  function translations(): string {
    const src = body();
    const start = src.indexOf("const T:");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n};", start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  /** Le sette lingue, con il pezzo di frase che prometteva le note come
   *  funzione futura. Una traduzione dimenticata è il modo tipico in cui un
   *  messaggio sopravvive al mondo che descriveva: il testo italiano si
   *  aggiorna perché è quello che si rilegge, il resto continua a mentire in
   *  una lingua che chi rilascia non guarda. */
  const STALE = [
    "prossimo aggiornamento",
    "next update",
    "próxima actualización",
    "nächsten Update",
    "prochaine mise à jour",
    "próxima atualização",
    "következő frissítéssel",
  ];

  it("nessuna lingua promette ancora le note come funzione futura", () => {
    const t = translations();
    expect(STALE.filter((s) => t.includes(s))).toEqual([]);
  });

  it("tutte e sette dicono la causa che RESTA", () => {
    // 7 lingue + la dichiarazione di tipo = 8 occorrenze della chiave. Il
    // conteggio è la parte che si accorge della lingua saltata.
    const t = translations();
    expect((t.match(/noLocalDb/g) ?? []).length).toBe(8);
    // La vecchia chiave si chiamava `offline` dal mondo «box spento = niente
    // note», che è proprio il mondo che O-33 ha chiuso.
    expect(t).not.toContain("offline");
  });

  it("il ramo 503 non viene cancellato, perché una causa resta", () => {
    // Dopo O-33 quella fetch può ancora dare 503, per «DB locale assente»
    // dentro localFirstWrite (percorso local-token, desktop nativo). Togliere
    // il ramo trasformerebbe una causa nota in un errore generico.
    const src = body();
    expect(src).toContain("res.status === 503 ? t.noLocalDb : t.error");
  });
});
