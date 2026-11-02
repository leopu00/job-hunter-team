import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({ state: "up", since_ms: 0 })), isTauri: vi.fn(() => true) }));
const handlers = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
}));

import { resetStateStreamForTests, startStateStream } from "../lib/state-stream";
import { PROFILE_FIELD_KEYS } from "./contract";
import { PROFILE_PROGRESS_EVERY_MS, PROFILE_PROGRESS_STREAMED_MS, useProfileProgress } from "./useProfileProgress";
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

const emitHint = (payload: unknown) => act(() => handlers.get("state-stream://event")!({ payload }));
const emitStatus = (state: string) => act(() => handlers.get("state-stream://status")!({ payload: { state, since_ms: 0 } }));
async function up() {
  await startStateStream();
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStateStreamForTests();
  handlers.clear();
});
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

  it("stops reading once the profile is complete, and looks once more when the window is seen again", async () => {
    const results = [reading(7), reading(8)];
    const read = vi.fn(async () => results.shift() ?? reading(8));
    const { result } = renderHook(() => useProfileProgress(read));
    await tick(0);
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(result.current.filled).toBe(8);
    expect(read).toHaveBeenCalledTimes(2);
    await tick(PROFILE_PROGRESS_EVERY_MS * 10);
    expect(read).toHaveBeenCalledTimes(2);
    setVisibility("hidden");
    setVisibility("visible");
    await tick(0);
    expect(read).toHaveBeenCalledTimes(3);
    await tick(PROFILE_PROGRESS_EVERY_MS * 10);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("starts reading again when the profile it finds on the look is no longer complete", async () => {
    const results = [reading(8), reading(5)];
    const read = vi.fn(async () => results.shift() ?? reading(5));
    const { result } = renderHook(() => useProfileProgress(read));
    await tick(0);
    setVisibility("hidden");
    setVisibility("visible");
    await tick(0);
    expect(result.current.filled).toBe(5);
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("reads no faster than every 15 s while the profile is not complete", () => {
    expect(PROFILE_PROGRESS_EVERY_MS).toBeGreaterThanOrEqual(15_000);
    expect(PROFILE_PROGRESS_EVERY_MS).toBeLessThanOrEqual(30_000);
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

describe("the profile progress with the channel to the team", () => {
  const status = (state: "up" | "fallback" | "off") => emitStatus(state);

  it("reads at the hint, and the timer only backs it up, slower, while the channel is up", async () => {
    await up();
    const read = vi.fn(async () => reading(2));
    renderHook(() => useProfileProgress(read));
    await tick(0);
    expect(read).toHaveBeenCalledTimes(1);
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(read).toHaveBeenCalledTimes(1);
    emitHint({ topic: "profile" });
    await tick(0);
    expect(read).toHaveBeenCalledTimes(2);
    await tick(PROFILE_PROGRESS_STREAMED_MS);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("goes back to today's pace as soon as the channel is not up", async () => {
    await up();
    const read = vi.fn(async () => reading(2));
    renderHook(() => useProfileProgress(read));
    await tick(0);
    expect(read).toHaveBeenCalledTimes(1);
    await tick(30_000);
    status("fallback");
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(read).toHaveBeenCalledTimes(2);
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("with no channel keeps the pace it always had and ignores a hint it should not hear", async () => {
    await up();
    status("off");
    const read = vi.fn(async () => reading(2));
    renderHook(() => useProfileProgress(read));
    await tick(0);
    await tick(PROFILE_PROGRESS_EVERY_MS);
    expect(read).toHaveBeenCalledTimes(2);
    emitHint({ topic: "agents" });
    await tick(0);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads once more at a hint even when the profile was complete, and the next hint stops listening on unmount", async () => {
    await up();
    const read = vi.fn(async () => reading(8));
    const { unmount } = renderHook(() => useProfileProgress(read));
    await tick(0);
    await tick(PROFILE_PROGRESS_STREAMED_MS * 2);
    expect(read).toHaveBeenCalledTimes(1);
    emitHint({ topic: "profile" });
    await tick(0);
    expect(read).toHaveBeenCalledTimes(2);
    unmount();
    emitHint({ topic: "profile" });
    await tick(5_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
