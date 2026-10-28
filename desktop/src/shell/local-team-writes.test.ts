// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_TEAM_NON_GET_ALLOWED, localTeamNonGetAllowed, notInDesktop, shellApi } from "./api-bridge";
import { setLocalTeamData } from "../lib/local-team-data";
import { createClient as clientSide } from "../web-shims/server/supabase-client";
import { createClient as serverSide } from "../web-shims/server/supabase-server";

// A profile with no cloud account shows the team of this computer, which the pages only read. Three things the
// security review asked to see written down as tests: (1) every non-GET /api route the desktop runs is refused
// in that mode, so a new one is born refused; (2) each exception has its reason; (3) the mode's «signed in» is
// never an identity a route can use to pick data or a host.
const src = fileURLToPath(new URL("..", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));

// the bridge reads the page's address; a node run has no page, so it gets one
beforeEach(() => vi.stubGlobal("window", { location: { href: "http://localhost/", origin: "http://localhost" } }));
afterEach(() => {
  setLocalTeamData(null);
  vi.unstubAllGlobals();
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const sources = () => files(src).filter((file) => !/\.test\.tsx?$/.test(file));

/** Every web route the desktop runs, with the methods it exports other than GET. */
function writeRoutes(): Array<{ route: string; methods: string[] }> {
  const routes = new Set<string>();
  for (const file of files(src)) {
    for (const m of readFileSync(file, "utf-8").matchAll(/from "@\/app\/api\/([^"]+)\/route"/g)) routes.add(m[1]);
  }
  return [...routes].sort().map((route) => {
    const text = readFileSync(join(repo, "web/app/api", route, "route.ts"), "utf-8");
    const methods = [...text.matchAll(/export\s+(?:async\s+function|const)\s+(POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
    return { route, methods };
  });
}

describe("a local profile never writes through /api", () => {
  it("refuses every non-GET method of every route the desktop runs", async () => {
    const found = writeRoutes();
    expect(found.length).toBeGreaterThan(10);
    const withWrites = found.filter((entry) => entry.methods.length > 0);
    expect(withWrites.length).toBeGreaterThan(5);
    setLocalTeamData("local:abc");
    const next = vi.fn(notInDesktop);
    const api = shellApi(next);
    for (const { route, methods } of withWrites) {
      const path = `/api/${route.replace(/\[[^\]]+\]/g, "7")}`;
      for (const method of methods) {
        if (localTeamNonGetAllowed(method, path)) continue;
        const answer = await api(path, { method });
        expect(answer.status, `${method} ${path}`).toBe(403);
        expect(await answer.json(), `${method} ${path}`).toEqual({ error: "read_only" });
      }
    }
    expect(next).not.toHaveBeenCalled();
  });

  it("lists each exception with a reason, and the list is the language cookie and the three verdicts of the Swipe", () => {
    expect(Object.keys(LOCAL_TEAM_NON_GET_ALLOWED)).toEqual([
      "/api/i18n",
      "POST /api/positions/[legacyId]/feedback",
      "POST /api/positions/[legacyId]/user-exclude",
      "DELETE /api/positions/[legacyId]/user-exclude",
    ]);
    for (const [path, reason] of Object.entries(LOCAL_TEAM_NON_GET_ALLOWED)) {
      expect(reason.length, path).toBeGreaterThan(30);
    }
  });
});

describe("the verdicts of the Swipe are the only positions routes a local profile may write", () => {
  it("lets the three verdict calls through to the link that answers them, by method, and refuses the rest of the position's routes", async () => {
    setLocalTeamData("local:abc");
    const next = vi.fn(async () => new Response("{}", { status: 200 }));
    const api = shellApi(next);
    for (const [method, path] of [["POST", "/api/positions/7/feedback"], ["POST", "/api/positions/7/user-exclude"], ["DELETE", "/api/positions/7/user-exclude"]] as const) {
      expect((await api(path, { method })).status, `${method} ${path}`).toBe(200);
    }
    expect(next).toHaveBeenCalledTimes(3);
    next.mockClear();
    for (const [method, path] of [
      ["PUT", "/api/positions/7/feedback"], ["DELETE", "/api/positions/7/feedback"], ["PATCH", "/api/positions/7/user-exclude"],
      ["POST", "/api/positions/7/user-note"], ["DELETE", "/api/positions/7/user-note"], ["POST", "/api/positions/7/write-request"],
      ["POST", "/api/positions/7/apply-request"], ["POST", "/api/positions/7/recheck-request"], ["POST", "/api/positions/7/mark-applied"],
      ["POST", "/api/positions/7/ticket"], ["POST", "/api/positions/7/feedback/extra"], ["POST", "/api/positions/feedback"],
    ] as const) {
      const answer = await api(path, { method });
      expect(answer.status, `${method} ${path}`).toBe(403);
      expect(await answer.json()).toEqual({ error: "read_only" });
    }
    expect(next).not.toHaveBeenCalled();
  });
});

describe("the local mode's «signed in» is not an identity", () => {
  it("is read only by the places that answer «no cloud here» or gate the activity read, and none of them picks data or a host by it", () => {
    const callers = sources()
      .filter((file) => /\bteamDataFromTheTeam\(|\blocalTeamData\(/.test(readFileSync(file, "utf-8")))
      .map((file) => relative(src, file))
      .sort();
    expect(callers).toEqual([
      "lib/existing-team-positions.ts",
      "lib/local-judgement-api.ts",
      "lib/local-team-data.ts",
      "pages/map/map-api.ts",
      "pages/swipe/load-swipe.ts",
      "pages/team/local-team-api.ts",
      "shell/api-bridge.ts",
      "web-shims/server/auth.ts",
      "web-shims/server/supabase-client.ts",
      "web-shims/server/supabase-server.ts",
    ]);
    // the three stand-ins return null / the inert client / the bridge rows: no user id, no host, no container
    for (const file of ["web-shims/server/auth.ts", "web-shims/server/supabase-client.ts", "web-shims/server/supabase-server.ts"]) {
      const text = readFileSync(join(src, file), "utf-8");
      const line = text.split("\n").find((l) => l.includes("teamDataFromTheTeam()") && !l.trim().startsWith("//") && !l.includes("import"));
      expect(line, file).toMatch(/return null;|inertSupabase/);
    }
    // the activity read is asked only for the team of this computer: a yes/no gate, no identity in it
    const reading = readFileSync(join(src, "lib/existing-team-positions.ts"), "utf-8").split("\n").find((l) => l.includes("localTeamData()") && !l.includes("import") && !l.trim().startsWith("*"));
    expect(reading).toContain('if (!localTeamData()) return { source: "not_desktop" }');
    // the board's read is the same kind of gate: local mode or not, and what it answers is the team's rows
    const board = readFileSync(join(src, "pages/team/local-team-api.ts"), "utf-8");
    const gate = board.split("\n").find((l) => l.includes("localTeamData()") && !l.includes("import") && !l.trim().startsWith("*"));
    expect(gate).toContain("if (!localTeamData()) return next(input, init);");
    // and it answers GET alone: no other method is read from the team here
    expect(board.match(/method === "GET"/g)?.length).toBe(2);
    expect(board).not.toMatch(/method === "(POST|PUT|PATCH|DELETE)"/);
    const map = readFileSync(join(src, "pages/map/map-api.ts"), "utf-8").split("\n").find((l) => l.includes("teamDataFromTheTeam()") && !l.includes("import"));
    expect(map).toContain("vpsRows()");
  });

  it("gives a route no user: the inert client answers no user and no session", async () => {
    setLocalTeamData("local:abc");
    for (const client of [clientSide(), await serverSide()]) {
      expect(await client.auth.getUser()).toEqual({ data: { user: null }, error: null });
      expect(await client.auth.getSession()).toEqual({ data: { session: null }, error: null });
    }
  });
});
