import { afterEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../lib/existing-team-readonly";
import { setLocalTeamData } from "../lib/local-team-data";
import { installApiBridge, notInDesktop, shellApi, webRoutes, type ApiFetch } from "./api-bridge";

function fakeGlobal() {
  const real = vi.fn(async () => new Response("real"));
  return { target: { fetch: real } as unknown as typeof globalThis, real };
}

describe("installApiBridge", () => {
  it("answers only same-origin /api calls, and hands everything else to the real fetch", async () => {
    const { target, real } = fakeGlobal();
    const answer: ApiFetch = vi.fn(async () => new Response("bridged"));
    const restore = installApiBridge(answer, target);

    expect(await (await target.fetch("/api/positions/7/summary")).text()).toBe("bridged");
    expect(await (await target.fetch(new URL("/api/x", window.location.href))).text()).toBe("bridged");
    expect(await (await target.fetch("https://project.supabase.co/rest/v1/positions")).text()).toBe("real");
    expect(await (await target.fetch("/assets/app.js")).text()).toBe("real");
    expect(answer).toHaveBeenCalledTimes(2);
    expect(real).toHaveBeenCalledTimes(2);

    restore();
    await target.fetch("/api/positions/7/summary");
    expect(real).toHaveBeenCalledTimes(3);
  });
});

describe("shellApi", () => {
  it("answers the web's locale route and passes the rest on", async () => {
    const next = vi.fn(notInDesktop);
    const api = shellApi(next);
    const i18n = await api("/api/i18n?t=1");
    expect(i18n.status).toBe(200);
    expect(await i18n.json()).toMatchObject({ current: "it" });

    const other = await api("/api/positions/7/cv", { method: "POST" });
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: "not_in_desktop", path: "/api/positions/7/cv" });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("shellApi, the language the person picks", () => {
  const post = (locale: unknown) =>
    ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale }) }) satisfies RequestInit;
  afterEach(() => {
    document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
    leaveExistingTeamReadOnly();
  });

  it("keeps a language the app has in the NEXT_LOCALE cookie and answers it as the web does", async () => {
    const next = vi.fn(notInDesktop);
    const answer = await shellApi(next)("/api/i18n", post("de"));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ locale: "de" });
    expect(document.cookie).toContain("NEXT_LOCALE=de");
    expect(next).not.toHaveBeenCalled();
  });

  it.each(["xx", "", 7, null])("refuses %j with a 400 and keeps the language it had", async (locale) => {
    document.cookie = "NEXT_LOCALE=fr; path=/";
    const answer = await shellApi(vi.fn(notInDesktop))("/api/i18n", post(locale));
    expect(answer.status).toBe(400);
    expect(document.cookie).toContain("NEXT_LOCALE=fr");
  });

  it("works while an existing team is only read (it writes nothing to the team), and nothing else does", async () => {
    enterExistingTeamReadOnly(true, null);
    const next = vi.fn(notInDesktop);
    const api = shellApi(next);
    expect((await api("/api/i18n", post("es"))).status).toBe(200);
    expect(document.cookie).toContain("NEXT_LOCALE=es");
    const other = await api("/api/positions/7/summary", { method: "POST" });
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: "read_only" });
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses what the positions pages would change in the team of this computer, and only that", async () => {
    setLocalTeamData("local:abc");
    try {
      const next = vi.fn(notInDesktop);
      const api = shellApi(next);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const refused = await api("/api/positions/7/user-note", { method });
        expect(refused.status, method).toBe(403);
        expect(await refused.json()).toEqual({ error: "read_only" });
      }
      expect(next).not.toHaveBeenCalled();
      // the reads of the positions pages, and the routes of the other pages, keep going where they went
      await api("/api/positions/facets", { method: "GET" });
      await api("/api/settings/anything", { method: "POST" });
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      setLocalTeamData(null);
    }
  });

  it("lets the writes through once the existing team is connected in full (the judgement bridge answers them)", async () => {
    enterExistingTeamReadOnly(true, null, "account:full-link|full", true);
    const next = vi.fn(notInDesktop);
    const other = await shellApi(next)("/api/positions/7/summary", { method: "POST" });
    expect(other.status).not.toBe(403);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("webRoutes", () => {
  it("calls the web handler for the method, with the path params as Next passes them", async () => {
    const POST = vi.fn(async (request: Request, { params }: { params: Promise<Record<string, string>> }) =>
      Response.json({ id: (await params).id, body: await request.json() }),
    );
    const next = vi.fn(notInDesktop);
    const api = webRoutes({ "/api/pending-messages/[id]/ack": { POST } }, next);

    const res = await api("/api/pending-messages/abc/ack?x=1", { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(await res.json()).toEqual({ id: "abc", body: { a: 1 } });
    // Next hands route handlers a NextRequest: nextUrl is there.
    expect((POST.mock.calls[0][0] as unknown as { nextUrl: URL }).nextUrl.searchParams.get("x")).toBe("1");

    expect((await api("/api/pending-messages/abc/ack")).status).toBe(405);
    expect((await api("/api/pending-messages/abc/other", { method: "POST" })).status).toBe(404);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
