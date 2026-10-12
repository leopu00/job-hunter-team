import { describe, expect, it, vi } from "vitest";
import { DesktopSession } from "./session";
import { binding, deferred, descriptor, frame, rig } from "./fixtures.test-support";
import type { DesktopReply, DesktopRequest } from "../lib/closer-desktop";

const key = { kind: "key" as const, key: "x", pressed: true };
async function ready() {
  const fixture = rig();
  const session = new DesktopSession(vi.fn(), fixture.transport, fixture.clock);
  await session.poll(); await session.poll();
  return { session, ...fixture };
}

describe("assisted desktop request lane", () => {
  it("uses only the fixed descriptor, then the bound display", async () => {
    const { session, requests } = await ready();
    expect(requests[0]).toEqual({ op: "descriptor" });
    expect(requests[1]).toEqual({ op: "frame", ...binding, display_id: "d".repeat(32), frame_sequence: 0 });
    expect(session.canInput()).toBe(true);
  });
  it("never treats a display as input permission", async () => {
    const { session, setState } = await ready();
    setState(descriptor({ phase: "running", input_ready: false, allowed_actions: ["frame"] }));
    session.refresh(); await session.poll();
    expect(session.view.frame).not.toBeNull();
    expect(session.enqueue(key)).toBe(false);
    expect(session.canControl("handoff")).toBe(false);
  });
  it.each([undefined, null, "input"])("fails closed without an action list (%s)", async (allowed_actions) => {
    const { session, setState } = await ready();
    setState(descriptor({ allowed_actions })); session.refresh(); await session.poll();
    expect(session.canInput()).toBe(false);
    expect(session.view.frame).toBeNull();
  });
  it("discards event N queued while frame N+1 is pending, with no replay", async () => {
    const fixture = rig(); const pending = deferred<DesktopReply>();
    let captures = 0;
    const transport = vi.fn((request: DesktopRequest) => {
      if (request.op === "frame" && ++captures === 2) return pending.promise;
      return fixture.transport(request);
    });
    const session = new DesktopSession(vi.fn(), transport, fixture.clock);
    await session.poll(); await session.poll();
    fixture.advance(750);
    const poll = session.poll();
    expect(session.enqueue(key)).toBe(true);
    pending.resolve(frame(2)); await poll;
    expect(session.view.notice).toBe("discarded");
    await session.poll(); await session.poll();
    expect(transport.mock.calls.some(([r]) => r.op === "input")).toBe(false);
  });
  it("preserves the event's original mission and frame, excluding local metadata", async () => {
    const { session, requests } = await ready();
    session.enqueue(key); await session.poll();
    expect(requests.at(-1)).toEqual({ ...binding, op: "input", display_id: "d".repeat(32), frame_sequence: 1, ...key });
  });
  it.each(["owner_id", "mission_id", "display_id"])("drops queued input on changed %s", async (field) => {
    const { session, requests, setState } = await ready();
    session.enqueue(key);
    setState(descriptor({ [field]: "e".repeat(32) })); session.refresh(); await session.poll(); await session.poll();
    expect(requests.some((r) => r.op === "input")).toBe(false);
  });
  it("disables stale pixels and descriptors while an unrelated request is pending", async () => {
    const { session, advance } = await ready();
    advance(1801); expect(session.canInput()).toBe(false);
    advance(200); expect(session.canControl("finish")).toBe(false);
    expect(session.enqueue(key)).toBe(false);
  });
  it("does not synthesize confirm for non-review blockers", async () => {
    const { session, requests, setState } = await ready();
    setState(descriptor({ phase: "blocked", allowed_actions: ["confirm", "handoff", "finish"] }));
    session.refresh(); await session.poll(); await session.control("confirm");
    expect(requests.some((r) => r.op === "confirm")).toBe(false);
    expect(session.canControl("handoff")).toBe(true);
  });
  it("sends a bound official review confirmation once, with queued distinct from outcome", async () => {
    const fixture = rig(); const pending = deferred<DesktopReply>();
    fixture.setState(descriptor({ phase: "review_wait", input_ready: false, allowed_actions: ["confirm", "frame"] }));
    const transport = vi.fn((r: DesktopRequest) => r.op === "confirm" ? pending.promise : fixture.transport(r));
    const session = new DesktopSession(vi.fn(), transport, fixture.clock);
    await session.poll();
    const first = session.control("confirm"); await session.control("confirm");
    expect(transport.mock.calls.filter(([r]) => r.op === "confirm")).toHaveLength(1);
    expect(transport.mock.calls.at(-1)![0]).toEqual({ ...binding, op: "confirm", review_id: "c".repeat(32) });
    pending.resolve(descriptor({ phase: "review_wait", allowed_actions: [], queued: true })); await first;
    expect(session.view.notice).toBe("queued");
    expect(session.canControl("confirm")).toBe(false);
  });
  it("keeps observe for the existing last-cap reservation when the server allows it", async () => {
    const { session, requests, setState } = await ready();
    setState(descriptor({ phase: "handoff", allowed_actions: ["observe", "finish"], gate_reason: "reserved_cap_recovery" }));
    session.refresh(); await session.poll(); await session.control("observe");
    expect(requests.at(-1)).toEqual({ ...binding, op: "observe" });
    expect(requests.some((r) => r.op === "confirm")).toBe(false);
  });
  it("does not queue the same confirmation again after an ack that still shows review_wait", async () => {
    const { session, setState, requests } = await ready();
    setState(descriptor({ phase: "review_wait", allowed_actions: ["confirm"] }));
    session.refresh(); await session.poll();
    await session.control("confirm"); await session.control("confirm");
    expect(requests.filter((r) => r.op === "confirm")).toHaveLength(1);
    session.refresh(); await session.poll();
    expect(session.canControl("confirm")).toBe(false);
  });
  it.each([false, undefined])("clears a revoked same-event screenshot independently of display (%s)", async (available) => {
    const { session, setState } = await ready();
    const block = { event_id: "f".repeat(32), screenshot_available: true, reason: "synthetic", action: "review" };
    setState(descriptor({ block, allowed_actions: ["frame", "snapshot", "delete_snapshot"] }));
    session.refresh(); await session.poll(); await session.poll();
    expect(session.view.screenshot).not.toBeNull();
    setState(descriptor({ block: { ...block, screenshot_available: available }, allowed_actions: ["frame"] }));
    session.refresh(); await session.poll();
    expect(session.view.screenshot).toBeNull(); expect(session.view.frame).not.toBeNull();
  });
  it("deletes only the bound event and clears pixels immediately on success", async () => {
    const { session, setState, requests } = await ready();
    setState(descriptor({ block: { event_id: "f".repeat(32), screenshot_available: true },
      allowed_actions: ["snapshot", "delete_snapshot", "frame"] }));
    session.refresh(); await session.poll(); await session.poll(); await session.deleteScreenshot();
    expect(requests.at(-1)).toEqual({ ...binding, op: "delete_snapshot", event_id: "f".repeat(32) });
    expect(session.view.screenshot).toBeNull();
  });
  it("clears identity/pixels on deny without exposing a raw error", async () => {
    const session = new DesktopSession(vi.fn(), async () => ({ ok: false, error: "SECRET payload\n" }));
    await session.poll();
    expect(session.view.error).toBe("desktop_request_denied");
    expect(session.view.descriptor).toBeNull();
  });
  it("ignores late replies after close and does not send a terminal action implicitly", async () => {
    const pending = deferred<DesktopReply>(); const transport = vi.fn(() => pending.promise);
    const session = new DesktopSession(vi.fn(), transport);
    const poll = session.poll(); session.dispose(); pending.resolve(descriptor()); await poll;
    await session.poll();
    expect(session.view.descriptor).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects a frame from a different display", async () => {
    const fixture = rig();
    const session = new DesktopSession(vi.fn(), async (r) => r.op === "frame"
      ? { ...frame(1), display_id: "e".repeat(32) } : fixture.transport(r), fixture.clock);
    await session.poll(); await session.poll();
    expect(session.view.frame).toBeNull(); expect(session.view.error).toBe("desktop_frame_invalid");
  });
  it("disables every action for an unknown descriptor phase", async () => {
    const { session, setState } = await ready();
    setState(descriptor({ phase: "future_phase" })); session.refresh(); await session.poll();
    expect(session.view.descriptor).toBeNull(); expect(session.canControl("finish")).toBe(false);
  });
  it("does not hammer SSH when the mission or binding is unavailable", async () => {
    const transport = vi.fn(async () => ({ ok: false, error: "binding_missing" }));
    let now = 0;
    const session = new DesktopSession(vi.fn(), transport, () => now);
    await session.poll();
    for (let i = 0; i < 6; i++) { now += 200; await session.poll(); }
    expect(transport).toHaveBeenCalledTimes(1);
    now += 400; await session.poll(); expect(transport).toHaveBeenCalledTimes(2);
  });
});
