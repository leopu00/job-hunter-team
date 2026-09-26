import { describe, expect, it, vi } from "vitest";
import { installApiBridge, notInDesktop, shellApi, type ApiFetch } from "./api-bridge";

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
