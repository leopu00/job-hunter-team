import { describe, expect, it } from "vitest";
import {
  EXIT_CAPTAIN_NOT_TOLD,
  PROFILE_READY_MESSAGE,
  importOutcome,
} from "../../../cli/src/lib/profile-import.js";

// TEST 10 (27/10): `jht profile import --json --replace` with the Capitano at work answered
// {"ok":true,"captain":"failed", ...}: the profile was saved, the Capitano was not told, and the person saw a success.
// The import that could not tell the Capitano is said, with the way to try again, and answers with its own exit code.

const written = { ok: true, profileWritten: true, readyFlag: true, plan: "declared" };
const detail = "jht-tmux-send: CAPITANO has text in its composer that is not provably ours: nothing pasted or pressed (rc=130)";

describe("what the person is told after an import that wrote the profile", () => {
  it("a Capitano that could not be told is a warning with its own exit code, not a quiet success", () => {
    const outcome = importOutcome({ ...written, captain: "failed", detail });
    expect(outcome.exitCode).toBe(EXIT_CAPTAIN_NOT_TOLD);
    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.out[0]).toBe("Profile saved.");
    expect(outcome.out.join("\n")).not.toMatch(/imported and ready|team starts/i);
    const warn = outcome.warn.join("\n");
    expect(warn).toMatch(/the Capitano was NOT told/);
    expect(warn).toContain(detail);
    // the way to try again is the message alone: a second import with --replace would move the profile just written
    // to .prev and drop the one kept before it
    const retry = `jht team send capitano "${PROFILE_READY_MESSAGE}"`;
    expect(warn).toContain(retry);
    expect(warn).toMatch(/profile is saved/);
    expect(warn).not.toMatch(/--replace|import again/);
    expect(outcome.json).toMatchObject({
      ok: true, profileWritten: true, captain: "failed", captainTold: false, retry, detail,
    });
    expect(String(outcome.json.retry)).not.toMatch(/--replace/);
  });

  it("without a detail it still says it", () => {
    const outcome = importOutcome({ ...written, captain: "failed" });
    expect(outcome.warn.join("\n")).toMatch(/NOT told \(delivery failed\)/);
  });

  it("a Capitano that was told is the full success, as before", () => {
    const outcome = importOutcome({ ...written, captain: "sent" });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.out).toEqual(["Profile imported and ready.", "The Capitano has been told: the team starts."]);
    expect(outcome.warn).toEqual([]);
    expect(outcome.json).toMatchObject({ ok: true, captain: "sent", captainTold: true });
  });

  it("a team that is not running is not a failure: the Capitano starts from the profile at its next wake", () => {
    const outcome = importOutcome({ ...written, captain: "team_off" });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.out.join("\n")).toMatch(/team is not running.*jht team start/);
    expect(outcome.json).toMatchObject({ captain: "team_off", captainTold: false });
    expect(outcome.warn).toEqual([]);
  });

  it("the plan and the replaced profile are still said in every case", () => {
    for (const captain of ["sent", "failed", "team_off"]) {
      const outcome = importOutcome({ ...written, captain, plan: "missing", previousKept: "candidate_profile.yml.prev" });
      const said = outcome.out.join("\n");
      expect(said, captain).toContain("kept, private, as candidate_profile.yml.prev");
      expect(said, captain).toMatch(/No subscription plan is declared/);
      expect(said, captain).toContain("jht providers plan");
    }
  });
});
