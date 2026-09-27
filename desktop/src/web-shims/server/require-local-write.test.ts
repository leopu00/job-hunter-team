// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The requireLocalWrite stand-in answers with a team wording ("I comandi al
// team dalla desktop sono in arrivo."), true only because /api/team/send is
// the one desktop route that reaches it. If another web route run by the
// desktop starts using requireLocalWrite, this fails: the text must be
// revisited for it.
const src = fileURLToPath(new URL("../..", import.meta.url));
const repo = fileURLToPath(new URL("../../../../", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("routes that reach requireLocalWrite in the desktop", () => {
  it("are only /api/team/send", () => {
    const routes = new Set<string>();
    for (const file of files(src)) {
      for (const m of readFileSync(file, "utf-8").matchAll(/from "@\/app\/api\/([^"]+)\/route"/g)) routes.add(m[1]);
    }
    expect(routes.size).toBeGreaterThan(10);
    const reaching = [...routes].filter((r) =>
      readFileSync(join(repo, "web/app/api", r, "route.ts"), "utf-8").includes("requireLocalWrite"),
    );
    expect(reaching).toEqual(["team/send"]);
  });
});
