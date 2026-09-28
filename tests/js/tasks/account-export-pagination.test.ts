/**
 * L'export dell'account legge ogni tabella intera.
 *
 * PostgREST restituisce al massimo 1000 righe per risposta. L'export leggeva
 * ogni tabella con una query secca: sopra 1000 righe si fermava lì e
 * rispondeva 200 con un file che sembrava completo. Il finto client sotto
 * applica quel tetto a ogni risposta e le finestre `.range()`, e il test
 * guarda il FILE che l'utente riceve, non le chiamate.
 *
 * Le pagine sono stabili solo con un ordine per una chiave unica: il
 * censimento confronta la chiave d'ordine di ogni tabella con la chiave
 * primaria delle migration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_DATA_TABLES } from "@/lib/account-data-tables";
import { exportOrderKey } from "@/lib/account-export-columns";

const SERVICE_MAX_ROWS = 1000;
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  failOn: null as null | { table: string; from: number },
  orders: [] as Array<{ table: string; column: string }>,
}));

/** Il client admin non ha RLS: il filtro user_id della route è l'unica cosa
 *  che separa gli utenti. Il finto lo applica davvero, e restituisce solo le
 *  colonne chieste, come PostgREST. */
function adminClient() {
  return {
    from(table: string) {
      let after: unknown = null;
      let columns: string[] = [];
      const filters: Array<(row: Row) => boolean> = [];
      const rows = () =>
        (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const project = (list: Row[]) =>
        list.map((r) =>
          Object.fromEntries(
            Object.entries(r).filter(([k]) => columns.includes(k)),
          ),
        );
      const builder = {
        select: (list: string) => {
          columns = list.split(",").map((c) => c.trim());
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push((r) => r[column] === value);
          return builder;
        },
        gt: (_column: string, value: unknown) => {
          after = value;
          return builder;
        },
        order: (column: string) => {
          state.orders.push({ table, column });
          return builder;
        },
        // Keyset: le righe dopo l'ultimo id letto, al più 1000.
        limit: async (n: number) => {
          if (state.failOn?.table === table && after !== null) {
            return { data: null, error: { message: "boom" } };
          }
          const all = rows();
          const start =
            after === null ? 0 : all.findIndex((r) => r.id === after) + 1;
          return {
            data: project(
              all.slice(start, start + Math.min(n, SERVICE_MAX_ROWS)),
            ),
            error: null,
          };
        },
        range: async (from: number, to: number) => {
          if (state.failOn?.table === table && state.failOn.from === from) {
            return { data: null, error: { message: "boom" } };
          }
          const size = Math.min(to - from + 1, SERVICE_MAX_ROWS);
          return {
            data: project(rows().slice(from, from + size)),
            error: null,
          };
        },
        // Una query secca, senza pagine: il servizio dà le prime 1000.
        then(ok: (r: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve({
            data: project(rows().slice(0, SERVICE_MAX_ROWS)),
            error: null,
          }).then(ok);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/config", () => ({ hasSupabaseConfig: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER, email: null } } }),
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminClient(),
}));

beforeEach(() => {
  state.tables = {};
  state.failOn = null;
  state.orders = [];
});

async function exportFile() {
  const { GET } = await import("@/app/api/account/export/route");
  return GET();
}

describe("export dell'account — tutte le righe", () => {
  it("esporta 1500 posizioni quando il servizio ne dà 1000 per risposta", async () => {
    // Le righe di un altro utente in mezzo: il client admin non ha RLS.
    state.tables.positions = Array.from({ length: 3000 }, (_, i) => ({
      id: `p-${String(i).padStart(4, "0")}`,
      user_id: i % 2 === 0 ? USER : OTHER,
    }));
    state.tables.position_transitions = Array.from(
      { length: 2300 },
      (_, i) => ({ id: i, user_id: USER }),
    );
    state.tables.position_views = Array.from({ length: 1200 }, (_, i) => ({
      position_id: `p-${i}`,
      user_id: USER,
    }));

    const response = await exportFile();

    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text());
    expect(body.data.positions).toHaveLength(1500);
    expect(body.data.positions.at(-1)).toEqual({ id: "p-2998" });
    expect(body.data.position_transitions).toHaveLength(2300);
    // La chiave composta, fuori dall'export, passa per offset: tutte e 1200.
    expect(body.data.position_views).toHaveLength(1200);
    // Nessuna riga dell'altro utente, e nessuna colonna non chiesta.
    expect(JSON.stringify(body.data)).not.toContain(OTHER);
    // Ordine per la chiave primaria, anche dove non è `id`.
    expect(state.orders).toContainEqual({ table: "positions", column: "id" });
    expect(state.orders).toContainEqual({
      table: "position_views",
      column: "position_id",
    });
  });

  it("una pagina che fallisce a metà tabella non diventa un export monco", async () => {
    state.tables.positions = Array.from({ length: 1500 }, (_, i) => ({
      id: `p-${i}`,
      user_id: USER,
    }));
    state.failOn = { table: "positions", from: 1000 };

    const response = await exportFile();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "export_incomplete",
      tables: ["positions"],
    });
  });
});

describe("export dell'account — le pagine sono stabili", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const MIGRATIONS = path.resolve(HERE, "../../../supabase/migrations");

  /** La chiave primaria di ogni tabella, dai `create table` delle migration. */
  function primaryKeys(): Map<string, string[]> {
    const keys = new Map<string, string[]>();
    for (const file of fs
      .readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
      const re =
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_]+)"?\s*\(([\s\S]*?)\n\)\s*;/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        const body = m[2];
        const inline = [
          ...body.matchAll(/^\s*([a-z_]+)\s+[^,\n]*\bprimary\s+key\b/gim),
        ].map((x) => x[1]);
        const composite = /\bprimary\s+key\s*\(([^)]*)\)/i.exec(body);
        const key =
          inline.length > 0
            ? inline
            : composite
              ? composite[1].split(",").map((c) => c.trim())
              : [];
        if (key.length > 0 && !keys.has(m[1])) keys.set(m[1], key);
      }
    }
    return keys;
  }

  it("ogni tabella esportata si ordina per la sua chiave primaria", () => {
    const keys = primaryKeys();
    // Un parser che non trova niente renderebbe il confronto vuoto.
    expect(keys.size).toBeGreaterThanOrEqual(30);
    const wrong = USER_DATA_TABLES.filter(
      (t) => JSON.stringify(exportOrderKey(t)) !== JSON.stringify(keys.get(t)),
    ).map(
      (t) =>
        `${t}: ordine ${exportOrderKey(t).join(",")} · chiave ${keys.get(t)?.join(",") ?? "?"}`,
    );
    expect(wrong).toEqual([]);
  });
});
