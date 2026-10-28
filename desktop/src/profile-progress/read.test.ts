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
    native.invoke.mockResolvedValue({ ok: true, required: 8, done: 0, ready: false, fields: [] });
    expect(await readProfileProgress()).toEqual({ ok: false, code: "profile_unreadable" });
  });

  it("is not there outside the desktop", async () => {
    native.isTauri.mockReturnValue(false);
    expect(await readProfileProgress()).toEqual({ ok: false, code: "desktop_only" });
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
