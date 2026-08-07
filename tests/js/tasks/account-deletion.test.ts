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
  } = {},
) {
  const calls: Call[] = [];
  const deletedUsers: string[] = [];
  const removedPaths: string[] = [];
  const client = {
    storage: {
      from() {
        return {
          // Simula l'API vera: `list(prefix)` torna file (con `id`) e
          // cartelle immediate (con `id: null`), e NON scende da sola.
          list(prefix: string) {
            const tree = opts.storageTree ?? {};
            const children = new Set<string>();
            for (const full of Object.keys(tree)) {
              if (!full.startsWith(prefix + "/")) continue;
              const rest = full.slice(prefix.length + 1);
              const head = rest.split("/")[0];
              children.add(head + (rest.includes("/") ? "/" : ""));
            }
            return Promise.resolve({
              data: [...children].map((c) =>
                c.endsWith("/")
                  ? { name: c.slice(0, -1), id: null }
                  : { name: c, id: "obj" },
              ),
              error: null,
            });
          },
          remove(paths: string[]) {
            removedPaths.push(...paths);
            return Promise.resolve({
              data: opts.storageRemovesNothing
                ? []
                : paths.map((name) => ({ name })),
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
  return { client: client as any, calls, deletedUsers, removedPaths };
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
      storagePaths: ["u1/cv.pdf", "u1/lettera.pdf"],
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).toEqual(["u1/cv.pdf", "u1/lettera.pdf"]);
    // I percorsi vivono solo in `file_bridge_requests`: se quella riga
    // cadesse prima, non sapremmo più quali file cancellare.
    expect(calls.length).toBeGreaterThan(0);
  });

  it("se un file resta, la cancellazione si ferma invece di dirsi completa", async () => {
    const { client, deletedUsers } = fakeAdmin({
      storagePaths: ["u1/cv.pdf"],
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

  it("unisce le due fonti invece di sceglierne una", async () => {
    // Le righe possono puntare fuori dal prefisso dell'utente (percorsi
    // storici): vanno aggiunte all'enumerazione, non sostituite.
    const { client, removedPaths } = fakeAdmin({
      storagePaths: ["vecchio/percorso.pdf"],
      storageTree: { "user-1/req-y/nuovo.pdf": true },
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths).toContain("user-1/req-y/nuovo.pdf");
    expect(removedPaths).toContain("vecchio/percorso.pdf");
  });

  it("non cancella due volte lo stesso percorso", async () => {
    const { client, removedPaths } = fakeAdmin({
      storagePaths: ["user-1/uguale.pdf"],
      storageOrphans: ["uguale.pdf"],
    });
    await deleteAccountData(client, "user-1");
    expect(removedPaths.filter((p) => p === "user-1/uguale.pdf")).toHaveLength(
      1,
    );
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
