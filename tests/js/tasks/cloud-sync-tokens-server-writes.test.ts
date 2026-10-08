/**
 * /api/cloud-sync/tokens crea e revoca i token col service_role (mig 093).
 *
 * Dalla 093 la sessione dell'utente legge i suoi token ma non li scrive:
 * prima, chi aveva la sessione poteva crearsi un token con un hash suo e
 * senza scadenza, o togliere `revoked_at` a un token revocato, scavalcando
 * questa route. Il service_role salta la RLS, quindi qui si guarda che ogni
 * scrittura porti l'utente della sessione verificata, e che senza sessione
 * il client admin non nasca nemmeno. Gira il codice vero della route, con
 * Supabase finto che registra chi scrive e con quali filtri.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  adminMissing: false,
  adminCreated: 0,
  sessionWrites: [] as string[],
  inserted: [] as Record<string, unknown>[],
  updates: [] as {
    patch: Record<string, unknown>;
    filters: [string, unknown][];
  }[],
}));

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: vi.fn(async () => ({
    allowed: true,
    retryAfterSec: 0,
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: () => ({
      insert() {
        mocks.sessionWrites.push("insert");
        throw new Error("la sessione non scrive cloud_sync_tokens");
      },
      update() {
        mocks.sessionWrites.push("update");
        throw new Error("la sessione non scrive cloud_sync_tokens");
      },
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (mocks.adminMissing) throw new Error("SUPABASE_SERVICE_ROLE_KEY");
    mocks.adminCreated += 1;
    return {
      from: (table: string) => {
        expect(table).toBe("cloud_sync_tokens");
        return {
          insert(row: Record<string, unknown>) {
            mocks.inserted.push(row);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "synthetic-token-id", name: row.name },
                  error: null,
                }),
              }),
            };
          },
          update(patch: Record<string, unknown>) {
            const entry = { patch, filters: [] as [string, unknown][] };
            mocks.updates.push(entry);
            const chain = {
              eq(column: string, value: unknown) {
                entry.filters.push([column, value]);
                return chain;
              },
              then(resolve: (value: { error: null }) => unknown) {
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return chain;
          },
        };
      },
    };
  },
}));

function postRequest(body: unknown) {
  return { json: async () => body } as never;
}

function deleteRequest(id: string) {
  return {
    nextUrl: new URL(`http://localhost/api/cloud-sync/tokens?id=${id}`),
  } as never;
}

beforeEach(() => {
  mocks.user = { id: USER };
  mocks.adminMissing = false;
  mocks.adminCreated = 0;
  mocks.sessionWrites.length = 0;
  mocks.inserted.length = 0;
  mocks.updates.length = 0;
});

describe("POST /api/cloud-sync/tokens", () => {
  it("crea il token col service_role, per l'utente della sessione", async () => {
    const { POST } = await import("@/app/api/cloud-sync/tokens/route");

    const res = await POST(
      postRequest({ name: "box-sintetico", user_id: OTHER }),
    );

    expect(res.status).toBe(201);
    expect(mocks.sessionWrites).toEqual([]);
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0].user_id).toBe(USER);
    expect(typeof mocks.inserted[0].token_hash).toBe("string");
  });

  it("senza sessione: 401 e nessun client admin", async () => {
    mocks.user = null;
    const { POST } = await import("@/app/api/cloud-sync/tokens/route");

    const res = await POST(postRequest({ name: "box" }));

    expect(res.status).toBe(401);
    expect(mocks.adminCreated).toBe(0);
    expect(mocks.inserted).toEqual([]);
  });

  it("senza chiave service_role: 500, e la sessione non scrive al suo posto", async () => {
    mocks.adminMissing = true;
    const { POST } = await import("@/app/api/cloud-sync/tokens/route");

    const res = await POST(postRequest({ name: "box" }));

    expect(res.status).toBe(500);
    expect(mocks.sessionWrites).toEqual([]);
  });
});

describe("DELETE /api/cloud-sync/tokens", () => {
  it("revoca col service_role, filtrando sul token E sull'utente della sessione", async () => {
    const { DELETE } = await import("@/app/api/cloud-sync/tokens/route");

    const res = await DELETE(deleteRequest("token-1"));

    expect(res.status).toBe(200);
    expect(mocks.sessionWrites).toEqual([]);
    expect(mocks.updates).toHaveLength(1);
    expect(Object.keys(mocks.updates[0].patch)).toEqual(["revoked_at"]);
    // Il service_role salta la RLS: senza il filtro su user_id un utente
    // revocherebbe il token di un altro conoscendone l'id.
    expect(mocks.updates[0].filters).toEqual([
      ["id", "token-1"],
      ["user_id", USER],
    ]);
  });

  it("senza sessione: 401 e nessun client admin", async () => {
    mocks.user = null;
    const { DELETE } = await import("@/app/api/cloud-sync/tokens/route");

    const res = await DELETE(deleteRequest("token-1"));

    expect(res.status).toBe(401);
    expect(mocks.adminCreated).toBe(0);
    expect(mocks.updates).toEqual([]);
  });
});
