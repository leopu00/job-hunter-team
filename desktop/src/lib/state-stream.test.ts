import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  onStreamHint,
  onStreamState,
  parseStreamHint,
  parseStreamStatus,
  resetStateStreamForTests,
  startStateStream,
  streamPace,
  streamState,
  useStreamState,
} from "./state-stream";

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();
const emit = (name: string, payload: unknown) => handlers.get(name)!({ payload });

function nativeSays(answer: unknown) {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command !== "state_stream_status") throw { code: "unknown_command" };
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

beforeEach(() => {
  resetStateStreamForTests();
  handlers.clear();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(listen).mockImplementation((async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }) as unknown as typeof listen);
  nativeSays({ state: "off", since_ms: 0 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("what the page believes about the channel", () => {
  it("is off outside the desktop and never asks", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await startStateStream();
    expect(streamState()).toBe("off");
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it("takes the state the native side answers when it starts", async () => {
    nativeSays({ state: "up", since_ms: 1200 });
    await startStateStream();
    expect(streamState()).toBe("up");
  });

  it("is off when the app has no such command, or the answer is not a state", async () => {
    nativeSays(new Error("unknown command"));
    await startStateStream();
    expect(streamState()).toBe("off");
    resetStateStreamForTests();
    nativeSays({ state: "maybe" });
    await startStateStream();
    expect(streamState()).toBe("off");
  });

  it("is off when it cannot listen", async () => {
    vi.mocked(listen).mockRejectedValue(new Error("no events"));
    nativeSays({ state: "up", since_ms: 1 });
    await startStateStream();
    expect(streamState()).toBe("off");
  });

  it("follows the status events and tells who listens, once per change", async () => {
    await startStateStream();
    const heard: string[] = [];
    onStreamState((next) => heard.push(next));
    emit("state-stream://status", { state: "up", since_ms: 0 });
    emit("state-stream://status", { state: "up", since_ms: 40 });
    emit("state-stream://status", { state: "fallback", since_ms: 0 });
    emit("state-stream://status", { state: "nonsense" });
    expect(heard).toEqual(["up", "fallback", "off"]);
  });

  it("does not let a late answer of the command overwrite a status event that came after it was asked", async () => {
    let answer!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const started = startStateStream();
    await vi.waitFor(() => expect(handlers.size).toBe(2));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    emit("state-stream://status", { state: "fallback", since_ms: 0 });
    answer({ state: "up", since_ms: 9000 });
    await started;
    expect(streamState()).toBe("fallback");
  });

  it("asks again when the window is seen again", async () => {
    nativeSays({ state: "off", since_ms: 0 });
    await startStateStream();
    nativeSays({ state: "up", since_ms: 5 });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(streamState()).toBe("up"));
  });

  it("starts once however many times it is called", async () => {
    await startStateStream();
    await startStateStream();
    expect(listen).toHaveBeenCalledTimes(2);
  });

  it("gives React the state", async () => {
    await startStateStream();
    const { result } = renderHook(() => useStreamState());
    expect(result.current).toBe("off");
    act(() => emit("state-stream://status", { state: "up", since_ms: 0 }));
    expect(result.current).toBe("up");
  });
});

describe("the pace of a poll", () => {
  it("slows down only while the channel is up, and never speeds up", async () => {
    await startStateStream();
    expect(streamPace(20_000, 60_000)).toBe(20_000);
    emit("state-stream://status", { state: "up", since_ms: 0 });
    expect(streamPace(20_000, 60_000)).toBe(60_000);
    expect(streamPace(20_000, 5_000)).toBe(20_000);
    emit("state-stream://status", { state: "fallback", since_ms: 0 });
    expect(streamPace(20_000, 60_000)).toBe(20_000);
  });
});

describe("the hints", () => {
  it("accepts only the closed shapes", () => {
    expect(parseStreamHint({ topic: "agents" })).toEqual({ topic: "agents" });
    expect(parseStreamHint({ topic: "chat", agent: "captain" })).toEqual({ topic: "chat", agent: "captain" });
    expect(parseStreamHint({ topic: "chat", agent: "../etc" })).toBeNull();
    expect(parseStreamHint({ topic: "chat", agent: 4 })).toBeNull();
    expect(parseStreamHint({ topic: "positions" })).toEqual({ topic: "positions" });
    expect(parseStreamHint({ topic: "not_a_topic" })).toBeNull();
    expect(parseStreamHint("agents")).toBeNull();
    expect(parseStreamHint(null)).toBeNull();
    expect(parseStreamStatus({ state: "up" })).toBe("up");
    expect(parseStreamStatus(undefined)).toBeNull();
  });

  it("calls the ones that listen for that topic and ignores a payload it does not know", async () => {
    await startStateStream();
    const agents = vi.fn();
    const profile = vi.fn();
    onStreamHint("agents", agents);
    onStreamHint("profile", profile);
    emit("state-stream://event", { topic: "agents" });
    emit("state-stream://event", { topic: "nonsense" });
    emit("state-stream://event", { topic: "profile", extra: "text of the container" });
    expect(agents).toHaveBeenCalledTimes(1);
    expect(profile).toHaveBeenCalledTimes(1);
  });

  it("turns a burst into one call at once and one at the end of the gap", async () => {
    vi.useFakeTimers();
    await startStateStream();
    const read = vi.fn();
    onStreamHint("agents", read, 3_000);
    for (let i = 0; i < 12; i++) emit("state-stream://event", { topic: "agents" });
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_999);
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(read).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(read).toHaveBeenCalledTimes(2);
    emit("state-stream://event", { topic: "agents" });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("stops listening, and drops a call that was waiting", async () => {
    vi.useFakeTimers();
    await startStateStream();
    const read = vi.fn();
    const stop = onStreamHint("agents", read, 3_000);
    emit("state-stream://event", { topic: "agents" });
    emit("state-stream://event", { topic: "agents" });
    stop();
    vi.advanceTimersByTime(10_000);
    emit("state-stream://event", { topic: "agents" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("filters by the agent when the hint names one", async () => {
    await startStateStream();
    const read = vi.fn();
    onStreamHint("chat", read, 0, "captain");
    emit("state-stream://event", { topic: "chat", agent: "scout" });
    expect(read).not.toHaveBeenCalled();
    emit("state-stream://event", { topic: "chat", agent: "captain" });
    emit("state-stream://event", { topic: "chat" });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
