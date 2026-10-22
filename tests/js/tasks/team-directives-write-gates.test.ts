import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The standing orders to the captain command the team. Phase 4 (single door, migration 101): the website
// writes them too, through the door, with the confirmation in two steps; before reading the request it
// applies the strict origin rule of the door's L2 actions. Outside the website (the desktop, the box) the
// writes keep requireDesktopWrite. Reading stays open. The position notes that travel to the box as async
// requests stay in the requireLocalWrite lane (the sentence in web/lib/auth.ts says why).
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
const request = (headers: Record<string, string> = {}) =>
  ({ json: mocks.json, headers: new Headers(headers), cookies: { get: () => undefined } }) as never;

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
    it(`${method} on the cloud deploy refuses a request without the site's origin, with a valid session, before the body`, async () => {
      vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
      vi.doMock("@/lib/workspace", () => ({ isSupabaseConfigured: false }));
      vi.doMock("@/lib/auth", async (importOriginal) => ({
        ...(await importOriginal<typeof import("@/lib/auth")>()),
        requireAuth: mocks.requireAuth.mockResolvedValue(null),
      }));
      const route = await import("@/app/api/team-directives/route");
      for (const headers of [
        {},
        { origin: "https://evil.example", "content-type": "application/json" },
        { origin: "https://app.example.test", "sec-fetch-site": "cross-site", "content-type": "application/json" },
      ]) {
        const response = await route[method](request(headers));
        expect(response.status, JSON.stringify(headers)).toBeGreaterThanOrEqual(403);
        expect(["origin_required", "origin_not_allowed", "cross_site", "origin_not_configured"]).toContain(
          (await response.json()).error,
        );
      }
      expect(mocks.json).not.toHaveBeenCalled();
    });
  }

  it("asks for the session first: no session, 401", async () => {
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
    vi.doMock("@/lib/auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/auth")>()),
      requireAuth: mocks.requireAuth.mockResolvedValue(new Response("{}", { status: 401 })),
    }));
    const route = await import("@/app/api/team-directives/route");
    expect((await route.POST(request())).status).toBe(401);
    expect((await route.PATCH(request())).status).toBe(401);
    expect(mocks.json).not.toHaveBeenCalled();
  });

  it("the gates stand after requireAuth and before the body in POST and PATCH, and never in GET", () => {
    const route = read("web/app/api/team-directives/route.ts");
    expect(route).toContain('import { requireAuth, requireDesktopWrite } from "@/lib/auth"');
    for (const method of ["POST", "PATCH"]) {
      const start = route.indexOf(`export async function ${method}(`);
      const head = route.slice(start, start + 600);
      const auth = head.indexOf("requireAuth()");
      const body = head.indexOf("req.json()");
      expect(auth).toBeGreaterThan(-1);
      // on the website: the strict origin rule; elsewhere: requireDesktopWrite. Both before the body.
      expect(head.indexOf("siteEntryRefusal(req)")).toBeGreaterThan(auth);
      expect(head.indexOf("requireDesktopWrite()")).toBeGreaterThan(auth);
      expect(head.indexOf("siteEntryRefusal(req)")).toBeLessThan(body);
      expect(head.indexOf("requireDesktopWrite()")).toBeLessThan(body);
    }
    const get = route.slice(route.indexOf("export async function GET("), route.indexOf("export async function POST("));
    expect(get).not.toContain("requireDesktopWrite");
    expect(get).not.toContain("siteEntryRefusal");
  });

  it("on the website the old RPC of 079 is never the fallback: no door, no write", () => {
    const route = read("web/app/api/team-directives/route.ts");
    const door = route.slice(route.indexOf("async function viaDoor("), route.indexOf("// ── GET"));
    const missing = door.slice(door.indexOf('door.kind === "door_missing"'), door.indexOf('door.kind === "failed"'));
    expect(missing).toContain("isCloudDeploy()");
    expect(missing).toContain("not_available_yet");
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
