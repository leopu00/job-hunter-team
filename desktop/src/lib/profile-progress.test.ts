import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

import { invoke, isTauri } from "@tauri-apps/api/core";
import { PROFILE_KEYS, readProfileProgress } from "./profile-progress";

function reply(okFrom: number, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    required: 8,
    done: okFrom,
    ready: okFrom === 8,
    fields: PROFILE_KEYS.map((key, index) => ({
      key,
      ok: index < okFrom,
      ...(["name", "target_role", "location", "seniority_target", "experience_years"].includes(key) && index < okFrom ? { preview: `valore ${key}` } : {}),
      ...(key === "skills" || key === "languages" ? { count: index < okFrom ? 3 : 0 } : {}),
    })),
    ...extra,
  };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReset().mockReturnValue(true);
});

describe("the progress of the candidate profile", () => {
  it("asks the backend with nothing and hands on the eight rows in order", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(reply(5));
    const progress = await readProfileProgress();
    expect(invoke).toHaveBeenCalledWith("profile_progress_read");
    expect(vi.mocked(invoke).mock.calls[0]).toHaveLength(1);
    expect(progress.ok && progress.fields.map((field) => field.key)).toEqual([...PROFILE_KEYS]);
    expect(progress).toMatchObject({ ok: true, required: 8, done: 5, ready: false });
  });

  it("counts done and ready itself from the rows, not from what the reply says", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(reply(3, { done: 8, ready: true }));
    expect(await readProfileProgress()).toMatchObject({ done: 3, ready: false });
    vi.mocked(invoke).mockResolvedValueOnce(reply(8));
    expect(await readProfileProgress()).toMatchObject({ done: 8, ready: true });
  });

  it("keeps a preview only where it may be and a count only for skills and languages", async () => {
    const answer = reply(8);
    (answer.fields[1] as Record<string, unknown>).preview = "persona@example.invalid";
    (answer.fields[0] as Record<string, unknown>).count = 9;
    vi.mocked(invoke).mockResolvedValueOnce(answer);
    const progress = await readProfileProgress();
    if (!progress.ok) throw new Error("expected a profile");
    expect(progress.fields[1]).toEqual({ key: "email", ok: true });
    expect(progress.fields[0]).toEqual({ key: "name", ok: true, preview: "valore name" });
    expect(progress.fields[6]).toEqual({ key: "skills", ok: true, count: 3 });
    expect(JSON.stringify(progress)).not.toContain("example.invalid");
  });

  it("passes the two closed failures and turns anything else into unavailable", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: false, error: "profile_unreadable" });
    expect(await readProfileProgress()).toEqual({ ok: false, error: "profile_unreadable" });
    vi.mocked(invoke).mockResolvedValueOnce({ ok: false, error: "profile_unavailable" });
    expect(await readProfileProgress()).toEqual({ ok: false, error: "profile_unavailable" });
    vi.mocked(invoke).mockResolvedValueOnce({ ok: false, error: "a sentence" });
    expect(await readProfileProgress()).toEqual({ ok: false, error: "profile_unavailable" });
  });

  it("refuses a reply that is not the eight rows in order, and the backend's own rejection passes through", async () => {
    const swapped = reply(8);
    [swapped.fields[0], swapped.fields[1]] = [swapped.fields[1]!, swapped.fields[0]!];
    const short = reply(8);
    short.fields.pop();
    const noCount = reply(8);
    delete (noCount.fields[6] as Record<string, unknown>).count;
    for (const bad of [undefined, null, "x", {}, { ok: true }, swapped, short, noCount, { ...reply(8), fields: "x" }]) {
      vi.mocked(invoke).mockResolvedValueOnce(bad);
      await expect(readProfileProgress(), JSON.stringify(bad)?.slice(0, 40)).rejects.toEqual({ code: "profile_progress_invalid" });
    }
    vi.mocked(invoke).mockRejectedValueOnce({ code: "invalid_request" });
    await expect(readProfileProgress()).rejects.toEqual({ code: "invalid_request" });
  });

  it("is desktop only", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(readProfileProgress()).rejects.toEqual({ code: "desktop_only" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
