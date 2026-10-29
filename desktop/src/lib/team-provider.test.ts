import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProviderSignIn, signOutProvider } from "./team-provider";

// The page's side of the native `team_provider` command: what it sends, and that a reply out of the closed shape
// is an error and never a sign-in made up. Synthetic replies only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

beforeEach(() => {
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
});

describe("team-provider", () => {
  it("asks the status with the closed request and nothing else", async () => {
    native.invoke.mockResolvedValue({ ok: true, provider: "codex", authenticated: true });
    expect(await readProviderSignIn()).toEqual({ ok: true, value: { provider: "codex", authenticated: true } });
    expect(native.invoke.mock.calls).toEqual([["team_provider", { request: { op: "status" } }]]);
  });

  it("takes the sign-in off with `confirmed: true`, and no provider or file named", async () => {
    native.invoke.mockResolvedValue({ ok: true, provider: "claude", authenticated: false, removed: 2 });
    expect(await signOutProvider()).toEqual({ ok: true, value: { provider: "claude", authenticated: false } });
    expect(native.invoke.mock.calls).toEqual([["team_provider", { request: { op: "logout", confirmed: true } }]]);
  });

  it("outside the desktop app it asks nothing", async () => {
    native.isTauri.mockReturnValue(false);
    expect(await readProviderSignIn()).toEqual({ ok: false, code: "desktop_only" });
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("a reply out of the closed shape is an error, never a sign-in", async () => {
    for (const reply of [null, "ok", {}, { ok: true }, { ok: true, provider: "openai", authenticated: true }, { ok: true, provider: "../x", authenticated: false }, { ok: true, provider: "codex", authenticated: "no" }]) {
      native.invoke.mockResolvedValue(reply);
      expect(await readProviderSignIn()).toEqual({ ok: false, code: "team_provider_unavailable" });
    }
  });

  it("an error keeps its closed code, and anything that is not a code becomes «unavailable»", async () => {
    native.invoke.mockResolvedValue({ ok: false, error: "provider_logout_incomplete" });
    expect(await signOutProvider()).toEqual({ ok: false, code: "provider_logout_incomplete" });
    native.invoke.mockResolvedValue({ ok: false, error: "rm: /jht_home/.codex/auth.json: denied" });
    expect(await signOutProvider()).toEqual({ ok: false, code: "team_provider_unavailable" });
    native.invoke.mockRejectedValue(new Error("boom"));
    expect(await signOutProvider()).toEqual({ ok: false, code: "team_provider_unavailable" });
  });
});
