/**
 * A permissive fake of the desktop Supabase client, for tests that run the
 * web's real pages and routes through the server stand-ins. Every table
 * answers the rows it was given, whatever the filters (they are the web's own
 * code, tested on the web): what these tests prove is that the desktop runs
 * that code on the user's client. Each call is recorded, filters included,
 * so a test can still check what was asked. Synthetic data only.
 */
export type FakeCall = { table: string; ops: Array<{ name: string; args: unknown[] }> };

export type FakeSupabase = {
  rows: Record<string, Record<string, unknown>[]>;
  calls: FakeCall[];
  user: { id: string; email?: string } | null;
  rpc: Array<{ name: string; args: unknown }>;
  /** What each RPC answers (default: no data, no error). */
  rpcResults: Record<string, { data: unknown; error: unknown }>;
  client: any;
};

export function createFakeSupabase(): FakeSupabase {
  const fake: FakeSupabase = {
    rows: {},
    calls: [],
    user: { id: "user-1" },
    rpc: [],
    rpcResults: {},
    client: null,
  };

  fake.client = {
    from(table: string) {
      const call: FakeCall = { table, ops: [] };
      fake.calls.push(call);
      const all = () => fake.rows[table] ?? [];
      const builder: any = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === "then") {
              return (ok: any, ko: any) => Promise.resolve({ data: all(), error: null }).then(ok, ko);
            }
            if (prop === "single" || prop === "maybeSingle") {
              return () => {
                call.ops.push({ name: prop, args: [] });
                const first = all()[0] ?? null;
                return Promise.resolve({
                  data: first,
                  error: first || prop === "maybeSingle" ? null : { code: "PGRST116", message: "no rows" },
                });
              };
            }
            if (prop === "range") {
              return (from: number, to: number) => {
                call.ops.push({ name: "range", args: [from, to] });
                return Promise.resolve({ data: all().slice(from, to + 1), error: null });
              };
            }
            return (...args: unknown[]) => {
              call.ops.push({ name: prop, args });
              return builder;
            };
          },
        },
      );
      return builder;
    },
    rpc(name: string, args: unknown) {
      fake.rpc.push({ name, args });
      return Promise.resolve(fake.rpcResults[name] ?? { data: null, error: null });
    },
    auth: {
      getUser: async () => ({ data: { user: fake.user }, error: null }),
      getSession: async () => ({ data: { session: fake.user ? { user: fake.user } : null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
  return fake;
}
