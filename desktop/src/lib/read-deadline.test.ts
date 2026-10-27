import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_READ_DEADLINE_MS, ReadDeadlineError, withReadDeadline } from "./read-deadline";

beforeEach(() => vi.useFakeTimers());
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
