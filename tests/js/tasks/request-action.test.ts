/**
 * La porta unica delle azioni del sito (JHT «web capace», fase 2-b): `requestAction`.
 *
 * Qui gira il codice con un database FINTO che parla il contratto
 * (banda/piani/CONTRATTO-request-action-2a-2b): la funzione vera, la conferma a due tempi nel registro
 * e il legame alla sessione stanno nel database (2-a) e si provano contro Postgres. Quello che si
 * prova qui è l'INGRESSO: l'origine stretta (P1), la forma del corpo, che cosa arriva al database e che
 * cosa esce verso il client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "../../../web/node_modules/next/server.js";

const USER = "11111111-1111-1111-1111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const SITE = "https://jobhunter.example";

interface Rpc {
  fn: string;
  args: Record<string, unknown>;
}

const world = {
  user: { id: USER } as { id: string } | null,
  rpcs: [] as Rpc[],
  answer: (
    _args: Record<string, unknown>,
  ): { data: unknown; error: unknown } => ({ data: null, error: null }),
  throwOnRpc: false,
  configured: true,
};

vi.mock("@/lib/workspace", () => ({
  get isSupabaseConfigured() {
    return world.configured;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: world.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      world.rpcs.push({ fn, args });
      if (world.throwOnRpc) throw new Error("network down");
      return world.answer(args);
    },
  }),
}));

import {
  DATABASE_REFUSALS,
  isBoundedJson,
  parseBody,
  requestAction,
} from "@/lib/request-action";
import { strictMutationRefusal } from "@/lib/csrf";

const awaiting = (extra: Record<string, unknown> = {}) => ({
  data: {
    ok: true,
    state: "awaiting_confirm",
    id: ROW,
    level: "L2",
    summary: "Restart the whole team?",
    expires_at: "2026-10-22T12:02:00Z",
    ...extra,
  },
  error: null,
});
const queued = (extra: Record<string, unknown> = {}) => ({
  data: {
    ok: true,
    state: "queued",
    id: ROW,
    level: "L2",
    summary: "Restart the whole team?",
    expires_at: null,
    ...extra,
  },
  error: null,
});

function post(
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
) {
  const init: RequestInit = {
    method,
    headers: {
      host: "jobhunter.example",
      "x-forwarded-proto": "https",
      origin: SITE,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  };
  if (method !== "GET" && method !== "HEAD")
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest(`${SITE}/api/team/command`, init);
}

const L2 = { action: "team.restart", level: "L2" as const };

beforeEach(() => {
  world.user = { id: USER };
  world.rpcs = [];
  world.throwOnRpc = false;
  world.configured = true;
  world.answer = () => awaiting();
  vi.unstubAllEnvs();
});

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

// -- P1: l'origine stretta --------------------------------------------------------------------------------------

describe("the entry: strict origin for the actions that command the team", () => {
  it("lets in a POST with the site's own origin and a JSON body", async () => {
    const res = await requestAction(post({ params: { target: "all" } }), L2);
    expect(res.status).toBe(200);
    expect(world.rpcs).toHaveLength(1);
  });

  it.each([
    [
      "no Origin at all (the lenient check lets this through)",
      { origin: "" },
      403,
      "origin_required",
    ],
    ["Origin null", { origin: "null" }, 403, "origin_required"],
    [
      "another site",
      { origin: "https://evil.example" },
      403,
      "origin_not_allowed",
    ],
    [
      "the right Origin but the browser says cross-site",
      { "sec-fetch-site": "cross-site" },
      403,
      "cross_site",
    ],
    [
      "the browser says same-site (a sibling subdomain)",
      { "sec-fetch-site": "same-site" },
      403,
      "cross_site",
    ],
    [
      "a form post",
      { "content-type": "application/x-www-form-urlencoded" },
      415,
      "unsupported_media_type",
    ],
    [
      "text/plain, which a cross-site form can send",
      { "content-type": "text/plain" },
      415,
      "unsupported_media_type",
    ],
    ["no content type", { "content-type": "" }, 415, "unsupported_media_type"],
  ])("refuses %s", async (_name, headers, status, error) => {
    const res = await requestAction(
      post({ params: {} }, headers as Record<string, string>),
      L2,
    );
    expect(res.status).toBe(status);
    expect(await json(res)).toEqual({ ok: false, error });
    expect(world.rpcs).toEqual([]);
  });

  it("a Referer is not an Origin: a request with only a matching Referer is refused", async () => {
    const res = await requestAction(
      post({ params: {} }, { origin: "", referer: `${SITE}/team` }),
      L2,
    );
    expect(res.status).toBe(403);
    expect(world.rpcs).toEqual([]);
  });

  it.each(["GET", "PUT", "DELETE", "PATCH"])(
    "accepts nothing but POST (%s)",
    async (method) => {
      const res = await requestAction(post({ params: {} }, {}, method), L2);
      expect(res.status).toBe(405);
      expect(world.rpcs).toEqual([]);
    },
  );

  it.each(["GET", "PUT", "DELETE", "PATCH"])(
    "an L1 action accepts nothing but POST either (%s)",
    async (method) => {
      world.answer = () => queued({ level: "L1" });
      const res = await requestAction(post({ params: {} }, {}, method), {
        action: "position.apply_revoke",
        level: "L1",
      });
      expect(res.status).toBe(405);
      expect(world.rpcs).toEqual([]);
    },
  );

  it("accepts a JSON content type with a charset", async () => {
    const res = await requestAction(
      post(
        { params: {} },
        { "content-type": "application/json; charset=utf-8" },
      ),
      L2,
    );
    expect(res.status).toBe(200);
  });

  it("with a public origin configured it is the ONLY one: the forwarded host cannot make another site the right one", async () => {
    vi.stubEnv("JHT_PUBLIC_ORIGIN", "https://jobhunter.team");
    const forged = await requestAction(
      post(
        { params: {} },
        {
          origin: "https://evil.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
      ),
      L2,
    );
    expect(forged.status).toBe(403);
    const localhost = await requestAction(
      post({ params: {} }, { origin: "http://localhost:3000" }),
      L2,
    );
    expect(localhost.status).toBe(403);
    const right = await requestAction(
      post({ params: {} }, { origin: "https://jobhunter.team" }),
      L2,
    );
    expect(right.status).toBe(200);
  });

  it("without a public origin the development localhost is allowed, as for the rest of the site", () => {
    expect(
      strictMutationRefusal({
        method: "POST",
        origin: "http://localhost:3000",
        contentType: "application/json",
        hostOrigin: null,
      }),
    ).toBeNull();
  });

  it("hands the database the route's own level, so it can refuse BEFORE writing anything", async () => {
    world.answer = () => queued({ level: "L1" });
    await requestAction(post({ params: {} }), {
      action: "position.apply_revoke",
      level: "L1",
    });
    await requestAction(post({ params: {} }), L2);
    expect(world.rpcs.map((r) => r.args.p_route_level)).toEqual(["L1", "L2"]);
  });

  it("on the cloud deploy the public origin is mandatory: without it nothing is let in, even with the right Origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
    const res = await requestAction(post({ params: {} }), L2);
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({
      ok: false,
      error: "origin_not_configured",
    });
    expect(world.rpcs).toEqual([]);
    vi.stubEnv("JHT_PUBLIC_ORIGIN", SITE);
    expect((await requestAction(post({ params: {} }), L2)).status).toBe(200);
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "local");
    vi.stubEnv("JHT_PUBLIC_ORIGIN", "");
    expect((await requestAction(post({ params: {} }), L2)).status).toBe(200);
  });

  it("an L1 action keeps the site's lenient rule (the middleware's) but still wants a JSON POST", async () => {
    world.answer = () => queued({ level: "L1" });
    const noOrigin = await requestAction(
      post({ params: {} }, { origin: "", "sec-fetch-site": "" }),
      { action: "position.apply_revoke", level: "L1" },
    );
    expect(noOrigin.status).toBe(200);
    const crossSite = await requestAction(
      post({ params: {} }, { "sec-fetch-site": "cross-site" }),
      { action: "position.apply_revoke", level: "L1" },
    );
    expect(crossSite.status).toBe(403);
    const form = await requestAction(
      post({ params: {} }, { "content-type": "text/plain" }),
      { action: "position.apply_revoke", level: "L1" },
    );
    expect(form.status).toBe(415);
  });
});

// -- la forma del corpo -----------------------------------------------------------------------------------------------

describe("the body", () => {
  it.each([
    ["not json", "{nope"],
    ["an array", "[]"],
    ["a string", '"x"'],
    ["null", "null"],
    [
      "a key that is not params or confirmId",
      JSON.stringify({ params: {}, summary: "Approve everything" }),
    ],
    [
      "a user id from the client",
      JSON.stringify({ params: {}, user_id: USER }),
    ],
    [
      "params and confirmId together",
      JSON.stringify({ params: { a: 1 }, confirmId: ROW }),
    ],
    ["a confirmId that is not a uuid", JSON.stringify({ confirmId: "../x" })],
    ["a confirmId that is a number", JSON.stringify({ confirmId: 7 })],
    ["params that are a list", JSON.stringify({ params: [1] })],
    ["params that are a string", JSON.stringify({ params: "x" })],
    ["a __proto__ key", '{"params":{"__proto__":{"admin":true}}}'],
    ["a constructor key", JSON.stringify({ params: { constructor: 1 } })],
    [
      "a text over the cap",
      JSON.stringify({ params: { text: "x".repeat(4001) } }),
    ],
    [
      "nesting over the cap",
      JSON.stringify({ params: { a: { b: { c: { d: { e: 1 } } } } } }),
    ],
  ])("refuses %s before the database", async (_name, body) => {
    const res = await requestAction(post(body), L2);
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ ok: false, error: "invalid_request" });
    expect(world.rpcs).toEqual([]);
  });

  it("refuses a body over the cap, by its declared length and by its real one", async () => {
    const declared = await requestAction(
      post({ params: {} }, { "content-length": "999999" }),
      L2,
    );
    expect(declared.status).toBe(413);
    const real = await requestAction(
      post(JSON.stringify({ params: { t: "x".repeat(9000) } })),
      L2,
    );
    expect(real.status).toBe(413);
    expect(world.rpcs).toEqual([]);
  });

  it("an empty body is the first call with no parameters", async () => {
    const res = await requestAction(post(""), L2);
    expect(res.status).toBe(200);
    expect(world.rpcs[0].args).toEqual({
      p_action: "team.restart",
      p_params: {},
      p_confirm_id: null,
      p_route_level: "L2",
    });
  });

  it("isBoundedJson and parseBody agree on what a parameter is", () => {
    expect(isBoundedJson({ a: [1, "x", null, true], b: { c: "d" } })).toBe(
      true,
    );
    expect(isBoundedJson({ a: Number.POSITIVE_INFINITY })).toBe(false);
    expect(
      parseBody(JSON.stringify({ confirmId: ROW.toUpperCase() }))?.confirmId,
    ).toBe(ROW);
  });
});

// -- l'utente ---------------------------------------------------------------------------------------------------------------

describe("the user and the database", () => {
  it("without a session it is 401 and the database is not called", async () => {
    world.user = null;
    const res = await requestAction(post({ params: {} }), L2);
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ ok: false, error: "unauthenticated" });
    expect(world.rpcs).toEqual([]);
  });

  it("without Supabase it is 503", async () => {
    world.configured = false;
    expect((await requestAction(post({ params: {} }), L2)).status).toBe(503);
    expect(world.rpcs).toEqual([]);
  });

  it("the origin is checked before the session: a cross-site request learns nothing about being logged in", async () => {
    world.user = null;
    const res = await requestAction(
      post({ params: {} }, { "sec-fetch-site": "cross-site" }),
      L2,
    );
    expect(res.status).toBe(403);
  });

  it("the first call hands the database the route's action and the parameters, and nothing else", async () => {
    await requestAction(
      post({ params: { target: "scout-1", note: "hello" } }),
      L2,
    );
    expect(world.rpcs).toEqual([
      {
        fn: "request_action",
        args: {
          p_action: "team.restart",
          p_params: { target: "scout-1", note: "hello" },
          p_confirm_id: null,
          p_route_level: "L2",
        },
      },
    ]);
  });

  it("the second call carries only the confirmation id, and no parameters", async () => {
    world.answer = () => queued();
    const res = await requestAction(post({ confirmId: ROW }), L2);
    expect(res.status).toBe(200);
    expect(world.rpcs).toEqual([
      {
        fn: "request_action",
        args: {
          p_action: "team.restart",
          p_params: {},
          p_confirm_id: ROW,
          p_route_level: "L2",
        },
      },
    ]);
  });

  it("parameters the route knows from the address are the route's: the body cannot add or change them", async () => {
    const spec = {
      action: "position.apply_authorize",
      level: "L3" as const,
      params: { legacy_id: 7 },
    };
    world.answer = () => awaiting({ level: "L3" });
    expect((await requestAction(post({}), spec)).status).toBe(200);
    expect(world.rpcs[0].args).toMatchObject({
      p_params: { legacy_id: 7 },
      p_confirm_id: null,
      p_route_level: "L3",
    });
    for (const body of [
      { params: { legacy_id: 8 } },
      { params: { legacy_id: 7 } },
    ]) {
      world.rpcs = [];
      expect((await requestAction(post(body), spec)).status).toBe(400);
      expect(world.rpcs).toEqual([]);
    }
    world.rpcs = [];
    world.answer = () => queued({ level: "L3" });
    expect((await requestAction(post({ confirmId: ROW }), spec)).status).toBe(
      200,
    );
    expect(world.rpcs[0].args).toMatchObject({
      p_params: {},
      p_confirm_id: ROW,
    });
    world.rpcs = [];
    expect(
      (
        await requestAction(post({}), {
          ...spec,
          params: { text: "x".repeat(4001) },
        })
      ).status,
    ).toBe(502);
    expect(world.rpcs).toEqual([]);
  });

  it("the body's own parameters are added to the route's, which win and cannot be repeated", async () => {
    const spec = {
      action: "exclusion.decide",
      level: "L1" as const,
      params: { legacy_id: 7 },
    };
    world.answer = () => queued({ level: "L1" });
    expect(
      (await requestAction(post({ params: { reason: "salary" } }), spec))
        .status,
    ).toBe(200);
    expect(world.rpcs[0].args.p_params).toEqual({
      reason: "salary",
      legacy_id: 7,
    });
  });

  describe("the free text of the body", () => {
    const withText = {
      action: "directive.create",
      level: "L2" as const,
      body: true as const,
    };
    it("goes to the database as p_body on the first call, untouched, and only if the route takes one", async () => {
      expect(
        (
          await requestAction(
            post({ params: { kind: "note" }, body: "Prefer remote roles" }),
            withText,
          )
        ).status,
      ).toBe(200);
      expect(world.rpcs[0].args).toEqual({
        p_action: "directive.create",
        p_params: { kind: "note" },
        p_confirm_id: null,
        p_route_level: "L2",
        p_body: "Prefer remote roles",
      });
      world.rpcs = [];
      expect((await requestAction(post({ params: {} }), withText)).status).toBe(
        200,
      );
      expect(world.rpcs[0].args.p_body).toBeNull();
      world.rpcs = [];
      expect((await requestAction(post({ body: "x" }), L2)).status).toBe(400);
      expect(world.rpcs).toEqual([]);
      expect((await requestAction(post({ params: {} }), L2)).status).toBe(200);
      expect("p_body" in world.rpcs[0].args).toBe(false);
    });
    it("is a string within the cap, never with the confirmation", async () => {
      world.rpcs = [];
      expect(
        (await requestAction(post({ body: "x".repeat(2000) }), withText))
          .status,
      ).toBe(200);
      expect(
        (await requestAction(post({ body: "x".repeat(2001) }), withText))
          .status,
      ).toBe(400);
      expect(
        (await requestAction(post({ body: { a: 1 } }), withText)).status,
      ).toBe(400);
      expect((await requestAction(post({ body: null }), withText)).status).toBe(
        400,
      );
      expect(
        (await requestAction(post({ confirmId: ROW, body: "x" }), withText))
          .status,
      ).toBe(400);
      expect(
        (
          await requestAction(post({ body: "x".repeat(41) }), {
            ...withText,
            body: { max: 40 },
          })
        ).status,
      ).toBe(400);
      expect(world.rpcs).toHaveLength(1);
    });
    it("the confirmation call does not carry it again", async () => {
      world.rpcs = [];
      world.answer = () => queued({ level: "L2" });
      await requestAction(post({ confirmId: ROW }), withText);
      expect("p_body" in world.rpcs[0].args).toBe(false);
    });
    it("a cap that is not a sane number is the route's mistake", async () => {
      for (const max of [0, -1, 1.5, 9000, Number.NaN]) {
        expect(
          (
            await requestAction(post({ body: "x" }), {
              ...withText,
              body: { max },
            })
          ).status,
        ).toBe(502);
      }
    });
  });

  it("a family that finishes at once answers 'done', on the first call or on the confirmation", async () => {
    world.answer = () => ({
      data: {
        ok: true,
        state: "done",
        id: ROW,
        level: "L1",
        summary: "",
        expires_at: null,
      },
      error: null,
    });
    const first = await requestAction(post({ params: {} }), L2);
    expect(await json(first)).toMatchObject({ ok: true, state: "done" });
    expect((await requestAction(post({ confirmId: ROW }), L2)).status).toBe(
      200,
    );
    world.answer = () => awaiting();
    expect((await requestAction(post({ confirmId: ROW }), L2)).status).toBe(
      502,
    );
  });

  it("a route that withdraws with DELETE says so: DELETE is its method and POST is not, the origin checks are the same", async () => {
    const spec = {
      action: "position.apply_revoke",
      level: "L1" as const,
      method: "DELETE" as const,
      params: { legacy_id: 7 },
    };
    world.answer = () => queued({ level: "L1" });
    expect((await requestAction(post({}, {}, "DELETE"), spec)).status).toBe(
      200,
    );
    expect((await requestAction(post({}, {}, "POST"), spec)).status).toBe(405);
    const strictDelete = { ...spec, level: "L2" as const };
    expect(
      (await requestAction(post({}, {}, "DELETE"), strictDelete)).status,
    ).toBe(200);
    expect(
      (await requestAction(post({}, { origin: "" }, "DELETE"), strictDelete))
        .status,
    ).toBe(403);
    expect(
      (
        await requestAction(
          post({}, { "sec-fetch-site": "cross-site" }, "DELETE"),
          strictDelete,
        )
      ).status,
    ).toBe(403);
  });

  it("a client cannot choose the action: it is the route's", async () => {
    await requestAction(post({ params: { action: "team.stop" } }), L2);
    expect(world.rpcs[0].args.p_action).toBe("team.restart");
  });

  it("a route written with a name the database would never take does not go on", async () => {
    for (const action of [
      "",
      "Team Restart",
      "../x",
      "x".repeat(65),
      "constructor;",
      "team.",
      ".restart",
      "a.b.c",
      "team..restart",
      "team-restart",
    ]) {
      const res = await requestAction(post({ params: {} }), {
        action,
        level: "L2",
      });
      expect(res.status).toBe(502);
    }
    const level = await requestAction(post({ params: {} }), {
      action: "team.stop",
      level: "L9" as never,
    });
    expect(level.status).toBe(502);
    expect(world.rpcs).toEqual([]);
  });
});

// -- che cosa esce verso il client -------------------------------------------------------------------------------------

describe("what the person is shown", () => {
  it("the first call shows the database's own summary and deadline, as they came", async () => {
    const res = await requestAction(post({ params: {} }), L2);
    expect(await json(res)).toEqual({
      ok: true,
      state: "awaiting_confirm",
      id: ROW,
      level: "L2",
      summary: "Restart the whole team?",
      expiresAt: "2026-10-22T12:02:00Z",
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("only the known fields leave: whatever else the database says stays here", async () => {
    world.answer = () =>
      awaiting({
        session_id: "s-secret",
        user_id: USER,
        token: "t",
        sql: "select 1",
      });
    const out = await json(await requestAction(post({ params: {} }), L2));
    expect(Object.keys(out).sort()).toEqual([
      "expiresAt",
      "id",
      "level",
      "ok",
      "state",
      "summary",
    ]);
  });

  it("the state of a team command (command_id) comes out only when it is a uuid", async () => {
    const CMD = "33333333-3333-4333-8333-333333333333";
    world.answer = () => queued({ command_id: CMD });
    expect(
      (await json(await requestAction(post({ confirmId: ROW }), L2))).commandId,
    ).toBe(CMD);
    world.answer = () => queued({ command_id: "1; drop table" });
    expect(
      "commandId" in
        (await json(await requestAction(post({ confirmId: ROW }), L2))),
    ).toBe(false);
    world.answer = () => queued();
    expect(
      "commandId" in
        (await json(await requestAction(post({ confirmId: ROW }), L2))),
    ).toBe(false);
  });

  it("the contract's 15 codes are the ones the library knows", () => {
    expect(Object.keys(DATABASE_REFUSALS).sort()).toEqual(
      [
        "action_disabled",
        "already_submitted",
        "confirm_action_mismatch",
        "confirm_expired",
        "confirm_not_found",
        "confirm_session_mismatch",
        "confirm_used",
        "invalid_params",
        "level_mismatch",
        "not_found",
        "position_not_ready",
        "rate_limited",
        "reauth_required",
        "unauthenticated",
        "unknown_action",
      ].sort(),
    );
  });

  it.each(Object.entries(DATABASE_REFUSALS))(
    "the database refuses with %s: HTTP %s",
    async (code, status) => {
      world.answer = () => ({ data: { ok: false, error: code }, error: null });
      const res = await requestAction(post({ params: {} }), L2);
      expect(res.status).toBe(status);
      expect(await json(res)).toEqual({ ok: false, error: code });
    },
  );

  it("a rate limit carries Retry-After, once, and only when it is a sane number", async () => {
    world.answer = () => ({
      data: { ok: false, error: "rate_limited", retry_after_s: 90 },
      error: null,
    });
    expect(
      (await requestAction(post({ params: {} }), L2)).headers.get(
        "retry-after",
      ),
    ).toBe("90");
    for (const bad of [-1, 0, 1.5, 999999, "soon", null]) {
      world.answer = () => ({
        data: { ok: false, error: "rate_limited", retry_after_s: bad },
        error: null,
      });
      expect(
        (await requestAction(post({ params: {} }), L2)).headers.get(
          "retry-after",
        ),
      ).toBeNull();
    }
  });

  it("a reauthentication request is a 401 the page can tell from a missing session", async () => {
    world.answer = () => ({
      data: { ok: false, error: "reauth_required" },
      error: null,
    });
    const res = await requestAction(post({ params: {} }), L2);
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe("reauth_required");
  });

  it.each([
    ["a code outside the contract", { ok: false, error: "teapot" }],
    [
      "a code that is the name of something every object has",
      { ok: false, error: "constructor" },
    ],
    ["a code that is __proto__", { ok: false, error: "__proto__" }],
    ["no answer", null],
    ["an answer that is not an object", "ok"],
    ["ok with no state", { ok: true }],
    [
      "a state outside the contract",
      {
        ok: true,
        state: "finished",
        id: ROW,
        level: "L2",
        summary: "x",
        expires_at: null,
      },
    ],
    [
      "an id that is not a uuid",
      {
        ok: true,
        state: "queued",
        id: "1",
        level: "L2",
        summary: "x",
        expires_at: null,
      },
    ],
    [
      "a level outside the contract",
      {
        ok: true,
        state: "queued",
        id: ROW,
        level: "L0",
        summary: "x",
        expires_at: null,
      },
    ],
    [
      "a confirmation with no summary",
      {
        ok: true,
        state: "awaiting_confirm",
        id: ROW,
        level: "L2",
        summary: "",
        expires_at: "2026-10-22T12:02:00Z",
      },
    ],
    [
      "a confirmation with no deadline",
      {
        ok: true,
        state: "awaiting_confirm",
        id: ROW,
        level: "L2",
        summary: "x",
        expires_at: null,
      },
    ],
    [
      "a summary over the cap",
      {
        ok: true,
        state: "queued",
        id: ROW,
        level: "L2",
        summary: "x".repeat(401),
        expires_at: null,
      },
    ],
  ])(
    "%s is a server error, and says nothing of what it was",
    async (_name, data) => {
      world.answer = () => ({ data, error: null });
      const res = await requestAction(post({ params: {} }), L2);
      expect(res.status).toBe(502);
      expect(await json(res)).toEqual({ ok: false, error: "action_failed" });
    },
  );

  it("the second call must not ask for another confirmation", async () => {
    world.answer = () => awaiting();
    const res = await requestAction(post({ confirmId: ROW }), L2);
    expect(res.status).toBe(502);
  });

  it("an RPC error, or a thrown one, is a 502 that never carries the database's words", async () => {
    world.answer = () => ({
      data: null,
      error: {
        message: 'relation "web_action_log" does not exist',
        code: "42P01",
      },
    });
    const failed = await requestAction(post({ params: {} }), L2);
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await json(failed))).not.toMatch(
      /web_action_log|42P01|relation/,
    );
    world.throwOnRpc = true;
    const thrown = await requestAction(post({ params: {} }), L2);
    expect(thrown.status).toBe(502);
    expect(JSON.stringify(await json(thrown))).not.toMatch(/network/);
  });

  it("a route that declared a lower level than the database's is stopped, and nothing is shown", async () => {
    world.answer = () => awaiting({ level: "L3" });
    const res = await requestAction(post({ params: {} }), L2);
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ ok: false, error: "level_mismatch" });
    world.answer = () => queued({ level: "L1" });
    expect(
      (
        await requestAction(post({ params: {} }), {
          action: "team.stop",
          level: "L1",
        })
      ).status,
    ).toBe(200);
    world.answer = () => queued({ level: "L2" });
    expect(
      (
        await requestAction(post({ params: {} }), {
          action: "team.stop",
          level: "L1",
        })
      ).status,
    ).toBe(500);
  });

  it("a route that declared a higher level than the database's still works (the stricter check was only stricter)", async () => {
    world.answer = () => queued({ level: "L1" });
    expect((await requestAction(post({ params: {} }), L2)).status).toBe(200);
  });
});

// -- il sorgente ----------------------------------------------------------------------------------------------------------------

describe("the library reads the database through one door only", () => {
  const source = readFileSync(
    join(__dirname, "../../../web/lib/request-action.ts"),
    "utf-8",
  );

  it("calls request_action and writes no table", () => {
    expect(source).toContain('supabase.rpc("request_action"');
    expect(source).not.toMatch(/\.from\(/);
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect((source.match(/\.rpc\(/g) ?? []).length).toBe(1);
  });

  it("takes nothing from the client but the parameters and the confirmation id", () => {
    expect(source).toMatch(/p_action: spec\.action/);
    expect(source).not.toMatch(/user_id|session_id|created_at|summary:\s*body/);
  });

  it("knows no secret and uses no service role", () => {
    expect(source).not.toMatch(
      /service_role|SERVICE_ROLE|createAdminClient|process\.env/,
    );
  });
});

// -- the temporary fallback of the emergency stop: only when the door does not exist --------------------------

describe("whenDoorMissing: only when request_action does not exist in the database", () => {
  const spec = (calls: string[]) => ({
    action: "team.emergency_stop",
    level: "L2" as const,
    whenDoorMissing: async ({ userId }: { userId: string }) => {
      calls.push(userId);
      return Response.json({ ok: true, state: "queued", fallback: true }) as never;
    },
  });

  it.each([
    ["PostgREST does not know the function", "PGRST202"],
    ["PostgreSQL does not know the function", "42883"],
  ])("%s (%s): the fallback runs, with the signed-in user", async (_label, code) => {
    world.answer = () => ({ data: null, error: { code, message: "Could not find the function" } });
    const calls: string[] = [];
    const res = await requestAction(post({}), spec(calls));
    expect(res.status).toBe(200);
    expect(calls).toEqual([USER]);
  });

  it.each([
    ["a permission error", { code: "42501", message: "permission denied" }],
    ["a timeout", { code: "57014", message: "canceling statement" }],
    ["an error without a code", { message: "boom" }],
    ["a code that only looks alike", { code: "PGRST2020" }],
  ])("%s is NOT a missing door: 502, and the fallback never runs", async (_label, error) => {
    world.answer = () => ({ data: null, error });
    const calls: string[] = [];
    const res = await requestAction(post({}), spec(calls));
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({ ok: false, error: "action_failed" });
    expect(calls).toEqual([]);
  });

  it("a refusal of the door, or an answer, never runs the fallback", async () => {
    const calls: string[] = [];
    world.answer = () => ({ data: { ok: false, error: "rate_limited" }, error: null });
    expect((await requestAction(post({}), spec(calls))).status).toBe(429);
    world.answer = () => queued();
    expect((await requestAction(post({}), spec(calls))).status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("the origin, the body and the session come first: a refused request never reaches the fallback", async () => {
    world.answer = () => ({ data: null, error: { code: "PGRST202" } });
    const calls: string[] = [];
    expect((await requestAction(post({}, { origin: "https://evil.example" }), spec(calls))).status).toBe(403);
    world.user = null;
    expect((await requestAction(post({}), spec(calls))).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("without whenDoorMissing a missing door is a 502 like any other failure", async () => {
    world.answer = () => ({ data: null, error: { code: "PGRST202" } });
    const res = await requestAction(post({}), L2);
    expect(res.status).toBe(502);
  });
});

describe("an effect the database finished at once answers done", () => {
  it("passes done through, on the first call and on the confirmation", async () => {
    world.answer = () => queued({ state: "done" });
    const first = await requestAction(post({ params: {} }), L2);
    expect(first.status).toBe(200);
    expect((await json(first)).state).toBe("done");
    const second = await requestAction(post({ confirmId: ROW }), L2);
    expect((await json(second)).state).toBe("done");
  });

  it("a confirmation that answers awaiting_confirm again is still refused", async () => {
    world.answer = () => awaiting();
    const res = await requestAction(post({ confirmId: ROW }), L2);
    expect(res.status).toBe(502);
  });
});
