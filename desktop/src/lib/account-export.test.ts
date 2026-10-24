import { describe, expect, it, vi } from "vitest";
import { USER_DATA_TABLES } from "@/lib/account-data-tables";
import { EXPORT_COLUMNS } from "@/lib/account-export-columns";
import { buildAccountExport } from "./account-export";

// A stand-in for the cloud client: every table answers its rows; `broken` tables answer an error.
function fakeClient(options: { user?: { id: string; email?: string } | null; rows?: Record<string, unknown[]>; broken?: string[] } = {}) {
  const user = options.user === undefined ? { id: "u-1", email: "person@example.com" } : options.user;
  const selects: Record<string, string> = {};
  const from = (table: string) => {
    const answer = () => (options.broken?.includes(table) ? { data: null, error: new Error("denied") } : { data: options.rows?.[table] ?? [], error: null });
    const builder: Record<string, unknown> = {};
    for (const step of ["eq", "gt", "order"]) builder[step] = () => builder;
    builder.select = (columns: string) => {
      selects[table] = columns;
      return builder;
    };
    builder.range = async () => answer();
    builder.limit = async () => answer();
    return builder;
  };
  const client = { auth: { getUser: vi.fn(async () => ({ data: { user } })) }, from: vi.fn(from) };
  return { client: client as never, selects };
}

describe("the cloud account's export, built in the app", () => {
  it("reads every table of the account with its explicit columns, never everything", async () => {
    const { client, selects } = fakeClient({ rows: { positions: [{ id: "p1" }] } });
    const built = await buildAccountExport(client, new Date("2026-10-24T10:00:00Z"));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const file = JSON.parse(built.text) as { exported_at: string; account: { id: string; email: string }; note: string; data: Record<string, unknown[]> };
    expect(file.exported_at).toBe("2026-10-24T10:00:00.000Z");
    expect(file.account).toEqual({ id: "u-1", email: "person@example.com" });
    expect(Object.keys(file.data).sort()).toEqual([...USER_DATA_TABLES].sort());
    expect(file.data.positions).toEqual([{ id: "p1" }]);
    for (const table of USER_DATA_TABLES) {
      expect(selects[table], table).toBe(EXPORT_COLUMNS[table].join(","));
      expect(selects[table]).not.toContain("*");
    }
  });

  it("is not an export when one table cannot be read: it says which and gives no text", async () => {
    const { client } = fakeClient({ broken: ["positions", "scores"] });
    const built = await buildAccountExport(client);
    expect(built).toEqual({ ok: false, error: "export_incomplete", tables: ["scores", "positions"] });
    expect("text" in built).toBe(false);
  });

  it("says «not cloud» with no client or no signed-in account, and reads nothing", async () => {
    expect(await buildAccountExport(null)).toEqual({ ok: false, error: "not_cloud" });
    const { client } = fakeClient({ user: null });
    expect(await buildAccountExport(client)).toEqual({ ok: false, error: "not_cloud" });
    expect((client as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});
