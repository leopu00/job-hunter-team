import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProfileProgress } from "./read";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const rows = ["name", "email", "target_role", "location", "experience_years", "seniority_target", "skills", "languages"].map((key) => ({ key, ok: false }));

beforeEach(() => {
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
});

describe("the native read of the profile", () => {
  it("asks the one read-only command and gives the reading", async () => {
    native.invoke.mockResolvedValue({ ok: true, required: 8, done: 0, ready: false, fields: rows });
    const done = await readProfileProgress();
    expect(native.invoke).toHaveBeenCalledWith("profile_progress_read");
    expect(done.ok).toBe(true);
  });

  it("tells the codes the backend gives, and only plain ones", async () => {
    native.invoke.mockResolvedValue({ ok: false, error: "profile_unavailable" });
    expect(await readProfileProgress()).toEqual({ ok: false, code: "profile_unavailable" });
    native.invoke.mockResolvedValue({ ok: false, error: "/Users/someone/.jht: denied" });
    expect(await readProfileProgress()).toEqual({ ok: false, code: "profile_unreadable" });
    native.invoke.mockRejectedValue({ code: "invalid_request" });
    expect(await readProfileProgress()).toEqual({ ok: false, code: "invalid_request" });
    native.invoke.mockRejectedValue(new Error("boom"));
    expect(await readProfileProgress()).toEqual({ ok: false, code: "profile_unreadable" });
    // an answer off the closed shape is not «there is no profile yet» nor «the file does not read»
    native.invoke.mockResolvedValue({ ok: true, required: 8, done: 0, ready: false, fields: [] });
    expect(await readProfileProgress()).toEqual({ ok: false, code: "profile_reply_unexpected" });
    native.invoke.mockResolvedValue("a sentence");
    expect(await readProfileProgress()).toEqual({ ok: false, code: "profile_reply_unexpected" });
    // the chat's «cannot read the messages» is the profile's own «cannot be read»
    native.invoke.mockRejectedValue({ code: "read_failed" });
    expect(await readProfileProgress()).toEqual({ ok: false, code: "profile_unreadable" });
  });

  it("connects the chat again once when it is not connected, then reads again, and does not loop", async () => {
    let connected = false;
    native.invoke.mockImplementation(async () => {
      if (!connected) throw { code: "disconnected" };
      return { ok: true, required: 8, done: 0, ready: false, fields: rows };
    });
    const reconnect = vi.fn(async () => {
      connected = true;
    });
    expect((await readProfileProgress(reconnect)).ok).toBe(true);
    expect(reconnect).toHaveBeenCalledTimes(1);
    // connecting does not help: the reason is told, once
    connected = false;
    native.invoke.mockClear();
    const stuck = vi.fn(async () => {});
    expect(await readProfileProgress(stuck)).toEqual({ ok: false, code: "disconnected" });
    expect([native.invoke.mock.calls.length, stuck.mock.calls.length]).toEqual([2, 1]);
    // any other failure does not connect anything
    native.invoke.mockRejectedValue({ code: "process_timeout" });
    const never = vi.fn(async () => {});
    expect(await readProfileProgress(never)).toEqual({ ok: false, code: "process_timeout" });
    expect(never).not.toHaveBeenCalled();
  });

  it("is not there outside the desktop", async () => {
    native.isTauri.mockReturnValue(false);
    expect(await readProfileProgress()).toEqual({ ok: false, code: "desktop_only" });
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
