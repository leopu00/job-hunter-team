/**
 * `/api/backup` and the runner that is not in the repository.
 *
 * The route imports `shared/backup/runner.ts`, which does not exist: creating
 * and restoring failed with a 500 (or, with the default sources, a 400 about
 * sources that were never going to be saved). Now both say plainly that the
 * site cannot do it, with a 501 and a code, and the real backup is elsewhere
 * (the desktop app, `jht backup create`). Listing and deleting the catalog
 * keep working. Synthetic: a temporary folder as JHT_HOME.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const { NextRequest } = createRequire(path.join(ROOT, "web/package.json"))("next/server") as typeof import("next/server");

const state = vi.hoisted(() => ({ home: "" }));

vi.mock("@/lib/jht-paths", () => ({
  get JHT_HOME() {
    return state.home;
  },
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAuth: async () => null,
  requireLocalMachine: () => null,
}));
vi.mock("@/lib/team-bus", () => ({ blockIfRemote: async () => null }));

const temporary = mkdtempSync(path.join(tmpdir(), "jht-backup-route-"));

function request(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function route() {
  vi.resetModules();
  return import("@/app/api/backup/route");
}

beforeAll(() => {
  state.home = temporary;
  mkdirSync(path.join(temporary, "backups"), { recursive: true });
  const archive = path.join(temporary, "backups", "bk1.tar.gz");
  writeFileSync(archive, "x");
  writeFileSync(
    path.join(temporary, "backups", "catalog.json"),
    JSON.stringify([{ id: "bk1", createdAt: 1, sizeBytes: 1, sources: [], compressed: true, archivePath: archive }]),
  );
});

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe("the site without a backup runner", () => {
  it("the runner is really not there (the test rests on it)", () => {
    expect(existsSync(path.join(ROOT, "shared", "backup", "runner.ts"))).toBe(false);
  });

  it.each([
    ["create with the default sources", "POST", "http://localhost:3001/api/backup", {}],
    ["create with a source of its own", "POST", "http://localhost:3001/api/backup", { sources: [path.join(tmpdir())] }],
    ["restore", "PATCH", "http://localhost:3001/api/backup?id=bk1", undefined],
  ])("%s: a 501 with a code, never a 500 or a 400", async (_case, method, url, body) => {
    const mod = await route();
    const handler = method === "POST" ? mod.POST : mod.PATCH;
    const res = await handler(request(method, url, body));
    expect(res.status).toBe(501);
    const answer = await res.json();
    expect(answer.code).toBe("backup_unavailable");
    expect(answer.error).toContain("jht backup create");
    expect(JSON.stringify(answer)).not.toContain(temporary);
  });

  it("the catalog still lists and deletes", async () => {
    const mod = await route();
    const list = await mod.GET(request("GET", "http://localhost:3001/api/backup"));
    expect(list.status).toBe(200);
    expect((await list.json()).count).toBe(1);
    const del = await mod.DELETE(request("DELETE", "http://localhost:3001/api/backup?id=bk1"));
    expect(del.status).toBe(200);
  });
});
