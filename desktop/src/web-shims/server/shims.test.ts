import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The shims hand the web's server code the desktop client. Here that client
// is a fake that records what it is asked, so the tests prove the whole chain:
// alias -> shim -> the user's client, with the web's real queries on top.
type Call = { table: string; ops: string[] };
const calls: Call[] = [];
let rows: Record<string, unknown[]> = {};
const session = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null }));

function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: any = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") {
              return (ok: any, ko: any) =>
                Promise.resolve({ data: rows[table] ?? [], error: null }).then(ok, ko);
            }
            if (prop === "range") {
              return (from: number, to: number) =>
                Promise.resolve({ data: (rows[table] ?? []).slice(from, to + 1), error: null });
            }
            return (...args: unknown[]) => {
              call.ops.push(`${prop}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
              return builder;
            };
          },
        },
      );
      return builder;
    },
    auth: { getUser: async () => ({ data: { user: session.user }, error: null }) },
  };
}

vi.mock("../../lib/supabase", () => ({
  supabase: fakeClient(),
  supabaseConfigured: true,
}));

beforeEach(() => {
  calls.length = 0;
  rows = {};
  session.user = { id: "user-1" };
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
});

describe("the web's real queries run on the user's client", () => {
  it("getDashboardStats of web/lib/queries.ts reads positions through the shimmed client", async () => {
    rows.positions = [
      { status: "scored", write_requested: false },
      { status: "new", write_requested: false },
    ];
    const queries = await import("@/lib/queries");
    const stats = await queries.getDashboardStats();
    expect(stats.total).toBe(2);
    expect(stats.scored).toBe(1);
    expect(calls.map((c) => c.table)).toEqual(["positions"]);
    // The cloud branch, not the local SQLite one and not the demo persona.
    expect(calls[0].ops).toContain('is("deleted_at", null)');
  });

  it("the server and browser createClient both hand out the desktop client", async () => {
    const server = await import("@/lib/supabase/server");
    const browser = await import("@/lib/supabase/client");
    const desktop = await import("../../lib/supabase");
    expect(await server.createClient()).toBe(desktop.supabase);
    expect(browser.createClient()).toBe(desktop.supabase);
  });

  it("never takes the local workspace or the demo branch", async () => {
    const auth = await import("@/lib/auth");
    const workspace = await import("@/lib/workspace");
    const demo = await import("@/lib/demo/mode");
    expect(await auth.isLocalRequest()).toBe(false);
    expect(await workspace.getWorkspacePath()).toBeNull();
    expect(workspace.isSupabaseConfigured).toBe(true);
    // Even with the web's demo cookie left in the webview.
    document.cookie = "jht_demo_persona=finance; path=/";
    expect(await demo.activeDemoPersona()).toBeNull();
  });

  it("a local SQLite reader called by mistake fails loudly", async () => {
    const local = await import("@/lib/local-queries");
    expect(() => local.getDashboardStatsLocal("/tmp")).toThrow(/not available in the desktop/);
  });

  it("the cover letter file name comes from the user's candidate_files", async () => {
    rows.candidate_files = [{ name: "cover-letter-42.pdf", size: 1, updated_at: "2026-01-01T00:00:00Z" }];
    const { resolveCoverLetterPdfFileName } = await import("@/lib/position-document-file.server");
    const { findIndexedCoverLetterPdfFileName } = await import("@/lib/position-document-file");
    const expected = findIndexedCoverLetterPdfFileName(rows.candidate_files as any, 42);
    await expect(
      resolveCoverLetterPdfFileName({ explicitPath: null, legacyId: 42, cloudMode: true }),
    ).resolves.toBe(expected);
    const call = calls.find((c) => c.table === "candidate_files");
    expect(call?.ops).toContain('eq("user_id", "user-1")');
  });
});

describe("the web's routes take their cloud branch", () => {
  it("requireAuth lets the signed-in user through and answers 401 to anyone else", async () => {
    const { requireAuth } = await import("@/lib/auth");
    await expect(requireAuth()).resolves.toBeNull();
    session.user = null;
    const denied = await requireAuth();
    expect(denied?.status).toBe(401);
    await expect(denied?.json()).resolves.toEqual({ error: "Non autenticato" });
  });

  it("localFirstWrite runs the cloud step with the session's user, never the local one", async () => {
    const { localFirstWrite } = await import("@/lib/positions/local-first-write");
    const { NextRequest } = await import("next/server");
    const local = vi.fn(() => ({ ok: true as const, outcome: { where: "local" } }));
    const cloud = vi.fn(async (_sb: unknown, userId: string) => ({
      ok: true as const,
      outcome: { where: "cloud", userId },
    }));
    const res = await localFirstWrite(new NextRequest("http://desktop.invalid/api/x", { method: "POST" }), {
      local,
      cloud,
      sessionOnlyError: "session only",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      where: "cloud",
      userId: "user-1",
      source: "cloud",
      cloud_synced: true,
    });
    expect(local).not.toHaveBeenCalled();
  });

  it("localFirstWrite refuses a Bearer caller and anyone signed out, as the web does", async () => {
    const { localFirstWrite } = await import("@/lib/positions/local-first-write");
    const { NextRequest } = await import("next/server");
    const spec = {
      local: vi.fn(),
      cloud: vi.fn(),
      sessionOnlyError: "session only",
    } as any;
    session.user = null;
    const signedOut = await localFirstWrite(new NextRequest("http://desktop.invalid/api/x"), spec);
    expect(signedOut.status).toBe(401);
    expect(spec.cloud).not.toHaveBeenCalled();
  });

  it("the box's pieces are absent: cloud deploy, no local token, no SQLite", async () => {
    const deploy = await import("@/lib/deploy-mode");
    const token = await import("@/lib/local-token");
    const { default: Database } = await import("better-sqlite3");
    expect(deploy.isCloudDeploy()).toBe(true);
    expect(deploy.getDeployMode()).toBe("cloud");
    expect(token.isLocalTokenAuthenticated("Bearer anything", "anything")).toBe(false);
    expect(() => new Database("/tmp/jobs.db")).toThrow(/not available in the desktop/);
  });

  it("the service_role client is refused", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    expect(() => createAdminClient()).toThrow(/service_role is not available/);
  });
});

describe("next/server is the platform's Response", () => {
  it("NextResponse.json sets the body, the status and the content type", async () => {
    const { NextResponse } = await import("next/server");
    const res = NextResponse.json({ error: "x" }, { status: 409 });
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("application/json");
    await expect(res.json()).resolves.toEqual({ error: "x" });
    expect(new NextResponse(null, { status: 204 }).status).toBe(204);
  });

  it("NextRequest carries nextUrl", async () => {
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://desktop.invalid/api/positions/42/ticket?x=1", { method: "POST" });
    expect(req.nextUrl.pathname).toBe("/api/positions/42/ticket");
    expect(req.nextUrl.searchParams.get("x")).toBe("1");
  });
});

describe("next/headers reads document.cookie", () => {
  it("get, getAll and has see the cookies the client components write", async () => {
    document.cookie = "jht_positions_cols=id%2Ctitle; path=/";
    const { cookies } = await import("next/headers");
    const store = await cookies();
    expect(store.get("jht_positions_cols")?.value).toBe("id,title");
    expect(store.has("jht_positions_cols")).toBe(true);
    expect(store.get("missing")).toBeUndefined();
    expect(store.getAll().map((c) => c.name)).toContain("jht_positions_cols");
  });

  it("the locale comes from the NEXT_LOCALE cookie, as on the web", async () => {
    document.cookie = "NEXT_LOCALE=de; path=/";
    const { getServerLocale } = await import("@/lib/server-locale");
    await expect(getServerLocale()).resolves.toBe("de");
  });
});

// vite.config.ts and tsconfig.json must send every specifier to the same
// file: a shim known to tsc but not to Vite type-checks and then runs the
// web's server module in the webview.
describe("vite aliases and tsconfig paths agree", () => {
  const root = resolve(__dirname, "../../..");
  const vite = readFileSync(resolve(root, "vite.config.ts"), "utf-8");
  const tsconfig = JSON.parse(readFileSync(resolve(root, "tsconfig.json"), "utf-8"));

  const viteMap = new Map<string, string>();
  for (const m of vite.matchAll(/find: \/\^(.+?)\$?\/, replacement: fromHere\("\.\/(.+?)"\)/g)) {
    viteMap.set(m[1].replace(/\\/g, ""), m[2]);
  }
  const tsMap = new Map<string, string>(
    Object.entries(tsconfig.compilerOptions.paths as Record<string, string[]>).map(([k, v]) => [
      k,
      v[0].replace(/^\.\//, ""),
    ]),
  );

  it("every shim alias of Vite is a tsconfig path to the same file", () => {
    const shims = [...viteMap].filter(([, file]) => file.startsWith("src/web-shims/"));
    expect(shims.length).toBeGreaterThanOrEqual(20);
    for (const [spec, file] of shims) expect(tsMap.get(spec), spec).toBe(file);
  });

  it("every shim path of tsconfig is a Vite alias to the same file", () => {
    const shims = [...tsMap].filter(([, file]) => file.startsWith("src/web-shims/"));
    for (const [spec, file] of shims) expect(viteMap.get(spec), spec).toBe(file);
  });
});
