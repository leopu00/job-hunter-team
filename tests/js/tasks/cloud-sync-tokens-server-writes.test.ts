/**
 * Migration 105 takes INSERT, UPDATE and DELETE on cloud_sync_tokens from the browser roles (the barrier that keeps a
 * device from authorising an application stands on nobody but the server writing or deleting its row). That is safe
 * only while nothing in the apps writes the table with a browser's session. This test reads the source: every write
 * to the table goes through the service role (the admin client), and nothing deletes a row from a browser or a CLI.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const SKIP = new Set(["node_modules", ".next", "target", "dist", ".git", "tests", "__tests__"]);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else if (SOURCE.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(path);
  }
  return out;
}

const WRITE = /\.from\(\s*["']cloud_sync_tokens["']\s*\)\s*\.\s*(insert|update|upsert|delete)\s*\(/g;
const SERVER_WRITERS = [
  "web/app/api/cloud-sync/tokens/route.ts",
  "web/app/api/cloud-sync/revoke/route.ts",
  "web/app/api/cloud-sync/device-confirm/route.ts",
  "web/app/api/cloud-sync/device-register/route.ts",
  "web/lib/cloud-sync/auth.ts",           // last_used_at and the client identity, with the admin client
];

describe("the writes to cloud_sync_tokens are the server's", () => {
  const files = ["web/app", "web/lib", "desktop/src", "cli/src", "shared"].flatMap((d) => {
    try {
      return walk(join(ROOT, d));
    } catch {
      return [];
    }
  });

  const writes = files.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(WRITE)].map((m) => ({ file: relative(ROOT, file), verb: m[1], text }));
  });

  it("finds the writers it knows (the census is not empty)", () => {
    expect(new Set(writes.map((w) => w.file))).toEqual(new Set(SERVER_WRITERS));
  });

  it("no one deletes a token: the revocation is an UPDATE of revoked_at, made by the server", () => {
    expect(writes.filter((w) => w.verb === "delete")).toEqual([]);
  });

  it.each(SERVER_WRITERS)("%s writes with the service role", (file) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    expect(text).toMatch(/createAdminClient/);
    // the browser-session client of the route is never the one the token write is made with
    for (const m of text.matchAll(/(\w+)\s*\.from\(\s*["']cloud_sync_tokens["']\s*\)\s*\.\s*(insert|update)/g)) {
      expect(m[1], `${file}: ${m[0]}`).not.toBe("supabase");
    }
  });

  it("nothing reaches the table's REST address with a write verb from the CLI or the shared tools", () => {
    for (const file of files.filter((f) => /^(cli|shared)\//.test(relative(ROOT, f)))) {
      const text = readFileSync(file, "utf8");
      if (!/rest\/v1\/cloud_sync_tokens/.test(text)) continue;
      expect(text, relative(ROOT, file)).not.toMatch(/(DELETE|PATCH|POST)[^\n]{0,80}rest\/v1\/cloud_sync_tokens|rest\/v1\/cloud_sync_tokens[^\n]{0,200}(DELETE|PATCH|method:\s*["']POST)/);
    }
  });
});
