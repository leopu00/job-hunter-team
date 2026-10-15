/**
 * The Supabase client while the desktop only reads an existing team's VPS
 * (lib/existing-team-readonly.ts). The web's queries all ask Supabase for the
 * user's own rows next to the team's (seen markers, feedback, files): here that
 * dataset is not the one on screen, so nothing is asked. Every query answers
 * "no rows, no error" without a network call, exactly what the web's own
 * queries treat as "nothing there" (an empty set, no feedback, no signal).
 */
const NO_ROWS = { data: null, error: null, count: null, status: 200, statusText: "OK" };

function query(): any {
  return new Proxy(function inertQuery() {}, {
    get(_target, property) {
      if (property === "then") {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(NO_ROWS).then(resolve, reject);
      }
      return (..._args: unknown[]) => query();
    },
    apply: () => query(),
  });
}

export const inertSupabase: any = {
  from: () => query(),
  rpc: () => query(),
  storage: { from: () => query() },
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  channel: () => query(),
  removeChannel: async () => "ok",
};
