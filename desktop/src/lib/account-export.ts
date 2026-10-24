import type { SupabaseClient } from "@supabase/supabase-js";
import { USER_DATA_TABLES } from "@/lib/account-data-tables";
import { EXPORT_COLUMNS, exportOrderKey } from "@/lib/account-export-columns";
import { fetchPostgrestRows, fetchPostgrestRowsByKey } from "@/lib/postgrest-pages";

/**
 * The person's cloud data as one JSON text, read with the session this app already has (the anon
 * key and the person's token: every table answers under its own row-level policy, nothing here
 * can read another account), the same tables and the same explicit columns as the web's
 * `/api/account/export`. The text is saved by the native side (`export_account_save`); this
 * module only builds it.
 *
 * An export that misses one table is not an export: it says which and gives no text at all.
 */
export type AccountExportBuilt =
  | { ok: true; text: string }
  | { ok: false; error: "not_cloud" }
  | { ok: false; error: "export_incomplete"; tables: string[] };

export async function buildAccountExport(client: SupabaseClient | null, now: Date = new Date()): Promise<AccountExportBuilt> {
  if (!client) return { ok: false, error: "not_cloud" };
  let user: { id: string; email?: string | null } | null = null;
  try {
    user = (await client.auth.getUser()).data.user;
  } catch {
    user = null;
  }
  if (!user) return { ok: false, error: "not_cloud" };

  const data: Record<string, unknown[]> = {};
  const failed: string[] = [];
  for (const table of USER_DATA_TABLES) {
    // an explicit list, never select("*"): a column added tomorrow does not leave by itself
    const columns = EXPORT_COLUMNS[table];
    if (!columns) {
      failed.push(table);
      continue;
    }
    const key = exportOrderKey(table);
    const base = () => client.from(table).select(columns.join(",")).eq("user_id", user.id);
    try {
      const { data: rows, error } =
        key.length === 1 && key[0] === "id" && columns.includes("id")
          ? await fetchPostgrestRowsByKey<Record<string, unknown>>(
              (after) => (after === null ? base() : base().gt("id", after)).order("id") as never,
              "id",
            )
          : await fetchPostgrestRows(key.reduce((query, column) => query.order(column), base()) as never);
      if (error) failed.push(table);
      else data[table] = rows ?? [];
    } catch {
      failed.push(table);
    }
  }
  if (failed.length > 0) return { ok: false, error: "export_incomplete", tables: failed };

  return {
    ok: true,
    text: JSON.stringify(
      {
        exported_at: now.toISOString(),
        account: { id: user.id, email: user.email ?? null },
        // said in the file itself: whoever opens it next year knows what is not there
        note: "Contains the data synced to the cloud. Data that stays only on your machine is not here: export it from the app.",
        data,
      },
      null,
      2,
    ),
  };
}
