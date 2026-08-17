/**
 * `--full` deve poter tornare indietro davvero.
 *
 * Il difetto, misurato da @vps il 17/08: quattro candidature (165, 1162, 1467,
 * 1553, `applied_at` del 10 e 12/08) non sono MAI tornate alla macchina, e ha
 * dovuto allinearle a mano. La causa non è il cursore che avanza — quello è il
 * suo mestiere — ma il fatto che l'unico modo di ignorarlo non serve a niente:
 *
 *   `--full` azzera il cursore LOCALE, ma la finestra è dell'ALTRO LATO.
 *
 * Senza `applied_since` il server applica il suo lookback di 7 giorni fissi
 * (`DEFAULT_LOOKBACK_MS` in `pull-desired-state/route.ts`), e sul percorso
 * Supabase-diretto ci ricade il client con la stessa costante scritta in
 * chiaro. Le due strade sbagliano allo stesso modo per due motivi diversi:
 * qualunque riga più vecchia di una settimana è irraggiungibile, e per
 * l'operatore non esiste comando che la raggiunga.
 *
 * ⚠️ Il perimetro è la corsia delle CANDIDATURE. I flag posizione e le reply
 * hanno lo stesso pavimento a 7 giorni, ma la loro paginazione (`has_more` per
 * le posizioni, nessuna per le reply) è una domanda aperta che non si risolve
 * di straforo dentro questa riparazione — sta scritta nella consegna, non
 * lasciata al prossimo che la scopre.
 *
 * I test guardano l'URL che il comando compone, non il database: il difetto è
 * NELLA DOMANDA che il box fa al server, e una prova che passasse per le righe
 * restituite misurerebbe il finto server che ho scritto io.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const dirs: string[] = [];
let previousHome: string | undefined;

const GIORNO_MS = 24 * 60 * 60 * 1000;
const PAVIMENTO_MS = 7 * GIORNO_MS;

/** Il minimo indispensabile perché il comando arrivi alla fetch. */
function box(cursore?: Record<string, string>) {
  previousHome = process.env.JHT_HOME;
  const home = mkdtempSync(join(tmpdir(), "jht-full-lookback-"));
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
  db.exec(
    "CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT);" +
      "CREATE TABLE applications (id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE);",
  );
  db.close();
  return { home, dbPath };
}

/** Esegue un pull e restituisce l'URL interrogato. */
async function urlDelPull(dbPath: string, options: Record<string, unknown>) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({ ok: true, positions: [], applications: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
  const { handlePullDesiredState } =
    await import("../../../cli/src/commands/cloud.js");
  await handlePullDesiredState({ db: dbPath, silent: true, ...options });
  expect(
    urls.length,
    "il comando non ha interrogato il server",
  ).toBeGreaterThan(0);
  return new URL(urls[0]);
}

/** Esegue un pull e restituisce il cursore rimasto su disco. */
async function cursoreDopoIlPull(
  home: string,
  dbPath: string,
  options: Record<string, unknown>,
  risposta: Record<string, unknown> = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            positions: [],
            applications: [],
            ...risposta,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
  const { handlePullDesiredState } =
    await import("../../../cli/src/commands/cloud.js");
  await handlePullDesiredState({ db: dbPath, silent: true, ...options });
  return JSON.parse(
    readFileSync(join(home, ".cloud-pull-cursor.json"), "utf-8"),
  );
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

describe("--full raggiunge le candidature più vecchie della finestra", () => {
  it("chiede esplicitamente un `applied_since` che sfonda il pavimento dei 7 giorni", async () => {
    const url = await urlDelPull(box().dbPath, { full: true });

    const chiesto = url.searchParams.get("applied_since");
    // Prova POSITIVA: il parametro c'è e lo si legge. Prima della correzione
    // `--full` non lo mandava affatto, e l'assenza faceva scattare il default
    // del server — un difetto che nessuna riga di log rivelava.
    expect(chiesto, "`--full` non ha chiesto nessuna finestra").toBeTruthy();
    const istante = Date.parse(chiesto as string);
    expect(Number.isNaN(istante)).toBe(false);
    expect(
      istante,
      "la finestra di `--full` sta ancora dentro il lookback del server",
    ).toBeLessThan(Date.now() - PAVIMENTO_MS);
  });

  it("arriva prima delle quattro righe che @vps ha dovuto allineare a mano", async () => {
    const url = await urlDelPull(box().dbPath, { full: true });

    // Le loro `applied_at` sono del 10 e 12/08. Il test non ci mette una data
    // fissa — invecchierebbe e diventerebbe verde per il calendario, non per
    // il codice — ma pretende che la finestra copra un mese, che è l'ordine di
    // grandezza del caso vero.
    const istante = Date.parse(url.searchParams.get("applied_since") as string);
    expect(istante).toBeLessThan(Date.now() - 30 * GIORNO_MS);
  });

  it("ignora il cursore anche quando c'è, che è cosa vuol dire `--full`", async () => {
    const ieri = new Date(Date.now() - GIORNO_MS).toISOString();
    const url = await urlDelPull(box({ applied_since: ieri }).dbPath, {
      full: true,
    });

    const istante = Date.parse(url.searchParams.get("applied_since") as string);
    expect(istante).toBeLessThan(Date.parse(ieri));
  });
});

describe("la clausola falsa: senza `--full` niente cambia", () => {
  // Il pavimento dei 7 giorni non è un difetto in sé: protegge la PRIMA
  // sincronizzazione assoluta da una scansione dell'intera tabella. Toglierlo
  // per tutti sarebbe riparare il sintomo rompendo la ragione. Se questo test
  // diventasse verde per caso — cioè se `--full` finisse per valere sempre —
  // la riparazione avrebbe mangiato la protezione senza che nessuno lo dica.
  it("un pull normale senza cursore non chiede nessuna finestra: decide il server", async () => {
    const url = await urlDelPull(box().dbPath, {});

    expect(url.searchParams.get("applied_since")).toBeNull();
  });

  // L'effetto collaterale che questa riparazione poteva introdurre, e che
  // sarebbe stato peggio del difetto: se la finestra allargata finisse nel
  // cursore SALVATO, dopo un `--full` a vuoto il box ricomincerebbe dall'epoca
  // a ogni tick del daemon, per sempre. Il cursore è una memoria di dove si è
  // arrivati; `--full` è una domanda, non un ricordo.
  it("dopo un `--full` a vuoto il cursore salvato non arretra", async () => {
    const ieri = new Date(Date.now() - GIORNO_MS).toISOString();
    const { home, dbPath } = box({ applied_since: ieri });

    const salvato = await cursoreDopoIlPull(
      home,
      dbPath,
      { full: true },
      // Il server fa eco alla finestra che gli abbiamo chiesto quando non ha
      // righe da dare: è proprio da lì che l'epoca entrerebbe nel cursore.
      { applied_cursor: "1970-01-01T00:00:00.000Z" },
    );

    expect(salvato.applied_since).toBe(ieri);
  });

  it("un pull normale con cursore chiede esattamente il cursore", async () => {
    const ieri = new Date(Date.now() - GIORNO_MS).toISOString();
    const url = await urlDelPull(box({ applied_since: ieri }).dbPath, {});

    expect(url.searchParams.get("applied_since")).toBe(ieri);
  });
});
