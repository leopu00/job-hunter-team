import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireLocalWrite: vi.fn(),
  isLocalRequest: vi.fn(),
}));
const demo = vi.hoisted(() => ({
  activeDemoPersona: vi.fn(),
  isDemoLegacyId: vi.fn(),
}));
const filesystem = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
const teamAuth = vi.hoisted(() => ({ resolveUser: vi.fn() }));

vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: demo.activeDemoPersona,
}));
vi.mock("@/lib/demo/data", () => ({
  isDemoLegacyId: demo.isDemoLegacyId,
}));
vi.mock("@/lib/team-state/auth", () => teamAuth);
vi.mock("@/lib/local-token", () => ({
  LOCAL_TOKEN_COOKIE: "jht-local-token",
  isLocalTokenAuthenticated: vi.fn(() => false),
}));
vi.mock("@/lib/jht-paths", () => ({
  JHT_DB_PATH: "/should-not-be-read/demo.db",
  JHT_USER_UPLOADS_DIR: "/should-not-be-read/uploads",
}));
vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}));
vi.mock("node:fs", () => ({ default: filesystem, ...filesystem }));
vi.mock("better-sqlite3", () => ({
  default: vi.fn(() => {
    throw new Error("SQLite must not be opened by demo or denied requests");
  }),
}));

import { GET as getProfileFiles } from "@/app/api/profile/files/route";
import {
  DELETE as deleteUserExclusion,
  POST as postUserExclusion,
} from "@/app/api/positions/[legacyId]/user-exclude/route";

function deniedResponse(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function request(method: "POST" | "DELETE"): Request {
  return new Request("http://localhost/api/positions/999999/user-exclude", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify({ reason: "mismatch" }) : null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireAuth.mockResolvedValue(deniedResponse());
  demo.activeDemoPersona.mockResolvedValue(false);
  demo.isDemoLegacyId.mockReturnValue(false);
});

describe("profile files: demo fixture before the real-data auth gate", () => {
  it("serves the empty demo fixture without a session or filesystem access", async () => {
    demo.activeDemoPersona.mockResolvedValue(true);

    const response = await getProfileFiles();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      files: [],
      mode: "cloud",
    });
    expect(auth.requireAuth).not.toHaveBeenCalled();
    expect(filesystem.existsSync).not.toHaveBeenCalled();
    expect(filesystem.readdirSync).not.toHaveBeenCalled();
  });

  it("denies a non-demo request before reading the filesystem", async () => {
    const response = await getProfileFiles();

    expect(response.status).toBe(401);
    expect(auth.requireAuth).toHaveBeenCalledOnce();
    expect(filesystem.existsSync).not.toHaveBeenCalled();
    expect(filesystem.readdirSync).not.toHaveBeenCalled();
  });
});

describe("user exclusion: demo no-op before every real-data auth gate", () => {
  it.each([
    ["POST", postUserExclusion],
    ["DELETE", deleteUserExclusion],
  ] as const)(
    "serves the %s demo no-op without auth, SQLite or Supabase",
    async (method, handler) => {
      demo.activeDemoPersona.mockResolvedValue(true);
      demo.isDemoLegacyId.mockReturnValue(true);

      const response = await handler(request(method), {
        params: Promise.resolve({ legacyId: "999999" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: true,
        outcome: {
          id: "demo-999999",
          source: "cloud",
          status: method === "POST" ? "excluded" : null,
        },
      });
      expect(auth.requireAuth).not.toHaveBeenCalled();
      expect(filesystem.existsSync).not.toHaveBeenCalled();
      expect(teamAuth.resolveUser).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["POST", postUserExclusion],
    ["DELETE", deleteUserExclusion],
  ] as const)(
    "denies the %s real lane before SQLite or Supabase",
    async (method, handler) => {
      const response = await handler(request(method), {
        params: Promise.resolve({ legacyId: "42" }),
      });

      expect(response.status).toBe(401);
      expect(auth.requireAuth).toHaveBeenCalledOnce();
      expect(filesystem.existsSync).not.toHaveBeenCalled();
      expect(teamAuth.resolveUser).not.toHaveBeenCalled();
    },
  );
});
