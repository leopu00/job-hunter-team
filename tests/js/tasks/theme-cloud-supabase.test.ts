import { describe, expect, it } from "vitest";

import {
  createSupabaseThemeBackend,
  type ThemeSupabaseClient,
} from "@/lib/theme-cloud-supabase";

type Result = {
  data: { theme?: unknown } | null;
  error: { code?: string; message?: string } | null;
};

class FakeQuery {
  action: "read" | "create" | "write" = "read";
  row: { user_id: string; theme: "dark" | "light" | "system" } | null =
    null;
  filter: [string, string] | null = null;

  constructor(private readonly client: FakeClient) {}

  select() {
    return this;
  }

  insert(row: NonNullable<FakeQuery["row"]>) {
    this.action = "create";
    this.row = row;
    return this;
  }

  upsert(row: NonNullable<FakeQuery["row"]>) {
    this.action = "write";
    this.row = row;
    return this;
  }

  eq(column: string, value: string) {
    this.filter = [column, value];
    return this;
  }

  async maybeSingle(): Promise<Result> {
    this.client.lastQuery = this;
    return this.client.readResult;
  }

  async single(): Promise<Result> {
    this.client.lastQuery = this;
    return this.client.writeResult;
  }
}

class FakeClient {
  sessionUserId: string | null = "user-1";
  readResult: Result = { data: { theme: "dark" }, error: null };
  writeResult: Result = { data: { theme: "light" }, error: null };
  tables: string[] = [];
  lastQuery: FakeQuery | null = null;

  auth = {
    getSession: async () => ({
      data: {
        session: this.sessionUserId
          ? { user: { id: this.sessionUserId } }
          : null,
      },
      error: null,
    }),
  };

  from(table: string) {
    this.tables.push(table);
    return new FakeQuery(this);
  }
}

function backend(client: FakeClient) {
  return createSupabaseThemeBackend(
    client as unknown as ThemeSupabaseClient,
  );
}

describe("theme cloud Supabase adapter", () => {
  it("ricava l'ownership dalla sessione browser", async () => {
    const client = new FakeClient();
    expect(await backend(client).currentUserId()).toBe("user-1");
    client.sessionUserId = null;
    expect(await backend(client).currentUserId()).toBeNull();
    expect(client.tables).toEqual([]);
  });

  it("legge solo la riga user_settings dell'utente", async () => {
    const client = new FakeClient();
    client.readResult = { data: { theme: "system" }, error: null };

    await expect(backend(client).readTheme("user-1")).resolves.toBe("system");
    expect(client.tables).toEqual(["user_settings"]);
    expect(client.lastQuery?.filter).toEqual(["user_id", "user-1"]);
  });

  it("tratta la unique violation del bootstrap come conflitto", async () => {
    const client = new FakeClient();
    client.writeResult = {
      data: null,
      error: { code: "23505", message: "duplicate key" },
    };

    await expect(
      backend(client).createTheme("user-1", "light"),
    ).resolves.toBe("conflict");
    expect(client.lastQuery?.action).toBe("create");
    expect(client.lastQuery?.row).toEqual({ user_id: "user-1", theme: "light" });
  });

  it("conferma una modifica soltanto col valore restituito dal cloud", async () => {
    const client = new FakeClient();
    client.writeResult = { data: { theme: "dark" }, error: null };

    await expect(backend(client).writeTheme("user-1", "dark")).resolves.toBe(
      "dark",
    );
    expect(client.lastQuery?.action).toBe("write");
    expect(client.lastQuery?.row).toEqual({ user_id: "user-1", theme: "dark" });
  });

  it("fallisce chiuso se il cloud restituisce un tema fuori contratto", async () => {
    const client = new FakeClient();
    client.readResult = { data: { theme: "sepia" }, error: null };

    await expect(backend(client).readTheme("user-1")).rejects.toThrow(
      "invalid value",
    );
  });
});
