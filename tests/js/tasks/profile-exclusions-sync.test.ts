import { beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — plain ESM module of the CLI
import { resetProfileExclusionsSync, syncProfileExclusions } from "../../../cli/src/lib/profile-exclusions-sync.js";

const ok = (stdout = '{"ok": true, "unusable": []}') => ({ code: 0, stdout, stderr: "" });

describe("syncProfileExclusions (JHT-T24): the user's decisions go to the team, as codes and states only", () => {
  beforeEach(() => resetProfileExclusionsSync());

  it("hands the script the decisions, sorted, with nothing but the code and the state", async () => {
    const run = vi.fn(() => ok());
    const reader = {
      readProfileExclusions: async () => [
        { reason: "wrong_stack", status: "dismissed", decided_at: "2026-10-20T10:00:00Z", user_id: "u", note: "words" },
        { reason: "company", status: "accepted", decided_at: "2026-10-21T10:00:00Z" },
      ],
    };
    const done = await syncProfileExclusions({ reader, fetchRemote: async () => [], run });
    expect(done).toEqual({ ok: true, unusable: [] });
    expect(run).toHaveBeenCalledTimes(1);
    const [skill, args, options] = run.mock.calls[0] as unknown as [string, string[], { input: string }];
    expect([skill, args]).toEqual(["profile_exclusions.py", ["reconcile"]]);
    expect(JSON.parse(options.input)).toEqual([
      { reason: "company", status: "accepted" },
      { reason: "wrong_stack", status: "dismissed" },
    ]);
    expect(options.input).not.toContain("words");
  });

  it("drops what is not a decision: a code that is not one, a state that is not one, a row that is not a row", async () => {
    const run = vi.fn(() => ok());
    const rows = [
      { reason: "Company; rm -rf", status: "accepted" },
      { reason: "company", status: "maybe" },
      null,
      "company",
      { reason: "salary_low", status: "accepted" },
    ];
    await syncProfileExclusions({ reader: null, fetchRemote: async () => rows, run });
    expect(JSON.parse((run.mock.calls[0] as unknown as [string, string[], { input: string }])[2].input)).toEqual([
      { reason: "salary_low", status: "accepted" },
    ]);
  });

  it("asks nothing of the team when nothing was decided, and again only when something changed", async () => {
    const run = vi.fn(() => ok());
    const rows = [{ reason: "company", status: "accepted" }];
    expect(await syncProfileExclusions({ reader: null, fetchRemote: async () => [], run })).toEqual({ ok: true, skipped: "nothing_decided" });
    expect(run).not.toHaveBeenCalled();
    await syncProfileExclusions({ reader: null, fetchRemote: async () => rows, run });
    expect(await syncProfileExclusions({ reader: null, fetchRemote: async () => rows, run })).toEqual({ ok: true, skipped: "unchanged" });
    expect(run).toHaveBeenCalledTimes(1);
    await syncProfileExclusions({ reader: null, fetchRemote: async () => [{ reason: "company", status: "dismissed" }], run });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("falls back to the site's route without a direct reader, and a failure is said and tried again", async () => {
    const log = vi.fn();
    const rows = [{ reason: "company", status: "accepted" }];
    const failing = vi.fn(() => ({ code: 1, stdout: "", stderr: "x" }));
    expect(await syncProfileExclusions({ reader: {}, fetchRemote: async () => rows, run: failing, log })).toEqual({ ok: false, skipped: "script_failed" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("did not take the decisions"));
    const run = vi.fn(() => ok());
    expect((await syncProfileExclusions({ reader: {}, fetchRemote: async () => rows, run, log })).ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a read that fails is a warning, never a throw", async () => {
    const log = vi.fn();
    const run = vi.fn();
    const reader = { readProfileExclusions: async () => { throw new Error("offline"); } };
    expect(await syncProfileExclusions({ reader, fetchRemote: async () => [], run, log })).toEqual({ ok: false, skipped: "read_failed" });
    expect(run).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });

  it("says which codes the team could not turn into a rule", async () => {
    const log = vi.fn();
    const run = vi.fn(() => ok('{"ok": true, "unusable": ["wrong_location"]}'));
    const done = await syncProfileExclusions({ reader: null, fetchRemote: async () => [{ reason: "wrong_location", status: "accepted" }], run, log });
    expect(done).toEqual({ ok: true, unusable: ["wrong_location"] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("wrong_location"));
  });
});
