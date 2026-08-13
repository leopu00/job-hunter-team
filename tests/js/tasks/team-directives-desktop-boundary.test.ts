import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(__dirname, "../../..");
const desktopRoot = join(root, "desktop/app-payload/web");
const temporary = mkdtempSync(join(tmpdir(), "jht-o80-desktop-boundary-"));
const previousJhtHome = process.env.JHT_HOME;
const previousJhtDb = process.env.JHT_DB;
process.env.JHT_HOME = temporary;
delete process.env.JHT_DB;
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));

const requireFromWeb = createRequire(join(root, "web/package.json"));
const Database = requireFromWeb(
  "better-sqlite3",
) as typeof import("better-sqlite3");
const boundaryPath = join(desktopRoot, "lib/desktop-api-boundary.ts");
const routePath = join(
  desktopRoot,
  "app/api/team-directives/route.ts",
);

describe("desktop directive API boundary", () => {
  let dbPath: string;

  beforeAll(async () => {
    const boundary = await import(pathToFileURL(boundaryPath).href);
    dbPath = boundary.resolveDesktopDbPath(process.env, temporary);
    const helper = await import("@/lib/team-directives-local");
    const db = new Database(dbPath);
    helper.ensureLocalDirectiveMutationSchema(db);
    db.close();
  });

  afterAll(() => {
    if (previousJhtHome === undefined) delete process.env.JHT_HOME;
    else process.env.JHT_HOME = previousJhtHome;
    if (previousJhtDb === undefined) delete process.env.JHT_DB;
    else process.env.JHT_DB = previousJhtDb;
    rmSync(temporary, { recursive: true });
  });

  it("rejects a network host before reading the local database", async () => {
    const { GET } = await import(pathToFileURL(routePath).href);
    const response = await GET(
      new Request("http://workstation.lan/api/team-directives", {
        headers: { host: "workstation.lan" },
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("writes the canonical JHT_HOME/jobs.db from loopback", async () => {
    const { POST } = await import(pathToFileURL(routePath).href);
    const response = await POST(
      new Request("http://localhost:3000/api/team-directives", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: "canonical desktop row",
          kind: "order",
          request_id: "desktop-canonical-path",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const db = new Database(dbPath, { readonly: true });
    expect(
      db.prepare("SELECT body FROM team_directives").get(),
    ).toEqual({ body: "canonical desktop row" });
    db.close();
    expect(dbPath).toBe(join(temporary, "jobs.db"));
  });

  it("rejects a hostile CORS-simple JSON body without any database effect", async () => {
    const { POST } = await import(pathToFileURL(routePath).href);
    const before = new Database(dbPath, { readonly: true })
      .prepare("SELECT count(*) n FROM team_directives")
      .get().n;
    const response = await POST(
      new Request("http://localhost:3000/api/team-directives", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "https://evil.example",
          "Content-Type": "text/plain",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({
          body: "must not be written",
          request_id: "csrf-simple-request",
        }),
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
    const verification = new Database(dbPath, { readonly: true });
    expect(
      verification.prepare("SELECT count(*) n FROM team_directives").get().n,
    ).toBe(before);
    expect(
      verification
        .prepare(
          "SELECT count(*) n FROM team_directive_request_ledger WHERE request_id='csrf-simple-request'",
        )
        .get().n,
    ).toBe(0);
    verification.close();
  });

  it("honors JHT_DB before JHT_HOME and rejects forwarded remote hops", async () => {
    const boundary = await import(pathToFileURL(boundaryPath).href);
    expect(
      boundary.resolveDesktopDbPath(
        { JHT_DB: "/synthetic/explicit.db", JHT_HOME: "/ignored" },
        "/home/ignored",
      ),
    ).toBe("/synthetic/explicit.db");
    expect(
      boundary.isTrustedDesktopRequest(
        new Headers({
          host: "localhost:3000",
          "x-forwarded-for": "192.0.2.40",
        }),
      ),
    ).toBe(false);
    expect(
      boundary.isAllowedDesktopBrowserRequest(
        new Headers({
          host: "localhost:3000",
          origin: "http://localhost:3000",
          "content-type": "text/plain",
        }),
        "POST",
      ),
    ).toBe(false);
  });
});
