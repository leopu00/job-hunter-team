import type { SupabaseClient } from "@supabase/supabase-js";

/** One query as the page built it: table, the chain of calls, and how it ended. */
export type FakeQuery = {
  table: string;
  ops: Array<[string, unknown[]]>;
  op(name: string): unknown[] | undefined;
};

export type FakeResult = { data: unknown; error: { message: string } | null; count?: number | null };

export type FakeRpcResult = { data: unknown; error: { code?: string; message?: string } | null };

/** By default the database has no single door (PostgREST does not find `request_action`). */
const NO_DOOR: FakeRpcResult = { data: null, error: { code: "PGRST202", message: "not found" } };

/**
 * A Supabase client that records every query chain and answers it with
 * `respond`. Enough of PostgREST's builder for the desktop pages: filters,
 * order/limit, insert/upsert/update/select, single/maybeSingle, and `await`.
 */
export function fakeSupabase(
  respond: (query: FakeQuery) => FakeResult,
  userId: string | null = "00000000-0000-4000-8000-000000000001",
  rpcRespond: (name: string, args: Record<string, unknown>) => FakeRpcResult = () => NO_DOOR,
) {
  const queries: FakeQuery[] = [];
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const from = (table: string) => {
    const query: FakeQuery = {
      table,
      ops: [],
      op: (name) => query.ops.find(([op]) => op === name)?.[1],
    };
    queries.push(query);
    const chain: Record<string, unknown> = {};
    for (const name of [
      "select",
      "insert",
      "upsert",
      "update",
      "delete",
      "eq",
      "neq",
      "in",
      "is",
      "ilike",
      "not",
      "or",
      "gte",
      "lte",
      "lt",
      "gt",
      "order",
      "limit",
      "range",
    ]) {
      chain[name] = (...args: unknown[]) => {
        query.ops.push([name, args]);
        return chain;
      };
    }
    const finish = (name: string) => () => {
      query.ops.push([name, []]);
      return Promise.resolve(respond(query));
    };
    chain.single = finish("single");
    chain.maybeSingle = finish("maybeSingle");
    chain.then = (resolve: (value: FakeResult) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(respond(query)).then(resolve, reject);
    return chain;
  };
  const client = {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      return rpcRespond(name, args);
    },
    auth: {
      getSession: async () => ({
        data: { session: userId ? { user: { id: userId } } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
  return { client, queries, rpcCalls };
}
