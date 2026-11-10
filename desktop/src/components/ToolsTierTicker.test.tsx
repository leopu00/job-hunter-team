import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolsTier } from "../lib/tools-tier";
import ToolsTierTicker from "./ToolsTierTicker";

const at = (state: ToolsTier["state"], tier: ToolsTier["tier"] = "core", message: ToolsTier["message"] = null): ToolsTier => ({ state, tier, message });

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// act with fake timers: the effects of the changed state start when the act ends, so advance a little first, then the long time.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("ToolsTierTicker", () => {
  it("says nothing when the tools are not a thing here", async () => {
    const tick = vi.fn(async () => at("none", "full"));
    render(<ToolsTierTicker tick={tick} />);
    await advance(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the download while it lasts, asks again every 20 s, and says when the team moved on, then goes quiet for good", async () => {
    const answers = [at("pulling"), at("ready"), at("ready", "full", "ui_phase_tools_ready")];
    const tick = vi.fn(async () => answers.shift() ?? null);
    render(<ToolsTierTicker tick={tick} />);
    await advance(0);
    expect(screen.getByRole("status").textContent).toMatch(/strumenti/i);
    await advance(20_000);
    expect(tick).toHaveBeenCalledTimes(2);
    await advance(20_000);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status").textContent).toMatch(/pronti/i);
    await advance(9_000);
    expect(screen.queryByRole("status")).toBeNull();
    // on the full image nothing is scheduled any more
    await advance(600_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("does not ask again after it is taken off the screen", async () => {
    const tick = vi.fn(async () => at("pulling"));
    const view = render(<ToolsTierTicker tick={tick} />);
    await advance(0);
    view.unmount();
    await advance(120_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
