import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// JHT-T46 follow-up: the standing orders to the captain command the team, so the website (cloud deploy)
// cannot write them even with a valid session: POST and PATCH answer 403 read_only before reading the
// request. Reading stays open. The position notes that travel to the box as async requests stay in the
// requireLocalWrite lane (the sentence in web/lib/auth.ts says why).
const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), json: vi.fn() }));

vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: vi.fn(() => {
    throw new Error("the cloud path must not run");
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.example.test" }),
  cookies: async () => ({ get: () => undefined }),
}));

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const request = () =>
  ({ json: mocks.json, headers: new Headers(), cookies: { get: () => undefined } }) as never;

beforeEach(() => {
  vi.resetModules();
  mocks.requireAuth.mockReset();
  mocks.json.mockReset();
  mocks.json.mockResolvedValue({ body: "synthetic", kind: "order", request_id: "r1", id: 1, action: "archive" });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("team-directives write on the website", () => {
  for (const method of ["POST", "PATCH"] as const) {
    it(`${method} answers 403 read_only on the cloud deploy, with a valid session, before the body`, async () => {
      vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
      vi.doMock("@/lib/workspace", () => ({ isSupabaseConfigured: false }));
      vi.doMock("@/lib/auth", async (importOriginal) => ({
        ...(await importOriginal<typeof import("@/lib/auth")>()),
        requireAuth: mocks.requireAuth.mockResolvedValue(null),
      }));
      const route = await import("@/app/api/team-directives/route");
      const response = await route[method](request());
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("read_only");
      expect(mocks.requireAuth).toHaveBeenCalledTimes(1);
      expect(mocks.json).not.toHaveBeenCalled();
    });
  }

  it("asks for the session first: no session, 401, not the desktop wording", async () => {
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
    vi.doMock("@/lib/auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/auth")>()),
      requireAuth: mocks.requireAuth.mockResolvedValue(new Response("{}", { status: 401 })),
    }));
    const route = await import("@/app/api/team-directives/route");
    expect((await route.POST(request())).status).toBe(401);
    expect((await route.PATCH(request())).status).toBe(401);
  });

  it("the gate stands after requireAuth in POST and PATCH and never in GET", () => {
    const route = read("web/app/api/team-directives/route.ts");
    expect(route).toContain('import { requireAuth, requireDesktopWrite } from "@/lib/auth"');
    for (const method of ["POST", "PATCH"]) {
      const start = route.indexOf(`export async function ${method}(`);
      const head = route.slice(start, start + 500);
      expect(head.indexOf("requireAuth()")).toBeGreaterThan(-1);
      expect(head.indexOf("requireDesktopWrite()")).toBeGreaterThan(head.indexOf("requireAuth()"));
      expect(head.indexOf("requireDesktopWrite()")).toBeLessThan(head.indexOf("req.json()"));
    }
    const get = route.slice(route.indexOf("export async function GET("), route.indexOf("export async function POST("));
    expect(get).not.toContain("requireDesktopWrite");
  });
});

describe("the lane of the async position requests", () => {
  const LANE = [
    "feedback",
    "ticket",
    "write-request",
    "geocode-request",
    "recheck-request",
    "user-exclude",
    "mark-applied",
    "outcome",
    "user-note",
  ];

  it.each(LANE)("%s stays reachable from the website: no desktop-only gate", (name) => {
    const route = read(`web/app/api/positions/[legacyId]/${name}/route.ts`);
    expect(route).not.toContain("requireLocalWrite");
    expect(route).not.toContain("requireDesktopWrite");
  });

  it("the doc of requireLocalWrite names mark-applied, outcome and user-note as lane, with the reason", () => {
    const auth = read("web/lib/auth.ts");
    const doc = auth.slice(auth.indexOf("NON usare (restano cloud-accessibili"), auth.indexOf("export async function requireLocalWrite"));
    for (const name of ["mark-applied", "outcome", "user-note"]) expect(doc).toContain(name);
    expect(doc).toContain("mai ordinare agli agenti");
    expect(doc).toContain("requireDesktopWrite");
  });
});
