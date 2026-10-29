import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetReadsInFlight, PAGE_READ_DEADLINE_MS, READ_IN_FLIGHT_MAX_MS, ReadDeadlineError, readOnce, withReadDeadline } from "./read-deadline";

beforeEach(() => {
  forgetReadsInFlight();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("withReadDeadline", () => {
  it("passes on what answers in time, and what fails in time", async () => {
    await expect(withReadDeadline(Promise.resolve("rows"))).resolves.toBe("rows");
    await expect(withReadDeadline(Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends a read that never answers, instead of waiting for ever", async () => {
    const never = new Promise<string>(() => undefined);
    const outcome = withReadDeadline(never).then(() => "answered", (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(PAGE_READ_DEADLINE_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(ReadDeadlineError);
  });
});

describe("readOnce", () => {
  it("starts one read for the same key while it runs, and gives every ask its answer", async () => {
    let answer!: (rows: string) => void;
    const start = vi.fn(() => new Promise<string>((resolve) => { answer = resolve; }));
    const first = readOnce("page", start);
    const second = readOnce("page", start);
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledTimes(1);
    answer("rows");
    await expect(first).resolves.toBe("rows");
    await expect(second).resolves.toBe("rows");
  });

  it("keeps waiting for a read that passed its deadline: asking again does not start a second", async () => {
    const start = vi.fn(() => new Promise<string>(() => undefined));
    const outcome = withReadDeadline(readOnce("page", start)).then(() => "answered", (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(PAGE_READ_DEADLINE_MS);
    expect(await outcome).toBeInstanceOf(ReadDeadlineError);
    void withReadDeadline(readOnce("page", start)).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts a new read once the first ended, whether it answered or failed", async () => {
    const start = vi.fn().mockResolvedValueOnce("one").mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("three");
    await expect(readOnce("page", start)).resolves.toBe("one");
    await expect(readOnce("page", start)).rejects.toThrow("offline");
    await expect(readOnce("page", start)).resolves.toBe("three");
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("does not wait for ever for a read that never ends: past the window an ask starts a new read", async () => {
    const start = vi.fn().mockReturnValueOnce(new Promise<string>(() => undefined)).mockResolvedValueOnce("again");
    void readOnce("page", start);
    await vi.advanceTimersByTimeAsync(READ_IN_FLIGHT_MAX_MS - 1);
    void readOnce("page", start);
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(readOnce("page", start)).resolves.toBe("again");
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("keeps two keys apart, and forgets every running read when told to (the next account)", async () => {
    const start = vi.fn(() => new Promise<string>(() => undefined));
    void readOnce("dashboard", start);
    void readOnce("swipe", start);
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledTimes(2);
    forgetReadsInFlight();
    void readOnce("dashboard", start);
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("starts the read at once, and a loader that throws is a failed read, not a throw", async () => {
    const start = vi.fn(() => Promise.resolve("rows"));
    void readOnce("sync", start);
    expect(start).toHaveBeenCalledTimes(1);
    await expect(readOnce("page", () => { throw new Error("sync"); })).rejects.toThrow("sync");
  });
});
