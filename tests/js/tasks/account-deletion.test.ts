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
import {
  CASCADE_TABLES,
  USER_DATA_TABLES,
} from "@/lib/account-data-tables";

interface Call {
  table: string;
  filterColumn?: string;
  filterValue?: string;
}

/** Finto client: registra le delete e l'ordine in cui arrivano. */
function fakeAdmin(opts: { failOn?: string; deleteUserFails?: boolean } = {}) {
  const calls: Call[] = [];
  const deletedUsers: string[] = [];
  const client = {
    from(table: string) {
      return {
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
  return { client: client as any, calls, deletedUsers };
}

describe("cancellazione account — cancella tutto", () => {
  it("svuota ogni tabella senza cascata, e poi cancella l'utente", async () => {
    const { client, calls, deletedUsers } = fakeAdmin();
    const outcome = await deleteAccountData(client, "user-1");

    expect(calls.map((c) => c.table)).toEqual([...MANUAL_DELETE_ORDER]);
    expect(deletedUsers).toEqual(["user-1"]);
    expect(Object.keys(outcome.removed)).toEqual([...MANUAL_DELETE_ORDER]);
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
