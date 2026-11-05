import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_WINDOWS, pickActivity, readPanelActivity, type ActivityWindow } from "./agent-control";

// What the native side shapes for the activity read (JHT-T171), checked once more by the client. Synthetic data only.
const SHAPE: Record<ActivityWindow, [number, number]> = { "5m": [300, 15], "15m": [900, 60], "1h": [3600, 120], "5h": [18000, 600], "24h": [86400, 1800], "7d": [604800, 10800] };
// a multiple of 10800 s, the biggest bucket: every window's edge is aligned to its own bucket
const END = Math.floor(1_800_000_000 / 10_800) * 10_800;

function reply(window: ActivityWindow, agents: unknown[] = [agent(window)], more: Record<string, unknown> = {}) {
  const [span, bucket] = SHAPE[window];
  return { window, now: END - 5, since: END - span, end: END, bucketS: bucket, buckets: span / bucket, agents, unattributedKt: 1.5, states: true, ...more };
}
function agent(window: ActivityWindow, more: Record<string, unknown> = {}) {
  const count = SHAPE[window][0] / SHAPE[window][1];
  const kt = Array(count).fill(0);
  const work = Array(count).fill(0);
  kt[2] = 1.25;
  work[2] = 1;
  work[count - 1] = 1;
  return { name: "SCOUT-1", state: "lavora", kt, work, totalKt: 1.25, avgKtH: 0.5, workedBuckets: 2, ...more };
}

describe("pickActivity", () => {
  it.each([...ACTIVITY_WINDOWS])("%s: takes the answer of that window as it is", (window) => {
    const picked = pickActivity(reply(window), window)!;
    expect(picked.window).toBe(window);
    expect(picked.buckets).toBe(SHAPE[window][0] / SHAPE[window][1]);
    expect(picked.agents).toHaveLength(1);
    expect(picked.agents[0]).toMatchObject({ name: "SCOUT-1", state: "lavora", totalKt: 1.25, workedBuckets: 2 });
    expect(picked.unattributedKt).toBe(1.5);
  });

  it("is not used when it is another window than the one asked, or its buckets are not that window's", () => {
    expect(pickActivity(reply("1h"), "24h")).toBeNull();
    expect(pickActivity(reply("1h", [], { bucketS: 60 }), "1h")).toBeNull();
    expect(pickActivity(reply("1h", [], { buckets: 29 }), "1h")).toBeNull();
    expect(pickActivity(reply("1h", [], { end: END + 7 }), "1h")).toBeNull();
    expect(pickActivity(reply("1h", [], { since: END - 7200 }), "1h")).toBeNull();
    expect(pickActivity({ ...reply("1h"), agents: "x" }, "1h")).toBeNull();
  });

  it("leaves out an agent that is not whole, instead of repairing it", () => {
    const good = agent("1h");
    const picked = pickActivity(
      reply("1h", [
        good,
        { ...good }, // twice
        agent("1h", { name: "SCOUT-2", kt: [1, 2] }),
        agent("1h", { name: "SCOUT-3", work: [...good.work.slice(1), 2] }),
        agent("1h", { name: "SCOUT-4", kt: [...good.kt.slice(1), -1] }),
        agent("1h", { name: "SCOUT-5", kt: [...good.kt.slice(1), "x"] }),
        agent("1h", { name: "SCOUT-6", totalKt: Number.NaN }),
        agent("1h", { name: "SCOUT-7", state: "x".repeat(41) }),
        { name: 7 },
        "nope",
      ]),
      "1h",
    )!;
    expect(picked.agents.map((a) => a.name)).toEqual(["SCOUT-1", "SCOUT-7"]);
    expect(picked.agents[1].state).toBeNull();
  });

  it("counts the worked buckets from the marks it takes, not from the number the container wrote", () => {
    const picked = pickActivity(reply("1h", [agent("1h", { workedBuckets: 99 })]), "1h")!;
    expect(picked.agents[0].workedBuckets).toBe(2);
  });
});

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
afterEach(() => native.invoke.mockReset());

describe("readPanelActivity", () => {
  it("asks the op with the window and gives the picked answer", async () => {
    native.invoke.mockResolvedValue({ ok: true, data: reply("5h") });
    const read = await readPanelActivity("5h");
    expect(native.invoke).toHaveBeenCalledWith("agent_control", { request: { op: "activity", window: "5h" } });
    expect(read.ok && read.value.agents[0].name).toBe("SCOUT-1");
  });

  it("says «bad reply» for an answer of another window, and the team's own code when it refuses", async () => {
    native.invoke.mockResolvedValue({ ok: true, data: reply("1h") });
    expect(await readPanelActivity("24h")).toMatchObject({ ok: false, code: "desktop_bad_reply" });
    native.invoke.mockResolvedValue({ ok: false, error: "agents_unavailable" });
    expect(await readPanelActivity("1h")).toMatchObject({ ok: false, code: "agents_unavailable" });
  });
});
