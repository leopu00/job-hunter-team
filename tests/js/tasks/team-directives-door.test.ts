import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 4 (migration 101): the cloud branch of /api/team-directives goes through the single door.
// Creating and editing answer 202 with the database's summary and a confirm_id; the second call carries
// only the confirm_id (and the request_id), never the text: the database writes the text it saved. Archiving
// is L1 and done at once. While the database has no 101 (the door answers unknown_action or is missing),
// outside the website the old RPC of 079 is the fallback; on the website nothing is written.
// Synthetic data only.

const state = vi.hoisted(() => ({
  cloud: false,
  rpc: [] as Array<[string, Record<string, unknown>]>,
  answers: [] as Array<{ data: unknown; error: unknown }>,
  selects: [] as Array<[string, unknown]>,
  sourceRow: { id: 41 } as unknown,
}));

const supabase = vi.hoisted(() => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.rpc.push([name, args]);
    return state.answers.shift() ?? { data: null, error: { code: "XX000" } };
  },
  from: () => {
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        state.selects.push([column, value]);
        return builder;
      },
      maybeSingle: async () => ({ data: state.sourceRow, error: null }),
    };
    return builder;
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => null),
  requireDesktopWrite: vi.fn(async () => null),
}));
vi.mock("@/lib/deploy-mode", () => ({ isCloudDeploy: () => state.cloud }));
vi.mock("@/lib/jht-paths", () => ({ JHT_DB_PATH: "/nonexistent/synthetic/jobs.db" }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => new Map()) }));
vi.mock("@/lib/local-token", () => ({
  LOCAL_TOKEN_COOKIE: "jht-local-token",
  isLocalTokenAuthenticated: () => false,
}));

vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: vi.fn(async () => ({
    ok: true,
    user: { source: "session", userId: "synthetic-user", supabase },
  })),
}));

// `next` resolves from web/, not from tests/js: the bare mock above does not reach the module the route
// loads when the cookie branch (cloudGuard) runs. The same mock on the path web/ resolves does.
const webRequire = createRequire(join(__dirname, "../../../web/package.json"));
vi.doMock(webRequire.resolve("next/headers"), () => ({ cookies: async () => new Map() }));

const LOG_ID = "0b9c2a52-3f7e-4d0e-9a51-6f2b8c1d4e77";
const awaiting = (summary: string) => ({
  data: { ok: true, state: "awaiting_confirm", id: LOG_ID, level: "L2", summary, expires_at: "2026-10-22T12:02:00Z" },
  error: null,
});
const done = { data: { ok: true, state: "done", id: LOG_ID, level: "L2", summary: "s" }, error: null };

const call = async (method: "POST" | "PATCH", body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const route = await import("@/app/api/team-directives/route");
  return route[method](
    new Request("http://localhost/api/team-directives", {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }) as never,
  );
};

beforeEach(() => {
  state.cloud = false;
  state.rpc = [];
  state.answers = [];
  state.selects = [];
  state.sourceRow = { id: 41 };
  vi.unstubAllEnvs();
});

describe("standing orders through the single door", () => {
  it("creating asks for a confirmation and writes nothing yet", async () => {
    state.answers.push(awaiting("strategy: CVs only for 90+"));
    const res = await call("POST", { body: "  CVs only for 90+  ", kind: "strategy", request_id: "r-create" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      ok: true,
      state: "awaiting_confirm",
      confirm_id: LOG_ID,
      summary: "strategy: CVs only for 90+",
      expires_at: "2026-10-22T12:02:00Z",
      request_id: "r-create",
      action: "created",
    });
    expect(state.rpc).toEqual([
      [
        "request_action",
        {
          p_action: "directive.create",
          p_params: { kind: "strategy" },
          p_confirm_id: null,
          p_route_level: "L2",
          p_body: "CVs only for 90+",
        },
      ],
    ]);
  });

  it("the confirmation carries no text, and answers with the order the effect created", async () => {
    state.answers.push(done);
    const res = await call("POST", { confirm_id: LOG_ID, request_id: "r-create", body: "a different text" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      id: "41",
      source: "cloud",
      request_id: "r-create",
      action: "created",
      captain_event: { ok: true, status: "queued" },
    });
    expect(state.rpc).toEqual([
      [
        "request_action",
        { p_action: "directive.create", p_params: {}, p_confirm_id: LOG_ID, p_route_level: "L2" },
      ],
    ]);
    // the order is found by the mark of the log line, for the user of the session
    expect(state.selects).toEqual([
      ["user_id", "synthetic-user"],
      ["source_id", `team-directive:${LOG_ID}`],
    ]);
  });

  it("editing asks for a confirmation; archiving is done at once", async () => {
    state.answers.push(awaiting("#7: written on the website"));
    const edit = await call("PATCH", { id: 7, body: "written on the website", request_id: "r-edit" });
    expect(edit.status).toBe(202);
    expect(state.rpc[0][1]).toMatchObject({ p_action: "directive.update", p_params: { id: 7 }, p_route_level: "L2" });

    state.answers.push({ data: { ...done.data, level: "L1" }, error: null });
    const archive = await call("PATCH", { id: 7, action: "archive", request_id: "r-archive" });
    expect(archive.status).toBe(200);
    expect(await archive.json()).toMatchObject({ ok: true, id: "7", action: "archived", request_id: "r-archive" });
    expect(state.rpc[1][1]).toEqual({
      p_action: "directive.archive",
      p_params: { id: 7 },
      p_confirm_id: null,
      p_route_level: "L1",
    });
  });

  it("says what the door said, and never writes the old way after a refusal", async () => {
    state.answers.push({ data: { ok: false, error: "not_found" }, error: null });
    const missing = await call("PATCH", { id: 9, action: "archive", request_id: "r-9" });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("directive_not_found");

    state.answers.push({ data: { ok: false, error: "confirm_expired" }, error: null });
    const late = await call("PATCH", { confirm_id: LOG_ID, request_id: "r-10" });
    expect(late.status).toBe(410);

    state.answers.push({ data: null, error: { code: "42501", message: "permission denied" } });
    expect((await call("POST", { body: "x", kind: "order", request_id: "r-11" })).status).toBe(502);

    expect(state.rpc.map(([name]) => name)).not.toContain("mutate_team_directive_with_event");
  });
});

describe("the temporary fallback while the database has no 101", () => {
  it("outside the website: the old RPC of 079, with the client's request id", async () => {
    state.answers.push({ data: { ok: false, error: "unknown_action" }, error: null });
    state.answers.push({
      data: { id: 55, status: "queued", request_id: "r-old", action: "created" },
      error: null,
    });
    const res = await call("POST", { body: "an order", kind: "order", request_id: "r-old" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: "55", action: "created", request_id: "r-old" });
    expect(state.rpc[1]).toEqual([
      "mutate_team_directive_with_event",
      { p_id: 0, p_action: "created", p_body: "an order", p_kind: "order", p_request_id: "r-old" },
    ]);
  });

  it("a confirmation never falls back: there is nothing saved to write", async () => {
    state.answers.push({ data: null, error: { code: "PGRST202" } });
    const res = await call("POST", { confirm_id: LOG_ID, request_id: "r-c" });
    expect(res.status).toBe(503);
    expect(state.rpc.map(([name]) => name)).toEqual(["request_action"]);
  });

  it("on the website: nothing is written without the door", async () => {
    state.cloud = true;
    vi.stubEnv("JHT_PUBLIC_ORIGIN", "https://app.example.test");
    state.answers.push({ data: null, error: { code: "PGRST202" } });
    const res = await call(
      "POST",
      { body: "an order", kind: "order", request_id: "r-site" },
      { origin: "https://app.example.test", "sec-fetch-site": "same-origin" },
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_available_yet");
    expect(state.rpc.map(([name]) => name)).toEqual(["request_action"]);
  });

  it("on the website the strict origin rule comes first: another origin reaches neither the door nor the body", async () => {
    state.cloud = true;
    vi.stubEnv("JHT_PUBLIC_ORIGIN", "https://app.example.test");
    const res = await call(
      "POST",
      { body: "an order", kind: "order", request_id: "r-evil" },
      { origin: "https://evil.example" },
    );
    expect(res.status).toBe(403);
    expect(state.rpc).toEqual([]);
  });
});
