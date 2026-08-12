import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  likePattern,
  matchesPositionQuery,
  parsePositionQuery,
} from "../../../web/lib/position-search";

/**
 * O-60 — la barra di ricerca delle offerte.
 *
 * «uno strumento di ricerca dove l'utente può immettere nome azienda, ID, ecc.
 * per trovare un'offerta». L'ID è chiesto per nome, ed è il caso più facile da
 * sbagliare: in tabella si legge "JHT-042", nel database è il numero 42.
 *
 * I tre modi in cui una ricerca nasce inutile, tutti e tre misurati sul
 * database dell'operatore prima di scrivere il codice:
 *
 *   1. cercare dentro la pagina. La lista ne mostra 50 per volta su 1567;
 *   2. cercare dentro la VISTA. Il default mostra solo le posizioni con un
 *      punteggio e non escluse: 617 su 1567, il 61% invisibile. Una ricerca
 *      che eredita quel filtro risponde "nessun risultato" su un'offerta che
 *      esiste — una risposta sicura e falsa, peggio della fatica di prima;
 *   3. cercare dopo il tetto. Le faccette hanno un limite di 1000 e con 1567
 *      posizioni quel tetto già morde: è la stessa forma di O-37 e O-40.
 */
const ROOT = resolve(__dirname, "../../..");
const PAGE = readFileSync(
  resolve(ROOT, "web/app/(protected)/positions/page.tsx"),
  "utf-8",
);
const CLOUD = readFileSync(resolve(ROOT, "web/lib/queries.ts"), "utf-8");
const LOCAL = readFileSync(resolve(ROOT, "web/lib/local-queries.ts"), "utf-8");
const DEMO = readFileSync(resolve(ROOT, "web/lib/demo/queries.ts"), "utf-8");
const SHELL = readFileSync(
  resolve(ROOT, "web/app/(protected)/positions/PositionsShell.tsx"),
  "utf-8",
);
const SEARCH_UI = readFileSync(
  resolve(ROOT, "web/app/(protected)/positions/PositionsSearch.tsx"),
  "utf-8",
);
const GAME = readFileSync(
  resolve(ROOT, "game/scripts/ui/global_search.gd"),
  "utf-8",
);
const GAME_RULE = readFileSync(
  resolve(ROOT, "game/scripts/ui/position_search.gd"),
  "utf-8",
);
const GAME_MATRIX = readFileSync(
  resolve(ROOT, "game/tools/test-matrix.txt"),
  "utf-8",
);

const row = (over: Record<string, unknown> = {}) => ({
  legacy_id: 42,
  title: "AI Automations Product Engineer",
  company: "MixRank",
  loc_city: "Milano",
  loc_country: "Italia",
  role_family: "Backend",
  source: "linkedin",
  ...over,
});

describe("l'ID scritto come lo si legge", () => {
  it.each([
    ["42", 42],
    ["JHT-042", 42],
    ["jht-42", 42],
    ["JHT 42", 42],
    ["jht042", 42],
    ["#42", 42],
    ["0042", 42],
  ])("«%s» è la posizione %i", (input, expected) => {
    expect(parsePositionQuery(input).legacyId).toBe(expected);
  });

  it("una parola non è un ID", () => {
    expect(parsePositionQuery("MixRank").legacyId).toBeNull();
    expect(parsePositionQuery("jht").legacyId).toBeNull();
    expect(parsePositionQuery("").legacyId).toBeNull();
  });

  it("l'ID non ESCLUDE il testo: cerca anche come parola", () => {
    // "42" può essere un identificativo o un pezzo di titolo ("Java 42h"):
    // trattarlo solo come id perderebbe il secondo caso in silenzio.
    const q = parsePositionQuery("42");
    expect(matchesPositionQuery(row({ legacy_id: 999 }), q)).toBe(false);
    expect(
      matchesPositionQuery(row({ legacy_id: 999, title: "Java 42h" }), q),
    ).toBe(true);
    expect(matchesPositionQuery(row({ legacy_id: 42 }), q)).toBe(true);
  });
});

describe("su cosa si cerca", () => {
  it("azienda, titolo, città, paese, famiglia e fonte", () => {
    for (const q of [
      "mixrank",
      "automations",
      "milano",
      "italia",
      "backend",
      "linkedin",
    ]) {
      expect(matchesPositionQuery(row(), parsePositionQuery(q)), q).toBe(true);
    }
  });

  it("non guarda il testo TRONCATO, guarda il dato", () => {
    // In tabella il titolo esce come "AI Automations Product Engi…": cercare
    // "Engineer" deve trovarlo lo stesso.
    expect(matchesPositionQuery(row(), parsePositionQuery("engineer"))).toBe(
      true,
    );
  });

  it("una query vuota non filtra niente", () => {
    expect(matchesPositionQuery(row(), parsePositionQuery("   "))).toBe(true);
  });

  it("i jolly di SQL scritti dall'utente restano testo", () => {
    // Senza escape, "50%" cercherebbe "50" seguito da qualsiasi cosa e la
    // ricerca diventerebbe più larga di quanto chiesto, in silenzio.
    expect(likePattern("50%")).toBe("%50\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
  });
});

describe("la ricerca NON eredita la vista", () => {
  it("il default che nasconde il 61% si allenta quando si cerca", () => {
    // Il ramo è lo stesso degli stati espliciti: non è un'eccezione nuova.
    expect(PAGE).toContain("statuses.length || unscored || query");
  });

  it("il testo arriva alla query, non filtra la pagina", () => {
    expect(PAGE).toContain("q: query || undefined");
  });
});

describe("la ricerca scende nel database, in TUTTI i rami", () => {
  it("cloud: prima del limite, non dopo", () => {
    const start = CLOUD.indexOf("export async function getPositions(");
    const pagination = CLOUD.indexOf("fetchPostgrestRows", start);
    const fetchBlock = CLOUD.slice(
      start,
      CLOUD.indexOf("if (error || !data) return [];", pagination),
    );
    expect(fetchBlock).toContain("parsePositionQuery(opts?.q)");
    // L'ordine è la sostanza: ricerca e filtri devono costruire l'universo
    // PRIMA che limit/range ne chiedano una finestra.
    expect(fetchBlock.indexOf("query.or(")).toBeLessThan(
      fetchBlock.indexOf("query.limit(opts.limit)"),
    );
    expect(fetchBlock.indexOf("query.or(")).toBeLessThan(
      fetchBlock.indexOf("fetchPostgrestRows"),
    );
  });

  it("cloud: il valore è quotato, se no una virgola spezza la query", () => {
    expect(CLOUD).toContain('`title.ilike."${like}"`');
    expect(CLOUD).toContain("legacy_id.eq.");
  });

  it("locale: sta nella WHERE", () => {
    expect(LOCAL).toContain("parsePositionQuery(opts?.q)");
    expect(LOCAL).toContain("LIKE ? ESCAPE");
    expect(LOCAL).toContain("COALESCE(p.legacy_id, p.id) = ?");
  });

  it("demo: la stessa funzione, non una copia che diverge", () => {
    expect(DEMO).toContain("matchesPositionQuery");
  });

  it("i rami condividono la regola invece di riscriverla", () => {
    for (const src of [CLOUD, LOCAL, DEMO]) {
      expect(src).toContain("position-search");
    }
  });
});

describe("dove sta il campo", () => {
  it("nella toolbar sopra la tabella, non come colonna", () => {
    expect(SHELL).toContain("<PositionsSearch />");
    // La tabella scorre in orizzontale: una colonna-ricerca scorrerebbe via
    // proprio mentre la si usa.
    const COLUMNS = readFileSync(
      resolve(ROOT, "web/app/(protected)/positions/columns.ts"),
      "utf-8",
    );
    expect(COLUMNS).not.toContain('"search"');
  });

  it("una ricerca nuova riparte da pagina 1", () => {
    // Restare a pagina 7 di un risultato che ne ha due mostra una lista
    // vuota, che si legge come "non trovato".
    expect(SEARCH_UI).toContain('merged.delete("page")');
  });

  it("il campo segue l'URL, non vive per conto suo", () => {
    expect(SEARCH_UI).toContain("useEffect(() => setValue(urlQuery)");
  });

  it("ha etichetta e placeholder in tutte e sette le lingue", () => {
    for (const loc of ["it", "en", "hu", "es", "de", "fr", "pt"]) {
      expect(SEARCH_UI).toMatch(new RegExp(`\\n  ${loc}: \\{`));
    }
  });
});

describe("la stessa ricerca nel gioco", () => {
  it("cerca anche per ID, non solo per titolo e azienda", () => {
    expect(GAME_RULE).toContain("static func parse_id");
    expect(GAME_RULE).toContain("id_hit");
    // La UI non tiene una sua copia della regola: la chiede a quel file.
    expect(GAME).toContain("PositionSearch.filter(BackendBus.positions");
  });

  it("accetta le stesse forme dell'ID del web", () => {
    // Che le due regex si comportino davvero uguale lo dimostra il selftest
    // Godot, che le ESEGUE; qui si tiene fermo che la regola del gioco esista
    // e sia una sola.
    expect(GAME_RULE).toContain("jht[");
    expect(GAME_RULE).toContain("0*([0-9]{1,9})$");
  });

  it("il selftest del gioco gira in CI, non solo sul portatile di chi lo scrive", () => {
    // Un selftest fuori da test-matrix.txt non lo esegue nessun runner: è il
    // modo in cui 15 test su 45 erano rimasti invisibili.
    expect(GAME_MATRIX).toContain("global_search|script|gate");
    expect(GAME_MATRIX).toContain("tools/global_search_selftest.gd");
  });

  it("mostra l'ID nel risultato", () => {
    // Chi cerca "JHT-042" deve vedere il 042 nella riga trovata, se no non
    // sa se è quella giusta.
    expect(GAME).toContain('"JHT-%03d');
  });

  it("il placeholder nomina l'ID in tutte e sette le lingue", () => {
    const files = [
      "game/scripts/ui_strings.gd",
      "game/scripts/i18n/ui_en.gd",
      "game/scripts/i18n/ui_hu.gd",
      "game/scripts/i18n/ui_es.gd",
      "game/scripts/i18n/ui_de.gd",
      "game/scripts/i18n/ui_fr.gd",
      "game/scripts/i18n/ui_pt.gd",
    ];
    for (const f of files) {
      const src = readFileSync(resolve(ROOT, f), "utf-8");
      const line = src
        .split("\n")
        .find((l) => l.includes('"search.placeholder"'));
      expect(line, f).toBeTruthy();
      expect(line!.toLowerCase(), f).toMatch(/id|azonosító/);
    }
  });
});
