import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILE_FIELD_KEYS } from "./contract";
import { PROFILE_PROGRESS_EVERY_MS, useProfileProgress } from "./useProfileProgress";
import type { ProfileProgressRead } from "./read";

function reading(done: number): ProfileProgressRead {
  return {
    ok: true,
    reading: {
      required: 8,
      done,
      ready: done === 8,
      fields: PROFILE_FIELD_KEYS.map((key, index) => ({ key, ok: index < done })),
    },
  };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setVisibility("visible");
});

async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("the profile progress, read while the card is there", () => {
  it("reads at once and then every few seconds, the card following what the team wrote", async () => {
    const results = [reading(1), reading(2), reading(5)];
    const read = vi.fn(async () => results.shift() ?? reading(5));
    const { result } = renderHook(() => useProfileProgress(read));
    expect(result.current.state).toBe("loading");
    await tick(0);
    expect(result.current.state).toBe("ready");
    expect(result.current.filled).toBe(1);
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(result.current.filled).toBe(2);
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(result.current.filled).toBe(5);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("does not read while the window is hidden, and reads at once when it is seen again", async () => {
    const read = vi.fn(async () => reading(2));
    renderHook(() => useProfileProgress(read));
    await tick(0);
    setVisibility("hidden");
    await tick(PROFILE_PROGRESS_EVERY_MS * 5);
    expect(read).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await tick(0);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("stops with the card", async () => {
    const read = vi.fn(async () => reading(2));
    const { unmount } = renderHook(() => useProfileProgress(read));
    await tick(0);
    unmount();
    await tick(PROFILE_PROGRESS_EVERY_MS * 5);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("says unavailable when the first read fails, and comes back by itself when the profile appears", async () => {
    const results: ProfileProgressRead[] = [{ ok: false, code: "profile_unavailable" }, reading(3)];
    const read = vi.fn(async () => results.shift() ?? reading(3));
    const { result } = renderHook(() => useProfileProgress(read));
    await tick(0);
    expect(result.current.state).toBe("unavailable");
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(result.current.state).toBe("ready");
    expect(result.current.filled).toBe(3);
  });

  it("keeps what it read when a later read fails", async () => {
    const results: ProfileProgressRead[] = [reading(4), { ok: false, code: "profile_unreadable" }];
    const read = vi.fn(async () => results.shift() ?? { ok: false as const, code: "profile_unreadable" });
    const { result } = renderHook(() => useProfileProgress(read));
    await tick(0);
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(result.current.state).toBe("ready");
    expect(result.current.filled).toBe(4);
  });

  it("does not start a second read while one is on its way", async () => {
    let release: (() => void) | null = null;
    const read = vi.fn(() => new Promise<ProfileProgressRead>((resolve) => { release = () => resolve(reading(2)); }));
    renderHook(() => useProfileProgress(read, 1_000));
    await tick(0);
    setVisibility("hidden");
    setVisibility("visible");
    await tick(5_000);
    expect(read).toHaveBeenCalledTimes(1);
    release!();
    await tick(0);
  });
});
