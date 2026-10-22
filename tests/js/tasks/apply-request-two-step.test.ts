/**
 * The authorisation to apply on the website goes through the single door (JHT «web capace», phase 5):
 * the route hands the cloud deploy to `requestAction` before it reads or writes anything, and the button
 * shows the text the SERVER composed and sends only the confirmation id on the second call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const requireFromWeb = createRequire(
  join(__dirname, "../../../web/package.json"),
);
const { NextRequest } = requireFromWeb("next/server");

const calls: Array<Record<string, unknown>> = [];
vi.mock("@/lib/request-action", () => ({
  requestAction: async (_req: unknown, spec: Record<string, unknown>) => {
    calls.push(spec);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  },
}));
// The route must not reach any of these on the cloud deploy.
const touched: string[] = [];
vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: async () => {
    touched.push("resolveUser");
    return { ok: false, res: new Response("{}", { status: 401 }) };
  },
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: async () => {
    touched.push("requireAuth");
    return null;
  },
}));

const ROUTE = "@/app/api/positions/[legacyId]/apply-request/route";
const req = (method: string) =>
  new NextRequest("https://site.example/api/positions/7/apply-request", {
    method,
  });
const ctx = (id: string) => ({ params: Promise.resolve({ legacyId: id }) });

beforeEach(() => {
  calls.length = 0;
  touched.length = 0;
  vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
});
afterEach(() => vi.unstubAllEnvs());

describe("the apply-request route on the cloud deploy", () => {
  it("authorising is an L3 action on the door, with the position from the address", async () => {
    const { POST } = await import(ROUTE);
    expect((await POST(req("POST"), ctx("7"))).status).toBe(200);
    expect(calls).toEqual([
      {
        action: "position.apply_authorize",
        level: "L3",
        params: { legacy_id: 7 },
      },
    ]);
  });

  it("withdrawing is an L1 action with DELETE, immediate", async () => {
    const { DELETE } = await import(ROUTE);
    expect((await DELETE(req("DELETE"), ctx("7"))).status).toBe(200);
    expect(calls).toEqual([
      {
        action: "position.apply_revoke",
        level: "L1",
        method: "DELETE",
        params: { legacy_id: 7 },
      },
    ]);
  });

  it.each(["0", "-1", "7abc", "07", "1e3", "", "99999999999", "7 "])(
    "an address that is not a plain position number (%j) never reaches the door",
    async (id) => {
      const { POST } = await import(ROUTE);
      expect((await POST(req("POST"), ctx(id))).status).toBe(400);
      expect(calls).toEqual([]);
    },
  );

  it("reads no session and no table of its own before the door", async () => {
    const { POST } = await import(ROUTE);
    await POST(req("POST"), ctx("7"));
    expect(touched).toEqual([]);
  });
});

describe("the button's two steps", () => {
  const ROW = "22222222-2222-4222-8222-222222222222";
  const reply = (status: number, body: unknown) =>
    vi.fn(
      async (..._a: unknown[]) =>
        new Response(JSON.stringify(body), { status }),
    );

  it("the first call asks for the confirmation and shows the server's text, authorising nothing", async () => {
    const { startAuthorisation } =
      await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
    const f = reply(200, {
      ok: true,
      state: "awaiting_confirm",
      id: ROW,
      level: "L3",
      summary: "Backend Engineer @ Acme",
      expiresAt: "2026-10-22T12:02:00Z",
    });
    expect(await startAuthorisation(7, f as unknown as typeof fetch)).toEqual({
      ok: true,
      step: "confirm",
      id: ROW,
      summary: "Backend Engineer @ Acme",
      expiresAt: "2026-10-22T12:02:00Z",
    });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/positions/7/apply-request");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(init.body).toBe("{}");
  });

  it("a first reply with no text, or that is already 'queued', is not a confirmation", async () => {
    const { startAuthorisation } =
      await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
    for (const body of [
      {
        ok: true,
        state: "awaiting_confirm",
        id: ROW,
        summary: "  ",
        expiresAt: null,
      },
      { ok: true, state: "queued", id: ROW, summary: "x", expiresAt: null },
      { ok: true, state: "awaiting_confirm", summary: "x", expiresAt: null },
    ]) {
      const out = await startAuthorisation(
        7,
        reply(200, body) as unknown as typeof fetch,
      );
      expect(out.ok).toBe(false);
    }
  });

  it("the second call carries only the confirmation id, and only 'queued' counts as done", async () => {
    const { confirmAuthorisation } =
      await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
    const f = reply(200, {
      ok: true,
      state: "queued",
      id: ROW,
      level: "L3",
      summary: "x",
      expiresAt: null,
    });
    expect(
      await confirmAuthorisation(7, ROW, f as unknown as typeof fetch),
    ).toEqual({ ok: true, step: "done" });
    expect(
      JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string),
    ).toEqual({ confirmId: ROW });
    const again = reply(200, {
      ok: true,
      state: "awaiting_confirm",
      id: ROW,
      summary: "x",
      expiresAt: "2026-10-22T12:02:00Z",
    });
    expect(
      (await confirmAuthorisation(7, ROW, again as unknown as typeof fetch)).ok,
    ).toBe(false);
  });

  it("a 'done' counts as done for the second call and for the withdrawal", async () => {
    const { confirmAuthorisation, withdrawAuthorisation } =
      await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
    const done = () =>
      reply(200, {
        ok: true,
        state: "done",
        id: ROW,
        level: "L3",
        summary: "",
        expiresAt: null,
      });
    expect(
      await confirmAuthorisation(7, ROW, done() as unknown as typeof fetch),
    ).toEqual({ ok: true, step: "done" });
    expect(
      await withdrawAuthorisation(7, done() as unknown as typeof fetch),
    ).toEqual({ ok: true, step: "done" });
  });

  it("withdrawing is a DELETE that counts only when the door says 'queued'", async () => {
    const { withdrawAuthorisation } =
      await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
    const f = reply(200, {
      ok: true,
      state: "queued",
      id: ROW,
      level: "L1",
      summary: "",
      expiresAt: null,
    });
    expect(
      await withdrawAuthorisation(7, f as unknown as typeof fetch),
    ).toEqual({ ok: true, step: "done" });
    expect((f.mock.calls[0] as [string, RequestInit])[1].method).toBe("DELETE");
    expect(
      (
        await withdrawAuthorisation(
          7,
          reply(200, { apply_requested: false }) as unknown as typeof fetch,
        )
      ).ok,
    ).toBe(false);
  });

  it.each([
    [401, "reauth_required", "refused_reauth_required"],
    [429, "rate_limited", "refused_rate_limited"],
    [410, "confirm_expired", "refused_confirm_stale"],
    [409, "confirm_used", "refused_confirm_stale"],
    [409, "already_submitted", "refused_already_submitted"],
    [409, "position_not_ready", "refused_position_not_ready"],
  ])(
    "the refusal %s %s is said with its own sentence",
    async (status, code, key) => {
      const { startAuthorisation, refusalText } =
        await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
      const out = await startAuthorisation(
        7,
        reply(status, { ok: false, error: code }) as unknown as typeof fetch,
      );
      expect(out).toEqual({ ok: false, error: code, status });
      expect(refusalText((k: string) => k, code)).toBe(key);
    },
  );
});

describe("two roads to the same route, chosen by the page", () => {
  const ROW = "22222222-2222-4222-8222-222222222222";
  const read = (p: string) =>
    readFileSync(join(__dirname, "../../..", p), "utf8");
  const button = read(
    "web/app/(protected)/positions/[id]/ApplyRequestButton.tsx",
  );
  const page = read("web/app/(protected)/positions/[id]/page.tsx");

  it("the page decides: the site (cloud deploy) takes the door, everywhere else keeps the one-step road", () => {
    expect(page).toMatch(
      /<ApplyRequestButton[^>]*twoStep=\{isCloudDeploy\(\)\}/s,
    );
  });

  it("the button wires the door's three calls only when twoStep, and the one-step road otherwise", () => {
    expect(button).toMatch(
      /onAuthorise=\{\s*twoStep \? \(\) => void startTwoStep\(\) : \(\) => setConfirming\(true\)/,
    );
    expect(button).toMatch(
      /onConfirm=\{twoStep \? \(\) => void confirmTwoStep\(\) : \(\) => void send\(true\)\}/,
    );
    expect(button).toMatch(
      /onWithdraw=\{\s*twoStep \? \(\) => void withdrawTwoStep\(\) : \(\) => void send\(false\)/,
    );
  });

  it("the door never accepts the desktop's word: {confirmed:true} is refused, so the two roads cannot be swapped", async () => {
    const { parseBody } = await vi.importActual<
      typeof import("@/lib/request-action")
    >("@/lib/request-action");
    expect(parseBody(JSON.stringify({ confirmed: true }))).toBeNull();
    expect(
      parseBody(JSON.stringify({ params: {}, confirmed: true })),
    ).toBeNull();
  });

  it("the site's calls carry only what the door takes: '{}' first, then the confirmation id alone", async () => {
    const { startAuthorisation, confirmAuthorisation, withdrawAuthorisation } =
      await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
    const f = vi.fn(
      async (..._a: unknown[]) =>
        new Response(
          JSON.stringify({
            ok: true,
            state: "awaiting_confirm",
            id: ROW,
            summary: "x",
            expiresAt: null,
          }),
          { status: 200 },
        ),
    );
    await startAuthorisation(7, f as unknown as typeof fetch);
    await confirmAuthorisation(7, ROW, f as unknown as typeof fetch);
    await withdrawAuthorisation(7, f as unknown as typeof fetch);
    const bodies = f.mock.calls.map((c) =>
      JSON.parse(((c as unknown[])[1] as RequestInit).body as string),
    );
    expect(bodies).toEqual([{}, { confirmId: ROW }, {}]);
    for (const b of bodies) expect(Object.keys(b)).not.toContain("confirmed");
  });

  it("the one-step road (desktop and local web) never sends what the door reads, and may carry only the desktop's word", async () => {
    const { submitApplyRequest } =
      await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
    const f = vi.fn(
      async (..._a: unknown[]) =>
        new Response(JSON.stringify({ apply_requested: true }), {
          status: 200,
        }),
    );
    await submitApplyRequest(7, true, f as unknown as typeof fetch);
    const init = (f.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = init.body === undefined ? {} : JSON.parse(init.body as string);
    for (const key of Object.keys(body)) expect(["confirmed"]).toContain(key);
    expect(body).not.toHaveProperty("confirmId");
    expect(body).not.toHaveProperty("params");
  });
});
