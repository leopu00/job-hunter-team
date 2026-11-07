import { describe, expect, it, vi } from "vitest";
import { pickProviderLoginState, readProviderLoginState, teamRefusesSignIn } from "./provider-login-native";

describe("provider login state: the reply closed again", () => {
  it("accepts the listed states and providers and nothing else", () => {
    for (const state of ["ready", "probably_expired", "expired", "missing", "unreadable", "not_applicable"]) {
      expect(pickProviderLoginState({ ok: true, state, provider: "codex", here: true })).toEqual({ ok: true, state, provider: "codex", here: true });
    }
    for (const provider of ["claude", "codex", "kimi", "none"]) {
      expect(pickProviderLoginState({ ok: true, state: "ready", provider, here: false })).toEqual({ ok: true, state: "ready", provider, here: false });
    }
  });

  it("refuses an unknown word, an unknown provider, an extra field or a wrong type: provider_login_reply_unexpected", () => {
    const unexpected = { ok: false, error: "provider_login_reply_unexpected" };
    expect(pickProviderLoginState({ ok: true, state: "a sentence from the team", provider: "codex", here: true })).toEqual(unexpected);
    expect(pickProviderLoginState({ ok: true, state: "ready", provider: "another", here: true })).toEqual(unexpected);
    expect(pickProviderLoginState({ ok: true, state: "ready", provider: "codex", here: true, token: "fake-token" })).toEqual(unexpected);
    expect(pickProviderLoginState({ ok: true, state: "ready", provider: "codex" })).toEqual(unexpected);
    expect(pickProviderLoginState({ ok: true, state: "ready", provider: "codex", here: "yes" })).toEqual(unexpected);
    expect(pickProviderLoginState({ ok: true, state: 1, provider: "codex", here: true })).toEqual(unexpected);
    expect(pickProviderLoginState(["ready"])).toEqual(unexpected);
    expect(pickProviderLoginState(null)).toEqual(unexpected);
    expect(pickProviderLoginState({ state: "ready", provider: "codex" })).toEqual(unexpected);
  });

  it("a failed read keeps where the team runs, and the chat's own codes pass", () => {
    expect(pickProviderLoginState({ ok: false, error: "disconnected", here: false })).toEqual({ ok: false, error: "disconnected", here: false });
    expect(pickProviderLoginState({ ok: false, error: "process_timeout", here: true })).toEqual({ ok: false, error: "process_timeout", here: true });
    expect(pickProviderLoginState({ ok: false, error: "read_failed", here: true })).toEqual({ ok: false, error: "provider_login_unreadable", here: true });
  });

  it("passes a known failure code on and turns any other into the generic one", () => {
    expect(pickProviderLoginState({ ok: false, error: "provider_login_reply_unexpected" })).toEqual({ ok: false, error: "provider_login_reply_unexpected" });
    expect(pickProviderLoginState({ ok: false, error: "provider_login_unreadable" })).toEqual({ ok: false, error: "provider_login_unreadable" });
    expect(pickProviderLoginState({ ok: false, error: "rm -rf / or a sentence" })).toEqual({ ok: false, error: "provider_login_unreadable" });
    expect(pickProviderLoginState({ ok: false, error: "provider_login_something_else" })).toEqual({ ok: false, error: "provider_login_unreadable" });
  });
});

describe("readProviderLoginState", () => {
  const good = { ok: true, state: "expired", provider: "codex", here: true };

  it("tells a native error by its own code, and the chat's «read_failed» as the sign-in's own", async () => {
    expect(await readProviderLoginState(vi.fn().mockRejectedValue({ code: "process_timeout" }))).toEqual({ ok: false, error: "process_timeout" });
    expect(await readProviderLoginState(vi.fn().mockRejectedValue({ code: "read_failed" }))).toEqual({ ok: false, error: "provider_login_unreadable" });
    expect(await readProviderLoginState(vi.fn().mockRejectedValue(new Error("no code")))).toEqual({ ok: false, error: "provider_login_unreadable" });
  });

  it("connects the chat again once when it is not connected, and reads again", async () => {
    const call = vi.fn().mockRejectedValueOnce({ code: "disconnected" }).mockResolvedValueOnce(good);
    const reconnect = vi.fn().mockResolvedValue(undefined);
    expect(await readProviderLoginState(call, reconnect)).toEqual(good);
    expect(reconnect).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("does not loop: a chat that stays disconnected is told as it is, after one reconnection", async () => {
    const call = vi.fn().mockRejectedValue({ code: "disconnected" });
    const reconnect = vi.fn().mockResolvedValue(undefined);
    expect(await readProviderLoginState(call, reconnect)).toEqual({ ok: false, error: "disconnected" });
    expect(reconnect).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("says «disconnected» when the chat cannot be connected at all", async () => {
    const call = vi.fn().mockRejectedValue({ code: "disconnected" });
    const reconnect = vi.fn().mockRejectedValue({ code: "connect_failed" });
    expect(await readProviderLoginState(call, reconnect)).toEqual({ ok: false, error: "disconnected" });
    expect(call).toHaveBeenCalledOnce();
  });
});

describe("teamRefusesSignIn: only a word of the team says the sign-in is refused", () => {
  it("is true for expired, missing and unreadable, false for the rest and for a read that cannot be made", async () => {
    for (const state of ["expired", "missing", "unreadable"] as const) {
      expect(await teamRefusesSignIn(async () => ({ ok: true, state, provider: "codex", here: true }))).toBe(true);
    }
    for (const state of ["ready", "probably_expired", "not_applicable"] as const) {
      expect(await teamRefusesSignIn(async () => ({ ok: true, state, provider: "codex", here: true }))).toBe(false);
    }
    expect(await teamRefusesSignIn(async () => ({ ok: false, error: "disconnected" }))).toBe(false);
  });
});
