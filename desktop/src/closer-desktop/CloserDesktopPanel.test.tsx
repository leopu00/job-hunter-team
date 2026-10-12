import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CloserDesktopPanel, { displayPoint } from "./CloserDesktopPanel";
import { descriptor, frame } from "./fixtures.test-support";
import type { DesktopRequest } from "../lib/closer-desktop";

beforeEach(() => { vi.useFakeTimers(); localStorage.setItem("jht-lang", "en"); });
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
const advance = async (ms = 200) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe("Team assisted browser panel", () => {
  it("renders the real-display frame surface separately from the page artifact", async () => {
    let sequence = 0;
    const transport = vi.fn(async (r: DesktopRequest) => r.op === "frame" ? frame(++sequence) : descriptor());
    render(<CloserDesktopPanel onClose={vi.fn()} transport={transport} />);
    await advance();
    expect(screen.getByRole("img", { name: "VPS desktop · frames" })).toBeInTheDocument();
    expect(screen.getByText("Private image of the blocked page")).toBeInTheDocument();
    expect(screen.getByText(/Cleanup is opportunistic/)).toBeInTheDocument();
    expect(screen.queryByText(/noVNC/)).not.toBeInTheDocument();
  });
  it("has no input before server-authorized handoff, even with visible pixels", async () => {
    let sequence = 0;
    const transport = vi.fn(async (r: DesktopRequest) => r.op === "frame" ? frame(++sequence)
      : descriptor({ phase: "running", input_ready: false, allowed_actions: ["frame"] }));
    render(<CloserDesktopPanel onClose={vi.fn()} transport={transport} />);
    await advance();
    const surface = screen.getByRole("group", { name: /Browser desktop:/ });
    fireEvent.keyDown(surface, { key: "x" }); fireEvent.mouseDown(surface, { button: 0 });
    await advance();
    expect(transport.mock.calls.some(([r]) => r.op === "input")).toBe(false);
    expect(screen.getByRole("button", { name: "Take control" })).toBeDisabled();
  });
  it("sends a key only with the visible display binding", async () => {
    let sequence = 0;
    const transport = vi.fn(async (r: DesktopRequest) => r.op === "frame" ? frame(++sequence)
      : r.op === "input" ? { ok: true, accepted: true } : descriptor());
    render(<CloserDesktopPanel onClose={vi.fn()} transport={transport} />); await advance();
    fireEvent.keyDown(screen.getByRole("group", { name: /Browser desktop:/ }), { key: "x" }); await advance();
    const request = transport.mock.calls.find(([r]) => r.op === "input")![0];
    expect(request).toMatchObject({ op: "input", kind: "key", key: "x", frame_sequence: 1, display_id: "d".repeat(32) });
  });
  it("works under the application's StrictMode effect remount", async () => {
    let sequence = 0;
    const transport = vi.fn(async (r: DesktopRequest) => r.op === "frame" ? frame(++sequence) : descriptor());
    render(<StrictMode><CloserDesktopPanel onClose={vi.fn()} transport={transport} /></StrictMode>);
    await advance();
    expect(screen.getByRole("img", { name: "VPS desktop · frames" })).toBeInTheDocument();
  });
  it("shows missing missions honestly and permits closing only the view", async () => {
    const close = vi.fn(); const transport = vi.fn(async (_r: DesktopRequest) => ({ ok: true, phase: "absent" }));
    render(<CloserDesktopPanel onClose={close} transport={transport} />); await advance();
    expect(screen.getByRole("status")).toHaveTextContent("No active browser mission");
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close view" })); expect(close).toHaveBeenCalledOnce();
    expect(transport.mock.calls.every(([r]) => r.op === "descriptor")).toBe(true);
  });
  it("maps letterboxed coordinates and rejects outside pixels", () => {
    const rect = { left: 10, top: 10, width: 1000, height: 1000 } as DOMRect;
    expect(displayPoint(rect, 1440, 1000, 510, 510)).toEqual({ x: 720, y: 500 });
    expect(displayPoint(rect, 1440, 1000, 510, 20)).toBeNull();
  });
});
