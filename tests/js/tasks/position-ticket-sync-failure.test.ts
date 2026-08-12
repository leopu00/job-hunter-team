import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const mocks = vi.hoisted(() => ({
  verifyBearerToken: vi.fn(),
  checkCloudSyncRateLimit: vi.fn(),
}));

vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: mocks.verifyBearerToken,
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: mocks.checkCloudSyncRateLimit,
}));

function updateAdmin(result: {
  data?: { id: number } | null;
  error?: { code: string; message: string } | null;
}) {
  const maybeSingle = vi.fn(async () => ({
    data: result.data ?? null,
    error: result.error ?? null,
  }));
  const select = vi.fn(() => ({ maybeSingle }));
  const userEq = vi.fn(() => ({ select }));
  const idEq = vi.fn(() => ({ eq: userEq }));
  const update = vi.fn(() => ({ eq: idEq }));
  return {
    admin: { from: vi.fn(() => ({ update })) },
    userEq,
    select,
  };
}

function updateRequest() {
  return new Request("http://localhost/api/cloud-sync/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tickets: [
        {
          local_id: 7,
          cloud_id: 70,
          position_legacy_id: 643,
          kind: "rescore",
          status: "resolved",
        },
      ],
    }),
  });
}

function partialFailureAdmin() {
  const insertSingle = vi.fn(async () => ({
    data: { id: 701 },
    error: null,
  }));
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const updateMaybeSingle = vi.fn(async () => ({
    data: null,
    error: { code: "synthetic", message: "second row failed" },
  }));
  const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
  const updateUserEq = vi.fn(() => ({ select: updateSelect }));
  const updateIdEq = vi.fn(() => ({ eq: updateUserEq }));
  const update = vi.fn(() => ({ eq: updateIdEq }));

  return { admin: { from: vi.fn(() => ({ insert, update })) } };
}

describe("ticket cloud sync fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCloudSyncRateLimit.mockResolvedValue({ allowed: true });
  });

  it("returns non-2xx when the cloud UPDATE fails", async () => {
    const fake = updateAdmin({
      error: { code: "synthetic", message: "synthetic update failure" },
    });
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: "user-a", tokenId: "device-a", admin: fake.admin },
    });
    const { POST } = await import("@/app/api/cloud-sync/tickets/route");

    const response = await POST(updateRequest() as never);

    expect(fake.userEq).toHaveBeenCalledWith("user_id", "user-a");
    expect(fake.select).toHaveBeenCalledWith("id");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "ticket_update_failed",
    });
  });

  it("returns non-2xx when UPDATE reports success but matches no row", async () => {
    const fake = updateAdmin({ data: null, error: null });
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: "user-a", tokenId: "device-a", admin: fake.admin },
    });
    const { POST } = await import("@/app/api/cloud-sync/tickets/route");

    const response = await POST(updateRequest() as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "ticket_update_not_applied",
    });
  });

  it("returns id_map entries confirmed before a later row fails", async () => {
    const fake = partialFailureAdmin();
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: "user-a", tokenId: "device-a", admin: fake.admin },
    });
    const { POST } = await import("@/app/api/cloud-sync/tickets/route");
    const request = new Request("http://localhost/api/cloud-sync/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tickets: [
          {
            local_id: 7,
            cloud_id: null,
            position_legacy_id: 643,
            request_text: "custom A",
            kind: "custom",
            status: "open",
          },
          {
            local_id: 8,
            cloud_id: 80,
            position_legacy_id: 644,
            kind: "rescore",
            status: "resolved",
          },
        ],
      }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      failed_local_id: 8,
      inserted: 1,
      id_map: { "7": 701 },
    });
  });
});

describe("ticket sync cursor", () => {
  const originalHome = process.env.JHT_HOME;
  const originalFetch = global.fetch;
  let home: string;

  beforeEach(() => {
    vi.resetModules();
    home = mkdtempSync(join(tmpdir(), "jht-ticket-sync-failure-"));
    process.env.JHT_HOME = home;
    process.exitCode = 0;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.JHT_HOME;
    else process.env.JHT_HOME = originalHome;
    process.exitCode = 0;
    rmSync(home, { recursive: true, force: true });
  });

  it("writes partial id_map but retries without reinserting A", async () => {
    const repo = join(__dirname, "../../..");
    const requireFromWeb = createRequire(join(repo, "web/package.json"));
    const Database = requireFromWeb("better-sqlite3");
    const dbPath = join(home, "jobs.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE positions (id INTEGER PRIMARY KEY);
      CREATE TABLE position_tickets (
        id INTEGER PRIMARY KEY,
        position_id INTEGER NOT NULL,
        request_text TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_agent TEXT,
        response_text TEXT,
        cloud_id INTEGER,
        created_at TEXT,
        assigned_at TEXT,
        resolved_at TEXT,
        updated_at TEXT
      );
      INSERT INTO positions (id) VALUES (643), (644);
      INSERT INTO position_tickets
        (id, position_id, request_text, kind, status, cloud_id, created_at,
         resolved_at, updated_at)
      VALUES
        (7, 643, 'custom A', 'custom', 'open', NULL,
         '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z',
         '2026-01-03T00:00:00Z'),
        (8, 644, 'rivaluta B', 'rescore', 'resolved', 80,
         '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z',
         '2026-01-03T00:00:00Z');
    `);
    db.close();

    const cursorPath = join(home, ".cloud-tickets-cursor.json");
    const initialCursor = {
      pull_since: "2026-01-01T00:00:00Z",
      push_since: "2026-01-02T00:00:00Z",
    };
    writeFileSync(cursorPath, JSON.stringify(initialCursor));
    writeFileSync(
      join(home, "cloud.json"),
      JSON.stringify({
        enabled: true,
        base_url: "https://sync.invalid",
        token: "jht_sync_synthetic_ticket_test",
      }),
    );

    const pushedBodies: Array<{
      tickets: Array<{ local_id: number; cloud_id: number | null }>;
    }> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/cloud-sync/tickets?")) {
          return new Response(
            JSON.stringify({
              ok: true,
              tickets: [],
              cursor: initialCursor.pull_since,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        pushedBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            ok: false,
            error: "ticket_update_failed",
            failed_local_id: 8,
            inserted: pushedBodies.length === 1 ? 1 : 0,
            id_map: pushedBodies.length === 1 ? { "7": 701 } : {},
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    global.fetch = fetchMock as typeof fetch;

    const { handleTicketSync } =
      await import("../../../cli/src/commands/cloud.js");
    await handleTicketSync({ db: dbPath, silent: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(cursorPath, "utf8"))).toEqual(initialCursor);
    const correlatedDb = new Database(dbPath);
    const correlated = correlatedDb
      .prepare("SELECT cloud_id FROM position_tickets WHERE id = 7")
      .get() as { cloud_id: number };
    correlatedDb.close();
    expect(correlated.cloud_id).toBe(701);

    await handleTicketSync({ db: dbPath, silent: true });

    expect(pushedBodies).toHaveLength(2);
    expect(
      pushedBodies[0].tickets.find((row) => row.local_id === 7)?.cloud_id,
    ).toBeNull();
    expect(
      pushedBodies[1].tickets.find((row) => row.local_id === 7)?.cloud_id,
    ).toBe(701);
    expect(JSON.parse(readFileSync(cursorPath, "utf8"))).toEqual(initialCursor);
  });
});
