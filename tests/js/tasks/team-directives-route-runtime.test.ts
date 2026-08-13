import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ dbPath: "" }));

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/deploy-mode", () => ({ isCloudDeploy: () => false }));
vi.mock("@/lib/jht-paths", () => ({
  get JHT_DB_PATH() {
    return state.dbPath;
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => new Map()) }));
vi.mock("@/lib/local-token", () => ({
  LOCAL_TOKEN_COOKIE: "jht-local-token",
  isLocalTokenAuthenticated: () => false,
}));
vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: vi.fn(() => {
    throw new Error("cloud path must not run");
  }),
}));

const root = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(root, "web/package.json"));
const Database = requireFromWeb(
  "better-sqlite3",
) as typeof import("better-sqlite3");
const temporary = mkdtempSync(join(tmpdir(), "jht-o80-route-"));

describe("team directives route public runtime errors", () => {
  beforeAll(async () => {
    state.dbPath = join(temporary, "jobs.db");
    const db = new Database(state.dbPath);
    const helper = await import("@/lib/team-directives-local");
    helper.ensureLocalDirectiveMutationSchema(db);
    db.exec(`
      CREATE TRIGGER expose_nothing BEFORE INSERT ON pending_user_messages
      BEGIN
        SELECT RAISE(ABORT,
          '/synthetic/private/path session=synth-session token=synth-token');
      END;
    `);
    db.close();
  });

  afterAll(() => rmSync(temporary, { recursive: true }));

  it("turns a real SQLite exception into a stable response without raw data", async () => {
    const { POST } = await import("@/app/api/team-directives/route");
    const response = await POST(
      new Request("http://localhost/api/team-directives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: "synthetic directive",
          kind: "order",
          request_id: "runtime-error",
        }),
      }) as never,
    );
    expect(response.status).toBe(503);
    const publicBody = await response.json();
    expect(publicBody).toEqual({ error: "directive_not_queued" });
    expect(JSON.stringify(publicBody)).not.toMatch(
      /synthetic\/private|synth-session|synth-token/,
    );
  });
});
