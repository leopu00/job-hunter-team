import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  verifyBearerToken: vi.fn(),
  requireAuth: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: boundary.verifyBearerToken,
}));
vi.mock("@/lib/auth", () => ({ requireAuth: boundary.requireAuth }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: boundary.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: boundary.createAdminClient,
}));

import { GET as downloadFile } from "@/app/api/profile/files/request/[id]/route";
import { POST as createFileRequest } from "@/app/api/profile/files/request/route";
import { PATCH as transitionFile } from "@/app/api/cloud-sync/file-bridge/[id]/route";
import { POST as purgeFiles } from "@/app/api/cloud-sync/file-bridge/purge/route";
import {
  canonicalFileBridgeStoragePath,
  fileBridgeDownloadName,
} from "@/lib/file-bridge-storage";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST_A = "11111111-1111-4111-8111-111111111111";
const REQUEST_B = "22222222-2222-4222-8222-222222222222";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(repo, relative), "utf8");
}

function request(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sessionClient(
  userId: string,
  row: Record<string, unknown> | null,
) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: userId } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: row, error: null })),
        })),
      })),
    })),
  };
}

function downloadAdmin(objects: Array<{ name: string; id: string | null }>) {
  const listed: string[] = [];
  const signed: string[] = [];
  const servedFilters: Array<[string, string]> = [];
  const storage = {
    list: vi.fn(async (prefix: string) => {
      listed.push(prefix);
      return { data: objects, error: null };
    }),
    createSignedUrl: vi.fn(async (objectPath: string) => {
      signed.push(objectPath);
      return { data: { signedUrl: "https://signed.invalid/object" }, error: null };
    }),
  };
  const admin = {
    storage: { from: vi.fn(() => storage) },
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => {
          servedFilters.push([column, value]);
          return {
            eq: vi.fn((nextColumn: string, nextValue: string) => {
              servedFilters.push([nextColumn, nextValue]);
              return Promise.resolve({ error: null });
            }),
          };
        }),
      })),
    })),
  };
  return { admin, listed, signed, servedFilters };
}

function purgeAdmin(
  rows: Array<Record<string, unknown>>,
  objectsByPrefix: Record<string, Array<{ name: string; id: string | null }>>,
  opts: { removeLeavesObjects?: boolean; updateError?: boolean } = {},
) {
  const listed: string[] = [];
  const removed: string[][] = [];
  const updateFilters: Array<[string, unknown]> = [];
  const storage = {
    list: vi.fn(async (prefix: string) => {
      listed.push(prefix);
      return { data: objectsByPrefix[prefix] ?? [], error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(paths);
      if (!opts.removeLeavesObjects) {
        for (const objectPath of paths) {
          const slash = objectPath.lastIndexOf("/");
          const prefix = objectPath.slice(0, slash);
          const name = objectPath.slice(slash + 1);
          objectsByPrefix[prefix] = (objectsByPrefix[prefix] ?? []).filter(
            (object) => object.name !== name,
          );
        }
      }
      return { data: paths.map((name) => ({ name })), error: null };
    }),
  };
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    not: vi.fn(() => query),
    lt: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  };
  const update = {
    in: vi.fn((column: string, value: unknown) => {
      updateFilters.push([column, value]);
      return {
        eq: vi.fn((nextColumn: string, nextValue: unknown) => {
          updateFilters.push([nextColumn, nextValue]);
          return Promise.resolve({
            error: opts.updateError ? { message: "synthetic db detail" } : null,
          });
        }),
      };
    }),
  };
  const admin = {
    storage: { from: vi.fn(() => storage) },
    from: vi.fn(() => ({
      ...query,
      update: vi.fn(() => update),
    })),
  };
  return { admin, listed, removed, updateFilters };
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.requireAuth.mockResolvedValue(null);
});

describe("migration 062: feedback reports are not browser-readable", () => {
  const migration = read(
    "supabase/migrations/062_feedback_and_file_bridge_authority.sql",
  );
  const feedbackGuard = migration.match(
    /if\s+to_regclass\('public\.feedback_tickets'\)\s+is\s+not\s+null\s+then([\s\S]*?)end\s+if;/i,
  )?.[1];
  const feedbackRevoke = migration.match(
    /revoke\s+select\s+on\s+table\s+public\.feedback_tickets\s+from\s+([^;]+);/i,
  )?.[1];

  it("continues when feedback_tickets is absent without recreating it", () => {
    expect(feedbackGuard).toBeTruthy();
    expect(migration).not.toMatch(
      /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.feedback_tickets/i,
    );

    const outsideGuard = migration.replace(feedbackGuard ?? "", "");
    expect(outsideGuard).not.toMatch(
      /(?:lock|alter)\s+table\s+public\.feedback_tickets/i,
    );
    expect(outsideGuard).not.toMatch(
      /(?:revoke|grant)\s+[\s\S]*?on\s+table\s+public\.feedback_tickets/i,
    );
    expect(outsideGuard).not.toMatch(
      /drop\s+policy[\s\S]*?on\s+public\.feedback_tickets/i,
    );
  });

  it.each(["anon", "authenticated"])(
    "%s has no SELECT grant, including a foreign authenticated user",
    (role) => {
      expect(feedbackRevoke?.toLowerCase()).toContain(role);
      expect(migration).not.toMatch(
        new RegExp(
          `grant\\s+select\\s+on\\s+table\\s+public\\.feedback_tickets\\s+to\\s+${role}`,
          "i",
        ),
      );
    },
  );

  it("removes every SELECT/FOR ALL policy while retaining historical rows", () => {
    expect(feedbackGuard).toContain("cmd in ('SELECT', 'ALL')");
    expect(feedbackGuard).toMatch(
      /grant\s+select\s+on\s+table\s+public\.feedback_tickets\s+to\s+service_role/i,
    );
    expect(migration).not.toMatch(
      /(?:delete|truncate)\s+(?:from\s+)?public\.feedback_tickets/i,
    );
  });
});

describe("file bridge authority", () => {
  it("uses only authenticated UUIDs and a constant Storage leaf", () => {
    expect(canonicalFileBridgeStoragePath(USER_A, REQUEST_A)).toBe(
      `${USER_A}/${REQUEST_A}/payload`,
    );
    expect(() => canonicalFileBridgeStoragePath(USER_A, "../victim")).toThrow(
      "invalid_file_bridge_identity",
    );
    expect(fileBridgeDownloadName("../../private\\cv.pdf\u0000")).toBe(
      "cv.pdf",
    );
  });

  it("schema generates storage_path and browser INSERT cannot provide it", () => {
    const migration = read(
      "supabase/migrations/062_feedback_and_file_bridge_authority.sql",
    );
    expect(migration).toMatch(
      /storage_path\s+text\s+generated\s+always\s+as\s*\([\s\S]*user_id::text[\s\S]*id::text[\s\S]*'\/payload'[\s\S]*\)\s+stored/i,
    );
    expect(migration).toMatch(
      /grant\s+insert\s*\(user_id,\s*file_name\)[\s\S]*to\s+authenticated/i,
    );
    expect(migration).not.toMatch(
      /grant\s+insert\s*\([^)]*storage_path/i,
    );
  });

  it("signed download ignores a forged cross-user path", async () => {
    boundary.createClient.mockResolvedValue(
      sessionClient(USER_A, {
        id: REQUEST_A,
        file_name: "legacy.pdf",
        status: "ready",
        storage_path: `${USER_B}/${REQUEST_B}/secret.pdf`,
        error: null,
      }),
    );
    const fake = downloadAdmin([{ name: "legacy.pdf", id: "object" }]);
    boundary.createAdminClient.mockReturnValue(fake.admin);

    const response = await downloadFile(
      request("GET", `http://localhost/api/profile/files/request/${REQUEST_A}`) as never,
      { params: Promise.resolve({ id: REQUEST_A }) },
    );

    expect(response.status).toBe(200);
    expect(fake.listed).toEqual([`${USER_A}/${REQUEST_A}`]);
    expect(fake.signed).toEqual([`${USER_A}/${REQUEST_A}/legacy.pdf`]);
    expect(JSON.stringify(fake.signed)).not.toContain(USER_B);
    expect(fake.servedFilters).toContainEqual(["user_id", USER_A]);
  });

  it.each([
    ["zero objects", [], 409],
    [
      "multiple legacy objects",
      [
        { name: "one.pdf", id: "one" },
        { name: "two.pdf", id: "two" },
      ],
      500,
    ],
    ["a directory", [{ name: "nested", id: null }], 500],
    ["an invalid object name", [{ name: "../secret", id: "object" }], 500],
  ])("download fails closed for %s", async (_case, objects, status) => {
    boundary.createClient.mockResolvedValue(
      sessionClient(USER_A, {
        id: REQUEST_A,
        file_name: "cv.pdf",
        status: "ready",
        error: null,
      }),
    );
    const fake = downloadAdmin(objects);
    boundary.createAdminClient.mockReturnValue(fake.admin);

    const response = await downloadFile(
      request("GET", `http://localhost/api/profile/files/request/${REQUEST_A}`) as never,
      { params: Promise.resolve({ id: REQUEST_A }) },
    );

    expect(response.status).toBe(status);
    expect(fake.signed).toEqual([]);
  });

  it("a foreign session cannot reach Storage through another user's request", async () => {
    boundary.createClient.mockResolvedValue(sessionClient(USER_B, null));
    const fake = downloadAdmin([{ name: "secret.pdf", id: "object" }]);
    boundary.createAdminClient.mockReturnValue(fake.admin);

    const response = await downloadFile(
      request("GET", `http://localhost/api/profile/files/request/${REQUEST_A}`) as never,
      { params: Promise.resolve({ id: REQUEST_A }) },
    );

    expect(response.status).toBe(404);
    expect(fake.listed).toEqual([]);
    expect(fake.signed).toEqual([]);
  });

  it("purge ignores forged row paths and removes only the token owner's prefix", async () => {
    const fake = purgeAdmin(
      [
        {
          id: REQUEST_A,
          storage_path: `${USER_B}/${REQUEST_B}/secret.pdf`,
        },
      ],
      {
        [`${USER_A}/${REQUEST_A}`]: [{ name: "legacy.pdf", id: "object" }],
      },
    );
    boundary.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: USER_A, admin: fake.admin },
    });

    const response = await purgeFiles(
      request("POST", "http://localhost/api/cloud-sync/file-bridge/purge") as never,
    );

    expect(response.status).toBe(200);
    expect(fake.listed).toEqual([
      `${USER_A}/${REQUEST_A}`,
      `${USER_A}/${REQUEST_A}`,
    ]);
    expect(fake.removed).toEqual([[`${USER_A}/${REQUEST_A}/legacy.pdf`]]);
    expect(JSON.stringify(fake.removed)).not.toContain(USER_B);
    expect(fake.updateFilters).toContainEqual(["user_id", USER_A]);
  });

  it("the second identity purges only its own canonical namespace", async () => {
    const fake = purgeAdmin(
      [{ id: REQUEST_B }],
      {
        [`${USER_B}/${REQUEST_B}`]: [{ name: "payload", id: "object" }],
      },
    );
    boundary.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: USER_B, admin: fake.admin },
    });

    const response = await purgeFiles(
      request("POST", "http://localhost/api/cloud-sync/file-bridge/purge") as never,
    );

    expect(response.status).toBe(200);
    expect(fake.removed).toEqual([[`${USER_B}/${REQUEST_B}/payload`]]);
    expect(JSON.stringify(fake.removed)).not.toContain(USER_A);
  });

  it("purge does not report success when Storage leaves the object behind", async () => {
    const prefix = `${USER_A}/${REQUEST_A}`;
    const fake = purgeAdmin(
      [{ id: REQUEST_A }],
      { [prefix]: [{ name: "payload", id: "object" }] },
      { removeLeavesObjects: true },
    );
    boundary.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: USER_A, admin: fake.admin },
    });

    const response = await purgeFiles(
      request("POST", "http://localhost/api/cloud-sync/file-bridge/purge") as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "storage_remove_incomplete",
    });
    expect(fake.updateFilters).toEqual([]);
  });

  it("purge reports a database transition failure without provider text", async () => {
    const prefix = `${USER_A}/${REQUEST_A}`;
    const fake = purgeAdmin(
      [{ id: REQUEST_A }],
      { [prefix]: [{ name: "payload", id: "object" }] },
      { updateError: true },
    );
    boundary.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: USER_A, admin: fake.admin },
    });

    const response = await purgeFiles(
      request("POST", "http://localhost/api/cloud-sync/file-bridge/purge") as never,
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("purge_state_update_failed");
    expect(body).not.toContain("synthetic db detail");
  });

  it("browser creation sends only the two columns granted by migration 062", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    boundary.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_A } } })),
      },
      from: vi.fn(() => ({
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserted.push(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: REQUEST_A },
                error: null,
              })),
            })),
          };
        }),
      })),
    });

    const response = await createFileRequest(
      request("POST", "http://localhost/api/profile/files/request", {
        name: "cv.pdf",
        id: REQUEST_B,
        status: "ready",
        storage_path: `${USER_B}/${REQUEST_B}/secret.pdf`,
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(inserted).toEqual([{ user_id: USER_A, file_name: "cv.pdf" }]);
  });

  it("upload signing derives payload path despite a traversal filename", async () => {
    const signed: string[] = [];
    const readChain = {
      select: vi.fn(() => readChain),
      eq: vi.fn(() => readChain),
      maybeSingle: vi
        .fn()
        .mockResolvedValueOnce({
          data: { id: REQUEST_A, file_name: "../../secret.pdf", status: "pending" },
          error: null,
        })
        .mockResolvedValueOnce({ data: { id: REQUEST_A }, error: null }),
      update: vi.fn(() => readChain),
    };
    const admin = {
      from: vi.fn(() => readChain),
      storage: {
        from: vi.fn(() => ({
          createSignedUploadUrl: vi.fn(async (objectPath: string) => {
            signed.push(objectPath);
            return {
              data: { signedUrl: "https://signed.invalid/upload", token: "synthetic" },
              error: null,
            };
          }),
        })),
      },
    };
    boundary.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: USER_A, admin },
    });

    const response = await transitionFile(
      request(
        "PATCH",
        `http://localhost/api/cloud-sync/file-bridge/${REQUEST_A}`,
        { status: "uploading" },
      ) as never,
      { params: Promise.resolve({ id: REQUEST_A }) },
    );

    expect(response.status).toBe(200);
    expect(signed).toEqual([`${USER_A}/${REQUEST_A}/payload`]);
  });

  it("ready is a compare-and-set transition from uploading", async () => {
    const transitionFilters: Array<[string, unknown]> = [];
    const read = {
      select: vi.fn(() => read),
      eq: vi.fn(() => read),
      maybeSingle: vi.fn(async () => ({
        data: { id: REQUEST_A, file_name: "cv.pdf", status: "pending" },
        error: null,
      })),
    };
    const transition = {
      update: vi.fn(() => transition),
      eq: vi.fn((column: string, value: unknown) => {
        transitionFilters.push([column, value]);
        return transition;
      }),
      in: vi.fn(() => transition),
      select: vi.fn(() => transition),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    const admin = {
      from: vi.fn().mockReturnValueOnce(read).mockReturnValueOnce(transition),
    };
    boundary.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: USER_A, admin },
    });

    const response = await transitionFile(
      request(
        "PATCH",
        `http://localhost/api/cloud-sync/file-bridge/${REQUEST_A}`,
        { status: "ready" },
      ) as never,
      { params: Promise.resolve({ id: REQUEST_A }) },
    );

    expect(response.status).toBe(409);
    expect(transitionFilters).toContainEqual(["status", "uploading"]);
  });
});
