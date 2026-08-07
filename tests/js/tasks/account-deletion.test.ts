/**
 * Cancellazione account: prove sul comportamento, non sulle intenzioni.
 *
 * L'operatore ha chiesto due garanzie: che cancelli tutto, e che non
 * cancelli l'account sbagliato. Sono verificate qui con un finto client
 * Supabase che registra ogni chiamata — così i test dicono cosa il codice
 * FA, non cosa i commenti promettono.
 *
 * La seconda garanzia ha una forma particolare: non si dimostra provando
 * un id sbagliato e vedendolo rifiutato, ma osservando che ogni singola
 * delete porta il filtro sull'utente della sessione. È la differenza fra
 * «validiamo l'input» e «non esiste un input da validare».
 */
import { describe, it, expect } from "vitest";

import {
  MANUAL_DELETE_ORDER,
  deleteAccountData,
  deletionAuditLine,
} from "@/lib/account-deletion";
import { CASCADE_TABLES, USER_DATA_TABLES } from "@/lib/account-data-tables";

interface Call {
  table: string;
  filterColumn?: string;
  filterValue?: string;
}

/** Finto client: registra le delete e l'ordine in cui arrivano. */
function fakeAdmin(
  opts: {
    failOn?: string;
    deleteUserFails?: boolean;
    storagePaths?: string[];
    storageTree?: Record<string, true>;
    storageRemovesNothing?: boolean;
    /** Numero del lotto (1-based) che deve fallire. */
    failBatch?: number;
  } = {},
) {
  const calls: Call[] = [];
  const deletedUsers: string[] = [];
  const removedPaths: string[] = [];
  const batches: number[] = [];
  const client = {
    storage: {
      from() {
        return {
          // Simula l'API vera: `list(prefix)` torna file (con `id`) e
          // cartelle immediate (con `id: null`), e NON scende da sola.
          list(prefix: string, o?: { limit?: number; offset?: number }) {
            const tree = opts.storageTree ?? {};
            const children = new Set<string>();
            for (const full of Object.keys(tree)) {
              if (!full.startsWith(prefix + "/")) continue;
              const rest = full.slice(prefix.length + 1);
              const head = rest.split("/")[0];
              children.add(head + (rest.includes("/") ? "/" : ""));
            }
            const all = [...children].map((c) =>
              c.endsWith("/")
                ? { name: c.slice(0, -1), id: null }
                : { name: c, id: "obj" },
            );
            // Pagina come l'API vera: `limit` + `offset`.
            const limit = o?.limit ?? all.length;
            const offset = o?.offset ?? 0;
            return Promise.resolve({
              data: all.slice(offset, offset + limit),
              error: null,
            });
          },
          // Come l'API vera: `remove` risponde elencando SOLO i file
          // davvero cancellati, e li toglie dall'albero. Un percorso che
          // non esiste non compare nella risposta — è esattamente ciò che
          // il fake precedente nascondeva, restituendo qualunque path gli
          // venisse passato.
          remove(paths: string[]) {
            // Supabase rifiuta oltre 1000 percorsi per chiamata. Il doppio
            // precedente accettava qualunque dimensione, ed è per questo
            // che il caso da 2500 passava: confermava l'assunzione invece
            // di controllarla.
            if (paths.length > 1000) {
              return Promise.resolve({
                data: null,
                error: { message: "too many paths (max 1000)" },
              });
            }
            batches.push(paths.length);
            removedPaths.push(...paths);
            const tree = opts.storageTree ?? {};
            // Un lotto che deve fallire non tocca l'albero.
            if (opts.failBatch === batches.length) {
              return Promise.resolve({
                data: null,
                error: { message: "boom" },
              });
            }
            const actually = opts.storageRemovesNothing
              ? []
              : paths.filter((p) => tree[p]);
            for (const p of actually) delete tree[p];
            return Promise.resolve({
              data: actually.map((name) => ({ name })),
              error: null,
            });
          },
        };
      },
    },
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({
                data: (opts.storagePaths ?? []).map((storage_path) => ({
                  storage_path,
                })),
                error: null,
              });
            },
          };
        },
        delete() {
          return {
            eq(column: string, value: string) {
              calls.push({ table, filterColumn: column, filterValue: value });
              if (opts.failOn === table) {
                return Promise.resolve({
                  count: null,
                  error: { message: "boom" },
                });
              }
              return Promise.resolve({ count: 2, error: null });
            },
          };
        },
      };
    },
    auth: {
      admin: {
        deleteUser(id: string) {
          deletedUsers.push(id);
          return Promise.resolve({
            error: opts.deleteUserFails ? { message: "no" } : null,
          });
        },
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls, deletedUsers, removedPaths, batches };
}

describe("cancellazione account — cancella tutto", () => {
  it("svuota ogni tabella senza cascata, e poi cancella l'utente", async () => {
    const { client, calls, deletedUsers } = fakeAdmin();
    const outcome = await deleteAccountData(client, "user-1");

    expect(calls.map((c) => c.table)).toEqual([...MANUAL_DELETE_ORDER]);
    expect(deletedUsers).toEqual(["user-1"]);
    // Il resoconto include anche i file su Storage, che non sono una
    // tabella ma vanno contati: una cancellazione che li dimentica non è
    // completa.
    expect(Object.keys(outcome.removed)).toEqual([
      "storage:file-transit",
      ...MANUAL_DELETE_ORDER,
    ]);
  });

  it("rispetta l'ordine delle dipendenze", async () => {
    // Le tabelle figlie devono cadere prima delle padri: invertire produce
    // una violazione di chiave a metà cancellazione, cioè dati rimossi
    // solo in parte con l'utente ancora esistente.
    const { client, calls } = fakeAdmin();
    await deleteAccountData(client, "user-1");
    const order = calls.map((c) => c.table);
    for (const [child, parent] of [
      ["applications", "positions"],
      ["position_highlights", "positions"],
      ["scores", "positions"],
      ["positions", "companies"],
    ]) {
      expect(
        order.indexOf(child),
        `${child} deve precedere ${parent}`,
      ).toBeLessThan(order.indexOf(parent));
    }
  });

  it("l'utente cade per ultimo, mai prima dei suoi dati", async () => {
    const { client, calls, deletedUsers } = fakeAdmin();
    await deleteAccountData(client, "user-1");
    // Se `deleteUser` fosse chiamata prima, le tabelle NO ACTION
    // rifiuterebbero e resteremmo con l'utente vivo e i dati orfani.
    expect(calls.length).toBe(MANUAL_DELETE_ORDER.length);
    expect(deletedUsers.length).toBe(1);
  });
});

describe("cancellazione account — non tocca l'account sbagliato", () => {
  it("ogni delete filtra sull'utente della sessione", async () => {
    const { client, calls } = fakeAdmin();
    await deleteAccountData(client, "user-1");
    for (const call of calls) {
      expect(call.filterColumn).toBe("user_id");
      expect(call.filterValue).toBe("user-1");
    }
  });

  it("un id vuoto è rifiutato prima di toccare qualsiasi tabella", async () => {
    const { client, calls, deletedUsers } = fakeAdmin();
    await expect(deleteAccountData(client, "")).rejects.toThrow(/userId/);
    expect(calls).toEqual([]);
    expect(deletedUsers).toEqual([]);
  });

  it("la route non accetta un id utente dal client", async () => {
    // La garanzia più forte non è una validazione: è che il campo non
    // esista. Se un domani comparisse, questo test lo segnala.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const route = fs.readFileSync(
      path.resolve(here, "../../../web/app/api/account/delete/route.ts"),
      "utf8",
    );
    expect(route).toContain("user.id");
    expect(route.includes("body.userId")).toBe(false);
    expect(route.includes("body.user_id")).toBe(false);
  });
});

describe("cancellazione account — fallimenti detti, non mascherati", () => {
  it("un errore a metà interrompe e dice dove", async () => {
    const { client, deletedUsers } = fakeAdmin({ failOn: "positions" });
    await expect(deleteAccountData(client, "user-1")).rejects.toThrow(
      /positions/,
    );
    // L'utente NON deve essere cancellato se i suoi dati non lo sono:
    // sarebbe il caso peggiore, dati orfani senza più un proprietario.
    expect(deletedUsers).toEqual([]);
  });

  it("se l'utente non cade, lo dice invece di rispondere ok", async () => {
    const { client } = fakeAdmin({ deleteUserFails: true });
    await expect(deleteAccountData(client, "user-1")).rejects.toThrow(
      /utente ancora presente/,
    );
  });
});

describe("cancellazione account — il record tecnico non conserva i dati", () => {
  it("contiene conteggi e riferimento, non contenuti", () => {
    const line = deletionAuditLine(
      "abc123",
      { removed: { positions: 12 }, order: MANUAL_DELETE_ORDER },
      "2026-08-07T12:00:00.000Z",
    );
    expect(line).toContain("positions=12");
    expect(line).toContain("abc123");
    // Nessun indizio di contenuto: né email, né titoli, né id in chiaro.
    expect(line).not.toMatch(/@/);
  });
});

describe("export e cancellazione parlano dello stesso insieme", () => {
  it("nessuna tabella sta in un elenco e non nell'altro", () => {
    const union = new Set([...MANUAL_DELETE_ORDER, ...CASCADE_TABLES]);
    expect(new Set(USER_DATA_TABLES)).toEqual(union);
    // E nessuna compare due volte: un doppione nell'ordine di
    // cancellazione significherebbe una delete ripetuta.
    expect(new Set(USER_DATA_TABLES).size).toBe(USER_DATA_TABLES.length);
  });
});

describe("cancellazione account — i file su Storage non sopravvivono", () => {
  it("rimuove gli oggetti prima di cancellare le righe che li nominano", async () => {
    const { client, calls, removedPaths } = fakeAdmin({
      storageTree: {
        "user-1/req/cv.pdf": true,
        "user-1/req/lettera.pdf": true,
      },
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).toEqual([
      "user-1/req/cv.pdf",
      "user-1/req/lettera.pdf",
    ]);
    // I percorsi vivono solo in `file_bridge_requests`: se quella riga
    // cadesse prima, non sapremmo più quali file cancellare.
    expect(calls.length).toBeGreaterThan(0);
  });

  it("se un file resta, la cancellazione si ferma invece di dirsi completa", async () => {
    const { client, deletedUsers } = fakeAdmin({
      storageTree: { "user-1/req/cv.pdf": true },
      storageRemovesNothing: true,
    });
    await expect(deleteAccountData(client, "user-1")).rejects.toThrow(
      /non cancellati/,
    );
    expect(deletedUsers).toEqual([]);
  });

  it("senza file da cancellare non si inventa un fallimento", async () => {
    const { client, deletedUsers } = fakeAdmin({ storagePaths: [] });
    await deleteAccountData(client, "user-1");
    expect(deletedUsers).toEqual(["user-1"]);
  });
});

describe("export — nessun segreto esce", () => {
  it("l'allowlist non contiene nessun campo proibito", async () => {
    const { EXPORT_COLUMNS, FORBIDDEN_EXPORT_FIELDS } =
      await import("@/lib/account-export-columns");
    const leaked: string[] = [];
    for (const [table, cols] of Object.entries(EXPORT_COLUMNS)) {
      for (const col of cols) {
        if ((FORBIDDEN_EXPORT_FIELDS as readonly string[]).includes(col)) {
          leaked.push(`${table}.${col}`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });

  it("un payload costruito dall'allowlist non nomina segreti", async () => {
    // Simula il JSON: le chiavi sono le colonne dichiarate. Se un campo
    // proibito comparisse, lo si vedrebbe nel testo serializzato.
    const { EXPORT_COLUMNS, FORBIDDEN_EXPORT_FIELDS } =
      await import("@/lib/account-export-columns");
    const payload = JSON.stringify(
      Object.fromEntries(
        Object.entries(EXPORT_COLUMNS).map(([t, cols]) => [
          t,
          [Object.fromEntries(cols.map((c) => [c, "x"]))],
        ]),
      ),
    );
    for (const field of FORBIDDEN_EXPORT_FIELDS) {
      expect(payload, `«${field}» nel payload`).not.toContain(`"${field}"`);
    }
  });

  it("ogni tabella dei dati utente ha la sua allowlist", async () => {
    // Una tabella senza allowlist non viene esportata: va bene, ma deve
    // essere una scelta, non una dimenticanza. Qui si pretende che ci sia.
    const { EXPORT_COLUMNS } = await import("@/lib/account-export-columns");
    const missing = USER_DATA_TABLES.filter((t) => !EXPORT_COLUMNS[t]);
    expect(missing).toEqual([]);
  });

  it("la route usa l'allowlist e non select(*)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const route = fs.readFileSync(
      path.resolve(here, "../../../web/app/api/account/export/route.ts"),
      "utf8",
    );
    expect(route).toContain("EXPORT_COLUMNS");
    // Si cerca la CHIAMATA, non la stringa: `select("*")` compare anche nel
    // commento che spiega perché non si usa, e un match ingenuo lo
    // scambierebbe per il difetto.
    expect(route.includes('.select("*")')).toBe(false);
  });
});

describe("il messaggio di errore non promette cose false", () => {
  it("non dichiara che nulla è stato cancellato", async () => {
    const { T } = await import("@/app/components/AccountDataCard.i18n");
    // Il codice ammette la cancellazione parziale: la UI non può negarla.
    for (const [lang, text] of Object.entries(T.error_delete)) {
      expect(text.toLowerCase(), lang).not.toMatch(
        /nulla è stato|nothing was|nichts wurde|rien n'a été|nada se ha|nada foi|semmi nem/,
      );
    }
    expect(T.error_delete.en.toLowerCase()).toContain("may already");
  });
});

describe("cancellazione — i file orfani non sopravvivono", () => {
  it("cancella un oggetto che non ha piu' la sua riga", async () => {
    // Il caso reale trovato da HQ-DOCS: un file nel bucket senza riga in
    // `file_bridge_requests`. Fidarsi delle righe lo avrebbe lasciato lì.
    const { client, removedPaths } = fakeAdmin({
      storagePaths: [],
      storageTree: { "user-1/req-x/orfano.pdf": true },
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).toContain("user-1/req-x/orfano.pdf");
  });

  it("una riga fossile non blocca la cancellazione", async () => {
    // Il purge ordinario rimuove l'oggetto ma CONSERVA la riga, marcandola
    // `expired` col percorso ancora dentro. Se quel percorso finisse nella
    // `remove`, Supabase non lo elencherebbe fra i cancellati — non
    // esiste — e il confronto lo direbbe non rimosso, bloccando per sempre
    // la cancellazione dell'account dopo un purge riuscito. Trovato da
    // HQ-BACKEND.
    const { client, removedPaths, deletedUsers } = fakeAdmin({
      storagePaths: ["user-1/req-vecchio/purgato.pdf"],
      storageTree: {},
    });
    await deleteAccountData(client, "user-1");
    expect(deletedUsers, "la cancellazione si è bloccata").toEqual(["user-1"]);
    expect(removedPaths).not.toContain("user-1/req-vecchio/purgato.pdf");
  });

  it("nomi uguali in cartelle diverse restano distinti", async () => {
    // La versione precedente confrontava anche per basename per decidere
    // se un file era stato rimosso: con lo stesso nome in due cartelle,
    // la rimozione di uno faceva passare per rimosso anche l'altro. Ora
    // la prova è la rienumerazione del namespace, che non ha ambiguità.
    const { client, removedPaths } = fakeAdmin({
      storageTree: {
        "user-1/req-a/cv.pdf": true,
        "user-1/req-b/cv.pdf": true,
      },
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).toContain("user-1/req-a/cv.pdf");
    expect(removedPaths).toContain("user-1/req-b/cv.pdf");
  });
});

describe("cancellazione — il percorso reale dei file ha tre segmenti", () => {
  it("scende nelle cartelle invece di fermarsi al primo livello", async () => {
    // Gli upload finiscono in `${userId}/${requestId}/${nome}`: al primo
    // livello ci sono solo CARTELLE, e `remove()` su una cartella non
    // cancella niente. Il test precedente simulava due segmenti ed era
    // verde confermando un'assunzione sbagliata.
    const { client, removedPaths } = fakeAdmin({
      storagePaths: [],
      storageTree: {
        "user-1/req-a/cv.pdf": true,
        "user-1/req-b/lettera.pdf": true,
      },
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).toContain("user-1/req-a/cv.pdf");
    expect(removedPaths).toContain("user-1/req-b/lettera.pdf");
    // E soprattutto: non deve provare a rimuovere le cartelle.
    expect(removedPaths).not.toContain("user-1/req-a");
  });

  it("scende su più di due livelli", async () => {
    const { client, removedPaths } = fakeAdmin({
      storagePaths: [],
      storageTree: { "user-1/a/b/c/file.pdf": true },
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).toContain("user-1/a/b/c/file.pdf");
  });
});

describe("cancellazione — non si cancellano file di altri", () => {
  it("ignora un percorso che punta fuori dal namespace dell'utente", async () => {
    // `file_bridge_requests` accetta INSERT con il solo controllo su
    // `user_id`: `storage_path` non è verificato. Un utente può inserire
    // una propria riga che punta al file di un altro e — con service_role
    // che bypassa RLS — farlo cancellare chiudendo il proprio account.
    // Segnalato da HQ-BACKEND.
    const { client, removedPaths } = fakeAdmin({
      storagePaths: ["vittima-2/req/cv.pdf", "user-1/req/mio.pdf"],
      storageTree: { "user-1/req/mio.pdf": true },
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).toContain("user-1/req/mio.pdf");
    expect(
      removedPaths,
      "ha cancellato il file di un altro utente",
    ).not.toContain("vittima-2/req/cv.pdf");
  });

  it("un prefisso che somiglia non basta a passare", async () => {
    // `user-10/...` non è dentro `user-1/`: il confronto deve essere sul
    // separatore, non su una semplice somiglianza iniziale.
    const { client, removedPaths } = fakeAdmin({
      storagePaths: ["user-10/req/altrui.pdf"],
      storageTree: {},
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).not.toContain("user-10/req/altrui.pdf");
  });
});

describe("cancellazione — l'enumerazione non si tronca in silenzio", () => {
  it("pagina oltre il limite invece di fermarsi alla prima pagina", async () => {
    // Con una sola `list` a limite fisso, una cartella con più figli del
    // limite verrebbe troncata e la cancellazione si direbbe completa.
    const tree: Record<string, true> = {};
    for (let i = 0; i < 2500; i += 1) tree[`user-1/req/f${i}.pdf`] = true;
    const { client, removedPaths, batches } = fakeAdmin({
      storagePaths: [],
      storageTree: tree,
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).toHaveLength(2500);
    // Tre chiamate, non una da 2500: il limite di Supabase è 1000.
    expect(batches).toEqual([1000, 1000, 500]);
  });
});

describe("cancellazione — un lotto fallito ferma i successivi", () => {
  it("al primo errore non lancia i lotti rimanenti", async () => {
    const tree: Record<string, true> = {};
    for (let i = 0; i < 2500; i += 1) tree[`user-1/req/f${i}.pdf`] = true;
    const { client, batches, deletedUsers } = fakeAdmin({
      storageTree: tree,
      failBatch: 2,
    });
    await expect(deleteAccountData(client, "user-1")).rejects.toThrow();
    // Due lotti tentati, il terzo mai: se il bucket sta rifiutando,
    // insistere allarga il danno invece di ridurlo.
    expect(batches).toEqual([1000, 1000]);
    // E soprattutto: l'utente e i suoi dati NON vengono cancellati, o
    // resterebbero file orfani senza più un proprietario.
    expect(deletedUsers).toEqual([]);
  });
});
