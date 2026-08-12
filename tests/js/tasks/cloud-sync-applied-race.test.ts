import { beforeEach, expect, it, vi } from "vitest";

const userId = "00000000-0000-0000-0000-000000000073";
let state: {
  positionStatus: string;
  application: {
    status: string;
    applied: boolean;
    applied_at: string | null;
    applied_via: string | null;
  };
};
let applicationReached: () => void;
let applicationAtBarrier: Promise<void>;
let releaseApplication: () => void;
let applicationRelease: Promise<void>;

function resetState() {
  state = {
    positionStatus: "ready",
    application: {
      status: "draft",
      applied: false,
      applied_at: null,
      applied_via: null,
    },
  };
  applicationAtBarrier = new Promise((resolve) => {
    applicationReached = resolve;
  });
  applicationRelease = new Promise((resolve) => {
    releaseApplication = resolve;
  });
}

resetState();

function fakeSupabase() {
  return {
    from(table: string) {
      let operation = "select";
      let payload: any = null;
      const builder: Record<string, any> = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        in() {
          return builder;
        },
        update(value: any) {
          operation = "update";
          payload = value;
          return builder;
        },
        upsert(value: any) {
          operation = "upsert";
          payload = value;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then(ok: (value: any) => unknown, ko?: (error: unknown) => unknown) {
          const finish = async () => {
            if (operation === "upsert" && table === "positions") {
              const row = payload[0];
              if (Object.hasOwn(row, "status"))
                state.positionStatus = row.status;
              return {
                data: [{ id: "position-uuid-73", legacy_id: 73 }],
                error: null,
              };
            }
            return { data: null, error: null };
          };
          return finish().then(ok, ko);
        },
      };
      return builder;
    },
    rpc: vi.fn(async (name: string, args: Record<string, any>) => {
      if (name === "sync_upsert_applications") {
        applicationReached();
        await applicationRelease;
        const row = args.p_applications[0];
        if (
          state.positionStatus === "applied" &&
          (row.status !== "applied" ||
            row.applied !== true ||
            row.applied_at == null ||
            !row.applied_via)
        ) {
          return {
            data: null,
            error: { message: "stale_application_downgrade" },
          };
        }
        state.application = {
          status: row.status,
          applied: row.applied,
          applied_at: row.applied_at,
          applied_via: row.applied_via,
        };
        return { data: 1, error: null };
      }
      if (name === "mark_position_applied") {
        state.application = {
          status: "applied",
          applied: true,
          applied_at: args.p_applied_at,
          applied_via: args.p_applied_via,
        };
        state.positionStatus = "applied";
        return {
          data: {
            id: "73",
            status: "applied",
            applied_at: args.p_applied_at,
            applied_via: args.p_applied_via,
          },
          error: null,
        };
      }
      return { data: 1, error: null };
    }),
  };
}

let supabase = fakeSupabase();

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: vi.fn(async () => ({
    ok: true,
    data: { userId, tokenId: "synthetic-token-id", admin: supabase },
  })),
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: vi.fn(async () => ({
    allowed: true,
    retryAfterSec: 0,
  })),
}));
vi.mock("@/lib/cloud-sync/onboarding-milestones", () => ({
  teamProducedWork: vi.fn(() => false),
  firstTeamRunPatch: vi.fn(() => null),
}));
vi.mock("@/lib/team-state/sync-freshness", () => ({
  syncRequestIsPending: vi.fn(() => false),
}));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/demo/data", () => ({ isDemoLegacyId: vi.fn(() => false) }));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: vi.fn(async () => null),
}));
vi.mock("@/lib/positions/local-first-write", () => ({
  localFirstWrite: vi.fn(async (_req: Request, spec: any) => {
    const result = await spec.cloud(supabase, userId);
    if (!result.ok)
      return Response.json(result.body, { status: result.status });
    return Response.json(result.outcome);
  }),
}));

const { POST: pushPost } = await import("@/app/api/cloud-sync/push/route");
const { POST: markPost } =
  await import("@/app/api/positions/[legacyId]/mark-applied/route");

beforeEach(() => {
  resetState();
  supabase = fakeSupabase();
});

it("rifiuta il push stale che arriva dopo una mark concorrente", async () => {
  const stalePush = pushPost(
    new Request("http://localhost/api/cloud-sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        positions: [
          { id: 73, title: "Synthetic", company: "Example", status: "ready" },
        ],
        applications: [{ position_id: 73, status: "draft", applied: false }],
      }),
    }) as any,
  );

  await applicationAtBarrier;
  const marked = await markPost(
    new Request("http://localhost/positions/73/mark-applied", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }) as any,
    { params: Promise.resolve({ legacyId: "73" }) },
  );
  expect(marked.status).toBe(200);

  releaseApplication();
  const pushed = await stalePush;
  expect(pushed.status).toBe(500);
  expect(await pushed.json()).toMatchObject({
    error: "applications_upsert_failed",
  });
  expect(state).toEqual({
    positionStatus: "applied",
    application: expect.objectContaining({
      status: "applied",
      applied: true,
      applied_at: expect.any(String),
      applied_via: "user_manual",
    }),
  });
});
