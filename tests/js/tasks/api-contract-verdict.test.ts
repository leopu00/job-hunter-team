/**
 * [JHT-TEAM-API-BOUNDARY] Il cancello di protocollo dell'API del team.
 *
 * `shared/api/contract.js` è il file che ogni altro pezzo della fetta
 * importa: il handler ne prende le rotte e la tabella degli errori, il client
 * del CLI ne prende il verdetto. Un difetto qui non si vede come un difetto
 * qui — si vede come «il team non risponde» in quattro punti diversi.
 *
 * Il modo di sbagliare da temere non è il rifiuto: è l'ACCORDO INVENTATO.
 * `[CHAT-LANE-SILENT-DROP-ON-OLD-CLIENT]` è già capitato una volta, e la sua
 * forma è sempre la stessa — due lati che non parlano la stessa lingua e
 * nessuno dei due che se ne accorge. Perciò quasi tutto quello che segue
 * presidia il verso del dubbio: quando un intero non si legge, il verdetto
 * deve essere un NO con un nome, mai un `ok` silenzioso.
 *
 * Nota su cosa NON copre il censimento: il gate
 * `tests/test_shared_backend_english.py` legge, per i file JS, soltanto le
 * stringhe dentro `console.*`, `throw new Error(...)` e `.description(...)`
 * (`scripts/analysis/backend_copy_census.py`). `ERROR_CODES` è una mappa di
 * oggetti e non passa da nessuno di quei sink: la rete che tiene inglesi le
 * frasi dell'API è qui sotto, non lì.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_CONTRACT,
  API_CONTRACT_SUPPORTED,
  CAPABILITIES,
  CLIENT_HEADER,
  CONTRACT_HEADER,
  ERROR_CODES,
  ROUTES,
  contractVerdict,
  fail,
  ok,
} from "../../../shared/api/contract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const CONTRACT_FILE = path.join(ROOT, "shared", "api", "contract.js");
const CONTRACT_SRC = readFileSync(CONTRACT_FILE, "utf8");

/** Il verdetto letto senza far litigare TypeScript sull'unione. */
type Refusal = { ok: boolean; code?: string; status?: number; message?: string };

function verdict(input: Record<string, unknown>): Refusal {
  return contractVerdict(input as never) as Refusal;
}

/** Gli unici stati che un disaccordo di contratto può produrre. */
const REFUSAL_STATUSES = [400, 409, 426];

// ── Le costanti ────────────────────────────────────────────────────────────

describe("le costanti del contratto", () => {
  it("il contratto è un intero, non una versione semver", () => {
    expect(
      Number.isInteger(API_CONTRACT),
      "API_CONTRACT in shared/api/contract.js deve restare un intero: il " +
        "cancello confronta due numeri, e una stringa 'X.Y.Z' passerebbe da " +
        "readContract come malformata",
    ).toBe(true);
    expect(API_CONTRACT).toBeGreaterThan(0);
  });

  it("API_CONTRACT_SUPPORTED è ancora esattamente [API_CONTRACT]", () => {
    // Questo è il seme della finestra di transizione, e questo test è il
    // punto in cui la decisione di aprirla passa da una persona: allargare
    // la lista NON basta a servire un contratto diverso, perché
    // `contractVerdict` confronta con `serverContract` e il handler risponde
    // sempre `X-JHT-Api-Contract: API_CONTRACT`. Chi la allarga deve
    // decidere prima cosa vuol dire servire due forme di payload.
    expect(
      [...API_CONTRACT_SUPPORTED],
      "API_CONTRACT_SUPPORTED è stata allargata: in fase 1 il cancello è a " +
        "corrispondenza esatta, quindi va deciso (e scritto nell'ADR 0009) " +
        "cosa serve il server per ogni intero elencato, e va aggiornato " +
        "contractVerdict in shared/api/contract.js prima di cambiare questa " +
        "lista",
    ).toEqual([API_CONTRACT]);
  });

  it("i nomi degli header sono in minuscolo, come li consegna Node", () => {
    // `req.headers` arriva già in minuscolo: una costante in maiuscolo
    // renderebbe la lettura sempre `undefined`, cioè un 400 su ogni
    // richiesta legittima.
    expect(
      CONTRACT_HEADER,
      "CONTRACT_HEADER deve restare minuscolo: req.headers di Node ha le " +
        "chiavi in minuscolo e il handler legge headers[CONTRACT_HEADER]",
    ).toBe(CONTRACT_HEADER.toLowerCase());
    expect(CLIENT_HEADER).toBe(CLIENT_HEADER.toLowerCase());
    expect(CONTRACT_HEADER).toBe("x-jht-api-contract");
    expect(CLIENT_HEADER).toBe("x-jht-client");
  });

  it("le rotte sono cinque, nell'ordine e con la forma congelata", () => {
    expect(
      ROUTES.map((r) => `${r.method} ${r.path} ${r.name} ${r.contractRequired}`),
      "l'elenco ROUTES è cambiato: è la fonte unica del router in " +
        "cli/src/lib/api/handler.js, di GET /version e del ciclo che " +
        "pretende il Bearer su ogni rotta — aggiorna insieme la sezione " +
        "«Routes» dell'ADR 0009 e i guard test",
    ).toEqual([
      "GET /version version false",
      "GET /v1/team/status teamStatus true",
      "GET /v1/positions positions true",
      "GET /v1/positions/:id position true",
      "GET /v1/dashboard dashboard true",
    ]);
  });

  it("solo /version è esente dall'header del contratto", () => {
    const exempt = ROUTES.filter((r) => !r.contractRequired).map((r) => r.path);
    expect(
      exempt,
      "solo /version può essere esente: è la rotta che spiega il " +
        "disallineamento, ogni altra esenzione servirebbe un payload a un " +
        "client che non ha detto come lo legge",
    ).toEqual(["/version"]);
  });

  it("le rotte sono congelate voce per voce, non solo l'array", () => {
    expect(Object.isFrozen(ROUTES)).toBe(true);
    for (const route of ROUTES) {
      expect(
        Object.isFrozen(route),
        "ogni voce di ROUTES va congelata: chi costruisce il router non " +
          "deve poterle attaccare un matcher compilato (route.regex = …), " +
          "che sarebbe stato mutabile in una tabella condivisa",
      ).toBe(true);
    }
    expect(() => {
      (ROUTES as unknown as Array<unknown>).push({});
    }).toThrow();
    expect(() => {
      (ROUTES[0] as { name: string }).name = "altro";
    }).toThrow();
  });

  it("le capacità sono quattro, tutte in lettura", () => {
    expect(
      [...CAPABILITIES],
      "CAPABILITIES è cambiata: è quello che GET /version pubblica, e un " +
        "cambio di payload alza API_CONTRACT",
    ).toEqual([
      "read.team-status",
      "read.positions",
      "read.position",
      "read.dashboard",
    ]);
    expect(
      CAPABILITIES.filter((c) => !c.startsWith("read.")),
      "la fase 1 è in sola lettura: una capacità che non è read.* va " +
        "annunciata solo quando la corsia di scrittura esiste davvero " +
        "(fase 3)",
    ).toEqual([]);
  });
});

// ── La tabella degli errori ────────────────────────────────────────────────

/**
 * La tabella della sezione 4 del piano, riscritta a mano di proposito: se
 * fosse derivata da `ERROR_CODES` non misurerebbe niente. È il guard di drift
 * fra il contratto scritto (piano + ADR 0009) e il contratto eseguito.
 */
const EXPECTED_ERROR_STATUSES: Record<string, number> = {
  METHOD_NOT_ALLOWED: 405,
  HOST_NOT_LOOPBACK: 421,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHORIZED: 401,
  ROUTE_UNKNOWN: 404,
  CONTRACT_HEADER_MISSING: 400,
  CONTRACT_HEADER_MALFORMED: 400,
  CLIENT_TOO_OLD: 426,
  SERVER_TOO_OLD: 409,
  QUERY_PARAM_UNKNOWN: 400,
  QUERY_PARAM_MALFORMED: 400,
  POSITION_NOT_FOUND: 404,
  TMUX_UNAVAILABLE: 503,
  DB_UNAVAILABLE: 503,
  DB_SCHEMA_INCOMPLETE: 503,
  UNSUPPORTED_COLUMN_TYPE: 500,
  INTERNAL: 500,
};

/** Prosa italiana ad alto segnale: accenti, più le parole che non collidono. */
const ITALIAN_COPY =
  /[àèéìòùÀÈÌÒÙ]|\b(?:nessun\w*|errore|impossibile|sconosciut\w*|richiest\w*|aziend\w*|posizion\w*|squadra|utente|riavvi\w*|contenitore)\b/i;

describe("la tabella degli errori", () => {
  it("i codici e i loro stati sono quelli del contratto scritto", () => {
    const actual = Object.fromEntries(
      Object.entries(ERROR_CODES).map(([code, row]) => [code, row.status]),
    );
    expect(
      actual,
      "la tabella degli errori è cambiata: è normativa e sta nella sezione " +
        "«Error codes» del piano e nell'ADR 0009 — aggiorna insieme " +
        "shared/api/contract.js, l'ADR e i client che mappano i codici a un " +
        "exit code (cli/src/lib/api/client.js)",
    ).toEqual(EXPECTED_ERROR_STATUSES);
  });

  it("ogni riga porta una frase e un rimedio, entrambi stringhe non vuote", () => {
    for (const [code, row] of Object.entries(ERROR_CODES)) {
      expect(
        typeof row.error,
        `ERROR_CODES.${code}.error deve essere una STRINGA: il modo di dire ` +
          "«errore» di casa è json.error || 'unknown' " +
          "(cli/src/lib/team-state-reconciler.js), che con un oggetto " +
          "stamperebbe [object Object]",
      ).toBe("string");
      expect(row.error.trim().length, `ERROR_CODES.${code}.error è vuoto`).toBeGreaterThan(0);
      expect(
        row.hint.trim().length,
        `ERROR_CODES.${code}.hint è vuoto: senza rimedio i quattro guasti di ` +
          "ADR-0009:111-113 si somigliano tutti",
      ).toBeGreaterThan(0);
    }
  });

  it("le frasi sono in inglese (il censimento non vede questa mappa)", () => {
    const leaks: string[] = [];
    for (const [code, row] of Object.entries(ERROR_CODES)) {
      for (const [field, value] of [
        ["error", row.error],
        ["hint", row.hint],
      ] as const) {
        if (ITALIAN_COPY.test(value)) leaks.push(`${code}.${field}`);
      }
    }
    expect(
      leaks,
      "queste frasi finiscono in un terminale: shared/ è area di censimento " +
        "a zero perdite, e per i file JS il gate legge solo console/throw/" +
        ".description — quindi questa mappa la copre soltanto questo test",
    ).toEqual([]);
  });

  it("lo scanner sa riconoscere una frase italiana, se ci fosse", () => {
    // Senza questa riga una regex rotta terrebbe verde il test per sempre.
    expect(ITALIAN_COPY.test("Nessuna posizione trovata")).toBe(true);
    expect(ITALIAN_COPY.test("The team API accepts no request body.")).toBe(false);
  });
});

// ── Il verdetto ────────────────────────────────────────────────────────────

describe("verdetto sul contratto — accordo", () => {
  it("l'intero uguale passa, come numero e come testo", () => {
    // Sul filo l'header è testo, sempre: se `String(API_CONTRACT)` non
    // passasse, nessun client potrebbe parlare con nessun server.
    expect(
      verdict({ clientContract: API_CONTRACT }),
      "il contratto uguale come numero deve passare: è la forma che usa il " +
        "client quando confronta data.contract di GET /version",
    ).toEqual({ ok: true });
    expect(
      verdict({ clientContract: String(API_CONTRACT) }),
      "il contratto uguale come testo deve passare: è la forma in cui " +
        "arriva l'header X-JHT-Api-Contract",
    ).toEqual({ ok: true });
  });

  it("un serverContract esplicito è quello che conta", () => {
    const v = verdict({ clientContract: 5, serverContract: 5 });
    expect(v).toEqual({ ok: true });
  });
});

/**
 * Le righe di rifiuto. `both` significa «nel messaggio devono comparire
 * entrambi gli interi»: `cli/bin/jht.js` stampa soltanto `err.message`,
 * quindi un numero che non sta nella frase è un numero che l'utente non
 * vede mai.
 */
const REFUSALS: Array<{
  label: string;
  input: Record<string, unknown>;
  code: string;
  status: number;
  both?: [number, number];
}> = [
  {
    label: "client più vecchio del server",
    input: { clientContract: 0 },
    code: "CLIENT_TOO_OLD",
    status: 426,
    both: [0, API_CONTRACT],
  },
  {
    label: "client più nuovo del server",
    input: { clientContract: 2 },
    code: "SERVER_TOO_OLD",
    status: 409,
    both: [2, API_CONTRACT],
  },
  {
    label: "client più vecchio, con serverContract esplicito",
    input: { clientContract: 1, serverContract: 7 },
    code: "CLIENT_TOO_OLD",
    status: 426,
    both: [1, 7],
  },
  {
    label: "header assente (null)",
    input: { clientContract: null },
    code: "CONTRACT_HEADER_MISSING",
    status: 400,
  },
  {
    label: "header assente (undefined)",
    input: { clientContract: undefined },
    code: "CONTRACT_HEADER_MISSING",
    status: 400,
  },
  {
    label: "header presente ma vuoto",
    input: { clientContract: "" },
    code: "CONTRACT_HEADER_MISSING",
    status: 400,
  },
  {
    label: "header di soli spazi",
    input: { clientContract: "   " },
    code: "CONTRACT_HEADER_MISSING",
    status: 400,
  },
  {
    label: "testo che non è un intero",
    input: { clientContract: "abc" },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "zero iniziale ('01')",
    input: { clientContract: "01" },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "decimale ('1.0')",
    input: { clientContract: "1.0" },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "segno ('+1')",
    input: { clientContract: "+1" },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "esadecimale ('0x1')",
    input: { clientContract: "0x1" },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "header duplicato, unito da Node con la virgola",
    input: { clientContract: "1, 1" },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "più di quattro cifre (99999)",
    input: { clientContract: 99999 },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "numero negativo",
    input: { clientContract: -1 },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "numero non intero",
    input: { clientContract: 1.5 },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "NaN",
    input: { clientContract: Number.NaN },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "booleano",
    input: { clientContract: true },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
  {
    label: "oggetto",
    input: { clientContract: {} },
    code: "CONTRACT_HEADER_MALFORMED",
    status: 400,
  },
];

describe("verdetto sul contratto — rifiuti", () => {
  for (const row of REFUSALS) {
    it(`rifiuta: ${row.label}`, () => {
      const v = verdict(row.input);
      expect(
        v.ok,
        `${row.label}: un verdetto positivo qui è esattamente ` +
          "[CHAT-LANE-SILENT-DROP-ON-OLD-CLIENT] — controlla readContract in " +
          "shared/api/contract.js",
      ).toBe(false);
      expect(
        v.code,
        `${row.label}: il codice macchina è la metà che un client legge per ` +
          "decidere l'exit code",
      ).toBe(row.code);
      expect(v.status, `${row.label}: stato HTTP fuori dalla tabella`).toBe(row.status);
      expect(
        REFUSAL_STATUSES,
        `${row.label}: un rifiuto di contratto può essere solo 400, 409 o 426`,
      ).toContain(v.status);
      expect(typeof v.message, `${row.label}: il messaggio deve essere una stringa`).toBe(
        "string",
      );
      const message = String(v.message);
      expect(
        message.includes(String(row.input.serverContract ?? API_CONTRACT)),
        `${row.label}: il messaggio non nomina il contratto servito, e ` +
          "cli/bin/jht.js stampa solo err.message — l'utente non vedrebbe " +
          "mai il numero che deve raggiungere",
      ).toBe(true);
      if (row.both) {
        for (const integer of row.both) {
          expect(
            message.includes(String(integer)),
            `${row.label}: nel messaggio di disallineamento devono comparire ` +
              `entrambi gli interi (${row.both.join(" e ")}): cli/bin/jht.js ` +
              "stampa solo err.message",
          ).toBe(true);
        }
      }
    });
  }

  it("i messaggi di header mancante o malformato nominano l'header", () => {
    // Il nome dell'header nelle frasi è scritto in forma leggibile
    // (`X-JHT-Api-Contract`): questo confronto lo lega alla costante, così
    // un rename non lascia indietro le frasi.
    for (const bad of [null, "", "abc", "01"]) {
      const message = String(verdict({ clientContract: bad }).message).toLowerCase();
      expect(
        message.includes(CONTRACT_HEADER),
        "il messaggio deve nominare l'header per come si scrive: se " +
          "CONTRACT_HEADER cambia, le frasi in shared/api/contract.js vanno " +
          "riscritte insieme",
      ).toBe(true);
    }
  });

  it("i due messaggi di disallineamento dicono quale lato aggiornare", () => {
    expect(String(verdict({ clientContract: 0 }).message)).toContain("update the JHT client");
    expect(String(verdict({ clientContract: 2 }).message)).toContain(
      "update the container image",
    );
  });

  it("un contratto che il server non ha dichiarato non diventa mai un accordo", () => {
    // È il buco che il default di parametro aprirebbe da solo: `null` non
    // fa scattare un default, `undefined` sì, e in entrambi i casi il client
    // proseguirebbe contro un server che non ha detto niente.
    for (const nothing of [null, undefined, "", "  ", "abc", {}, 1.5]) {
      const v = verdict({ clientContract: API_CONTRACT, serverContract: nothing });
      expect(
        v.ok,
        "con un serverContract illeggibile il verdetto deve essere un " +
          "rifiuto: il client non deve emettere nessuna richiesta dati " +
          "(vedi cli/src/lib/api/client.js, handshake su GET /version)",
      ).toBe(false);
      expect(
        v.code,
        "un server che non dichiara il contratto è CONTRACT_UNKNOWN, non un " +
          "disallineamento: sono due rimedi diversi",
      ).toBe("CONTRACT_UNKNOWN");
      expect(String(v.message)).toContain("refusing to guess");
    }
  });

  it("l'assenza della chiave serverContract usa il contratto di questa immagine", () => {
    // Lato server la chiave non si passa: il default è l'unica cosa che il
    // container può dichiarare di sapere servire.
    expect(verdict({ clientContract: API_CONTRACT })).toEqual({ ok: true });
    expect(contractVerdict(undefined as never).ok).toBe(false);
  });
});

// ── Le buste ───────────────────────────────────────────────────────────────

describe("la busta di successo", () => {
  it("porta dati, contratto e ora della risposta", () => {
    const body = ok({ total: 3 }, new Date(1_700_000_000_000));
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ total: 3 });
    expect(
      body.meta.contract,
      "meta.contract è la firma con cui la risposta è stata scritta: il " +
        "client la confronta prima di leggere data",
    ).toBe(API_CONTRACT);
    expect(body.meta.generatedAt).toBe("2023-11-14T22:13:20.000Z");
  });

  it("un payload assente diventa null, non una chiave che sparisce", () => {
    const body = ok(undefined, 0);
    expect(
      JSON.parse(JSON.stringify(body)),
      "JSON.stringify cancella undefined: senza il null un client non " +
        "distinguerebbe «nessun payload» da «protocollo diverso da quello " +
        "che credo»",
    ).toEqual({
      ok: true,
      data: null,
      meta: { contract: API_CONTRACT, generatedAt: "1970-01-01T00:00:00.000Z" },
    });
  });

  it("l'orologio si accetta in ogni forma in cui un chiamante lo ha in mano", () => {
    const expected = "1970-01-01T00:00:00.000Z";
    expect(ok(null, new Date(0)).meta.generatedAt).toBe(expected);
    expect(ok(null, 0).meta.generatedAt).toBe(expected);
    expect(ok(null, expected).meta.generatedAt).toBe(expected);
    expect(ok(null, () => new Date(0)).meta.generatedAt).toBe(expected);
  });

  it("un orologio illeggibile non fa cadere una lettura riuscita", () => {
    for (const broken of [undefined, "domani", Number.NaN, {}, () => { throw new Error("x"); }]) {
      const stamp = ok(null, broken).meta.generatedAt;
      expect(
        Number.isFinite(new Date(stamp).getTime()),
        "meta.generatedAt deve restare un ISO valido: un timestamp è " +
          "metadato, e un 500 per decorare una risposta sarebbe " +
          "sproporzionato",
      ).toBe(true);
    }
  });
});

describe("la busta d'errore", () => {
  it("porta lo stato della tabella e un error che è sempre una stringa", () => {
    for (const [code, row] of Object.entries(ERROR_CODES)) {
      const out = fail(code, { now: 0 });
      expect(out.status, `fail('${code}') deve usare lo stato della tabella`).toBe(row.status);
      expect(out.body.ok).toBe(false);
      expect(out.body.code, `fail('${code}') deve rimandare il codice`).toBe(code);
      expect(typeof out.body.error).toBe("string");
      expect(typeof out.body.hint).toBe("string");
      expect(out.body.meta).toEqual({
        contract: API_CONTRACT,
        generatedAt: "1970-01-01T00:00:00.000Z",
      });
      // Il modo di dire «errore» di casa, misurato invece di assunto.
      expect(
        out.body.error || "unknown",
        `fail('${code}'): json.error || 'unknown' non deve mai rendere ` +
          "[object Object] (cli/src/lib/team-state-reconciler.js)",
      ).not.toContain("[object Object]");
    }
  });

  it("un messaggio su misura sostituisce la frase, ma solo se è testo", () => {
    expect(fail("UNAUTHORIZED", { message: "The Bearer token did not match." }).body.error).toBe(
      "The Bearer token did not match.",
    );
    const withError = fail("INTERNAL", { message: new Error("boom") });
    expect(
      withError.body.error,
      "un Error passato per distrazione come message diventerebbe " +
        "[object Object] sul terminale dell'utente: shared/api/contract.js " +
        "deve ricadere sulla frase della tabella",
    ).toBe(ERROR_CODES.INTERNAL.error);
    expect(fail("INTERNAL", { hint: "   " }).body.hint).toBe(ERROR_CODES.INTERNAL.hint);
  });

  it("un codice che non sta nella tabella non viene servito come se ci fosse", () => {
    const out = fail("POSITION_NOT_FUND", { now: 0 });
    expect(
      out.status,
      "un codice ignoto deve diventare un 500 con un nome, non un'eccezione " +
        "dentro il ramo che formatta gli errori (una richiesta caduta a metà " +
        "si legge peggio di un 500)",
    ).toBe(500);
    expect(out.body.code).toBe("INTERNAL");
    expect(
      out.body.hint,
      "il rimedio deve nominare il codice ignoto e il file dove aggiungerlo",
    ).toContain("POSITION_NOT_FUND");
    expect(out.body.hint).toContain("shared/api/contract.js");
  });

  it("regge una chiamata malfatta senza sollevare", () => {
    // `fail()` sta sul percorso degli errori: se lanciasse, un difetto
    // minore diventerebbe una richiesta senza risposta.
    for (const bad of [undefined, null, 7, {}, []]) {
      const out = fail(bad as never, undefined);
      expect(out.status).toBe(500);
      expect(typeof out.body.error).toBe("string");
    }
  });
});

// ── Le due proibizioni del contratto ───────────────────────────────────────

/** Il sorgente senza commenti: la parola «import» compare nella prosa. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("le proibizioni di shared/api/contract.js", () => {
  const code = withoutComments(CONTRACT_SRC);

  it("zero import: il file lo carica anche il figlio di pid1 al boot", () => {
    expect(
      /(?:^|\n)\s*import\s/.test(code),
      "shared/api/contract.js deve restare senza import: una dipendenza qui " +
        "è una dipendenza dell'immagine, e la misura di costo della fase 1 " +
        "(roadmap §7.1) poggia sul fatto che non ce ne siano",
    ).toBe(false);
    expect(/\brequire\s*\(/.test(code), "niente require: il file è ESM puro").toBe(false);
    expect(/\bfrom\s*['"]/.test(code), "niente re-export da altri moduli").toBe(false);
  });

  it("lo scanner sa riconoscere un import, se ci fosse", () => {
    // Con la prosa italiana che nomina «import» a parole, una regex troppo
    // larga sarebbe rossa per sempre e una troppo stretta verde per sempre.
    const finto = "// un import di troppo\nimport { x } from 'node:fs';\n";
    expect(/(?:^|\n)\s*import\s/.test(withoutComments(finto))).toBe(true);
    expect(/(?:^|\n)\s*import\s/.test(withoutComments("// un import di troppo\n"))).toBe(false);
  });

  it("il cancello non delega a compareVersions", () => {
    // `compareVersions` restituisce 0 («pari, non fare nulla») quando una
    // delle due versioni è illeggibile: per una fascia di aggiornamento è la
    // clemenza giusta, per un cancello di filo è il guasto che ha già
    // colpito una volta.
    expect(
      CONTRACT_SRC.includes("compareVersions("),
      "shared/api/contract.js non deve chiamare compareVersions di " +
        "shared/release/version.js: torna 0 sull'illeggibile, cioè " +
        "[CHAT-LANE-SILENT-DROP-ON-OLD-CLIENT]",
    ).toBe(false);
    expect(/from\s*['"][^'"]*release\/version/.test(CONTRACT_SRC)).toBe(false);
  });

  it("nessun contractMin, nessuna fascia di tolleranza", () => {
    expect(
      /contractMin/i.test(code),
      "un contractMin crea una via di mis-serve dentro l'handshake che " +
        "esiste per impedire il mis-serve: la finestra di transizione si " +
        "apre elencando gli interi in API_CONTRACT_SUPPORTED, a mano",
    ).toBe(false);
    expect(
      code.includes("API_CONTRACT_SUPPORTED.includes"),
      "API_CONTRACT_SUPPORTED non è il cancello: contractVerdict confronta " +
        "con serverContract, e il handler risponde sempre con API_CONTRACT",
    ).toBe(false);
  });
});
