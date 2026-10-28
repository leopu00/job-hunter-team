import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderWindowBanner } from "./ProviderWindowBanner";
import type { ProviderWindowResult } from "../lib/provider-window-native";

const NOW = 1_793_300_000_000;
const win = (usedPct: number | null, over: Record<string, unknown> = {}): ProviderWindowResult => ({
  ok: true, window: { provider: "codex", usedPct, resetAtUnix: NOW / 1000 + 7200, updatedAtUnix: NOW / 1000 - 30, ...over },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the provider window banner", () => {
  it("shows nothing while the window has room, or the team has no record", async () => {
    const read = vi.fn().mockResolvedValue(win(40));
    render(<ProviderWindowBanner read={read} locale="en" now={() => NOW} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.queryByTestId("provider-window-banner")).toBeNull();
    read.mockResolvedValue({ ok: false, error: "window_unavailable" });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.queryByTestId("provider-window-banner")).toBeNull();
  });

  it("warns near the limit, says the window is gone with the renewal time, and goes away by itself", async () => {
    const read = vi.fn().mockResolvedValue(win(94));
    render(<ProviderWindowBanner read={read} locale="en" now={() => NOW} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByTestId("provider-window-banner")).toHaveTextContent("(94%)");
    expect(screen.getByRole("status")).toHaveAttribute("data-kind", "near");

    read.mockResolvedValue(win(100));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByTestId("provider-window-banner")).toHaveAttribute("data-kind", "done");
    expect(screen.getByTestId("provider-window-banner")).toHaveTextContent(/the team resumes at \d\d:\d\d\./);

    read.mockResolvedValue(win(30));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.queryByTestId("provider-window-banner")).toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("asks once a minute and stops asking when it is closed", async () => {
    const read = vi.fn().mockResolvedValue(win(10));
    const { unmount } = render(<ProviderWindowBanner read={read} locale="en" now={() => NOW} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(read).toHaveBeenCalledTimes(4);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("shows nothing when the reading fails", async () => {
    render(<ProviderWindowBanner read={() => Promise.reject(new Error("boom"))} locale="en" now={() => NOW} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.queryByTestId("provider-window-banner")).toBeNull();
  });
});
