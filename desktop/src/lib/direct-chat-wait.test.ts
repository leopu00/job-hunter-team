import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DirectChatStatus } from "./direct-chat";
import { chatMayStillCome, FIRST_ROUND_POLL_MS, FIRST_ROUND_WAIT_MS, waitForDirectChat } from "./direct-chat-wait";

/** A clock that only moves when the code sleeps. */
function clock() {
  let at = 0;
  return { now: () => at, sleep: vi.fn(async (ms: number) => { at += ms; }) };
}
const answer = (state: DirectChatStatus["state"], code?: string): DirectChatStatus => ({ state, ...(code ? { code } : {}) });

describe("waitForDirectChat — the Assistant's chat comes when its first turn is over", () => {
  it("asks nothing more when the first answer is ready", async () => {
    const retry = vi.fn();
    const onWaiting = vi.fn();
    await expect(waitForDirectChat(answer("ready"), retry, { ...clock(), onWaiting })).resolves.toEqual({ state: "ready" });
    expect(retry).not.toHaveBeenCalled();
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("waits, says so once, asks again every few seconds and returns the chat as soon as it is ready", async () => {
    const time = clock();
    const retry = vi.fn()
      .mockResolvedValueOnce(answer("error", "agent_busy"))
      .mockResolvedValueOnce(answer("connecting"))
      .mockResolvedValueOnce(answer("ready"));
    const onWaiting = vi.fn();
    const chat = await waitForDirectChat(answer("error", "local_team_not_running"), retry, { ...time, onWaiting });
    expect(chat.state).toBe("ready");
    expect(retry).toHaveBeenCalledTimes(3);
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(time.sleep.mock.calls.map(([ms]) => ms)).toEqual([FIRST_ROUND_POLL_MS, FIRST_ROUND_POLL_MS, FIRST_ROUND_POLL_MS]);
  });

  it("gives up after the time it was given and returns the last answer, for the caller to report as before", async () => {
    const time = clock();
    const retry = vi.fn().mockResolvedValue(answer("error", "local_team_not_running"));
    const chat = await waitForDirectChat(answer("error", "local_team_not_running"), retry, { ...time, maxMs: 10_000, pollMs: 3_000 });
    expect(chat).toEqual({ state: "error", code: "local_team_not_running" });
    expect(time.now()).toBeLessThanOrEqual(12_000);
    expect(retry.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(FIRST_ROUND_WAIT_MS).toBeGreaterThanOrEqual(60_000);       // the first turn took 31 s
  });

  it.each(["local_container_not_attested", "host_key_changed", "existing_team_identity_mismatch"])(
    "does not wait for what waiting does not cure (%s)", async (code) => {
      const retry = vi.fn();
      const onWaiting = vi.fn();
      const chat = await waitForDirectChat(answer("error", code), retry, { ...clock(), onWaiting });
      expect(chat.code).toBe(code);
      expect(retry).not.toHaveBeenCalled();
      expect(onWaiting).not.toHaveBeenCalled();
      expect(chatMayStillCome(answer("error", code))).toBe(false);
    });

  it("stops where it stands when the person has left", async () => {
    let current = true;
    const retry = vi.fn(async () => { current = false; return answer("connecting"); });
    const chat = await waitForDirectChat(answer("connecting"), retry, { ...clock(), stillCurrent: () => current });
    expect(chat.state).toBe("connecting");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("passes a failure of the asking itself on to the caller", async () => {
    const retry = vi.fn().mockRejectedValue(new Error("link-lost"));
    await expect(waitForDirectChat(answer("connecting"), retry, clock())).rejects.toThrow("link-lost");
  });
});

describe("the setup waits for the chat where it connects it", () => {
  const source = readFileSync(resolve(__dirname, "../dashboard/DashboardApp.tsx"), "utf8");

  it("the Assistant step and the resume of the team both wait", () => {
    expect(source).toContain('import { waitForDirectChat } from "../lib/direct-chat-wait";');
    expect(source).toMatch(/waitForDirectChat\(await connectDirectChat\(submission\.host\), reconnectDirectChat/);
    expect(source).toMatch(/waitForDirectChat\(await reconnectDirectChat\(\), reconnectDirectChat/);
    expect(source.match(/assistantFirstRound/g)?.length).toBe(2);
  });
});
