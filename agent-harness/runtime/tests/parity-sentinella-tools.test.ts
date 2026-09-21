/**
 * T37: `bridge_mailbox` and `burn_intent status` against the Python they replace.
 *
 * Both are pure reads of files under the team's home, which is why they port
 * as they are — and why the comparison has to be byte for byte: the
 * SENTINELLA drains the mailbox at the start of every turn and reads the
 * derogation before every daily brake, so a line that differs is a decision
 * that differs.
 *
 * The cursor is the part worth watching: `drain` advances it and `peek` does
 * not, a file shorter than the cursor restarts from zero, and a line that is
 * not JSON is skipped by the reader but still counted by `status`. Each of
 * those is a case below, run against both sides on the same directory.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bridgeMailbox, burnIntent, burnIntentStatus } from "../src/parity/skills/sentinel.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "jht-sentinel-"));
  mkdirSync(join(home, "logs"), { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const mailboxFile = () => join(home, "logs", "bridge-mailbox.jsonl");
const cursorFile = () => join(home, "logs", "bridge-mailbox.cursor");

const verdict = (ts: string, kind: string, msg: string, delivered = false) =>
  `${JSON.stringify({ ts, kind, msg, delivered_via_tmux: delivered })}\n`;

/**
 * The same SEQUENCE of calls on both sides, each side starting from the same
 * folder: the cursor is state, so a single call proves less than a drain
 * followed by another drain.
 */
function compare(sequence: string[][], seed: () => void): void {
  // Both sides start from an empty folder, not from what the other left in it:
  // the cursor a run writes is exactly the state that would fake an agreement.
  const fresh = () => {
    rmSync(mailboxFile(), { force: true });
    rmSync(cursorFile(), { force: true });
    seed();
  };
  fresh();
  const ours = sequence.map((args) => {
    const r = bridgeMailbox(args, { jhtHome: home });
    return [r.stdout, r.stderr ?? "", r.exitCode, safeRead(cursorFile())];
  });
  fresh();
  const theirs = sequence.map((args) => {
    const r = runPython(skills!, ["bridge_mailbox.py", ...args], { JHT_HOME: home });
    return [r.stdout, r.stderr, r.status, safeRead(cursorFile())];
  });
  expect(ours).toEqual(theirs);
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

describe.skipIf(skills === null)("bridge_mailbox against bridge_mailbox.py", () => {
  it("an empty mailbox, for every subcommand and for the default", () => {
    compare([[], ["drain"], ["peek"], ["status"], ["reset"]], () => {});
  });

  it("drain prints the verdicts and moves the cursor; a second drain finds nothing", () => {
    const seed = () => {
      writeFileSync(mailboxFile(), verdict("2026-09-21T06:00:00Z", "pacing", "[BRIDGE PACING] 06:00 UTC VERDETTO: SFORO") + verdict("2026-09-21T06:15:00Z", "tick", "[BRIDGE TICK] usage=41%", true));
      rmSync(cursorFile(), { force: true });
    };
    // Drain, then drain again with the cursor where the first one left it.
    compare([["drain"], ["drain"], ["status"]], seed);
  });

  it("peek shows the same verdicts without consuming them, aligned as the script aligns them", () => {
    const seed = () => {
      writeFileSync(mailboxFile(), verdict("2026-09-21T06:00:00Z", "pacing", "verdict one") + verdict("2026-09-21T06:15:00Z", "vitals", "verdict two", true));
      rmSync(cursorFile(), { force: true });
    };
    compare([["peek"], ["peek"], ["drain"], ["peek"]], seed);
  });

  it("a cursor past the end of the file rereads from zero, and a broken one is a zero", () => {
    const seed = (cursor: string) => () => {
      writeFileSync(mailboxFile(), verdict("2026-09-21T07:00:00Z", "pacing", "after a truncate"));
      writeFileSync(cursorFile(), cursor);
    };
    compare([["drain"]], seed("999999"));
    compare([["peek"]], seed("not a number"));
    compare([["status"]], seed("  12  "));
    compare([["drain"]], seed(""));
  });

  it("a line that is not JSON is skipped by the reader and still counted by status", () => {
    const seed = () => {
      writeFileSync(mailboxFile(), `${verdict("2026-09-21T08:00:00Z", "pacing", "good")}not json at all\n\n${verdict("2026-09-21T08:15:00Z", "pacing", "also good")}`);
      rmSync(cursorFile(), { force: true });
    };
    compare([["status"], ["peek"], ["drain"], ["status"]], seed);
  });

  it("an entry without ts, kind or msg prints the script's own placeholders", () => {
    const seed = () => {
      writeFileSync(mailboxFile(), `${JSON.stringify({ msg: "only a message" })}\n${JSON.stringify({ ts: 42, kind: "x", delivered_via_tmux: true })}\n`);
      rmSync(cursorFile(), { force: true });
    };
    compare([["peek"], ["drain"]], seed);
  });

  it("reset sends the next drain back to the beginning", () => {
    const seed = () => {
      writeFileSync(mailboxFile(), verdict("2026-09-21T09:00:00Z", "pacing", "read me twice"));
      writeFileSync(cursorFile(), "80");
    };
    compare([["reset"], ["drain"]], seed);
  });

  it("an unknown subcommand is the usage line and exit 2", () => {
    compare([["nonsense"], ["drain", "extra"]], () => {});
  });
});

const flag = (payload: Record<string, unknown>) => writeFileSync(join(home, ".burn-intent.flag"), JSON.stringify(payload));
/** What `jht burn on` actually writes: `--hours` is an argparse `type=float`, so the token has a dot. */
const grantedFlag = (fields: string) => writeFileSync(join(home, ".burn-intent.flag"), `{${fields}, "hours": 5.0}`);

function compareBurn(args: string[], now: Date): void {
  const ours = burnIntent(args, { jhtHome: home, now: () => now });
  const py = runPython(skills!, ["burn_intent.py", ...args], { JHT_HOME: home, JHT_FAKE_NOW: now.toISOString() });
  expect([ours.stdout, ours.stderr ?? "", ours.exitCode]).toEqual([py.stdout, py.stderr, py.status]);
}

describe.skipIf(skills === null)("burn_intent status against burn_intent.py", () => {
  // The script has no clock seam, so the cases that compare against it are the
  // ones whose answer does not depend on the minute: no flag, and a flag that
  // is refused before the clock is ever consulted.
  it("no flag at all: off, in both shapes", () => {
    compareBurn(["status"], new Date("2026-09-21T10:00:00Z"));
    compareBurn(["status", "--json"], new Date("2026-09-21T10:00:00Z"));
  });

  it("a flag with no expiry is not a derogation, and neither is a broken one", () => {
    flag({ granted_at: "2026-09-21T09:00:00+00:00", reason: "push", hours: 5.0 });
    compareBurn(["status", "--json"], new Date("2026-09-21T10:00:00Z"));
    writeFileSync(join(home, ".burn-intent.flag"), "{ not json");
    compareBurn(["status", "--json"], new Date("2026-09-21T10:00:00Z"));
    writeFileSync(join(home, ".burn-intent.flag"), JSON.stringify(["a list, not an object"]));
    compareBurn(["status", "--json"], new Date("2026-09-21T10:00:00Z"));
    flag({ expires_at: "yesterday evening" });
    compareBurn(["status", "--json"], new Date("2026-09-21T10:00:00Z"));
  });

  it("an expired flag is off in both, whatever the clock says after it", () => {
    flag({ expires_at: "2020-01-01T00:00:00+00:00", reason: "old", hours: 5.0, granted_by: "user" });
    compareBurn(["status"], new Date("2026-09-21T10:00:00Z"));
    compareBurn(["status", "--json"], new Date("2026-09-21T10:00:00Z"));
  });
});

/** The live derogation: its answer moves with the clock, so it is held here against the contract. */
describe("burn_intent status, on the clock the caller gives it", () => {
  it("counts the minutes left and names the safeguards that do not yield", () => {
    grantedFlag('"granted_at": "2026-09-21T09:00:00+00:00", "expires_at": "2026-09-21T14:00:00+00:00", "reason": "the user asked for a push", "granted_by": "user"');
    const now = () => new Date("2026-09-21T10:26:00Z");
    expect(burnIntentStatus({ jhtHome: home, now })).toEqual({
      active: true,
      state: "active",
      expires_at: "2026-09-21T14:00:00+00:00",
      remaining_min: 214,
      reason: "the user asked for a push",
      granted_at: "2026-09-21T09:00:00+00:00",
      granted_by: "user",
      hours: 5.0,
    });
    const json = burnIntent(["status", "--json"], { jhtHome: home, now });
    expect(json.stdout).toBe(
      '{"active": true, "state": "active", "expires_at": "2026-09-21T14:00:00+00:00", "remaining_min": 214, ' +
        '"reason": "the user asked for a push", "granted_at": "2026-09-21T09:00:00+00:00", "granted_by": "user", "hours": 5.0}\n',
    );
    // The flag's own token decides: a hand-written `"hours": 5` prints 5, as
    // `json.load` + `json.dumps` do, and the two sides stay byte for byte.
    flag({ granted_at: "2026-09-21T09:00:00+00:00", expires_at: "2026-09-21T14:00:00+00:00", hours: 5, reason: "the user asked for a push", granted_by: "user" });
    expect(burnIntent(["status", "--json"], { jhtHome: home, now }).stdout).toContain('"hours": 5}');
    grantedFlag('"granted_at": "2026-09-21T09:00:00+00:00", "expires_at": "2026-09-21T14:00:00+00:00", "reason": "the user asked for a push", "granted_by": "user"');
    const banner = burnIntent(["status"], { jhtHome: home, now });
    expect(banner.stdout).toBe(
      "BURN-INTENT ATTIVO — user override for spending automation, expires in 214 min (2026-09-21T14:00:00+00:00); " +
        "reason: the user asked for a push. Safeguards still active: weekly-halt, host_agent_cap, SC-09, freeze_team.\n",
    );
  });

  it("the second it expires it is off, and the flag on disk is left alone", () => {
    flag({ expires_at: "2026-09-21T14:00:00+00:00", hours: 5.0, reason: "r" });
    const after = burnIntentStatus({ jhtHome: home, now: () => new Date("2026-09-21T14:00:00Z") });
    expect(after).toMatchObject({ active: false, state: "expired", remaining_min: 0 });
    expect(safeRead(join(home, ".burn-intent.flag"))).not.toBeNull();
  });

  it("a reason in the person's own alphabet is not escaped, as the script does not escape it", () => {
    flag({ expires_at: "2026-09-21T14:00:00+00:00", hours: 5.0, reason: "spingi: è la sera del lancio" });
    const json = burnIntent(["status", "--json"], { jhtHome: home, now: () => new Date("2026-09-21T13:00:00Z") });
    expect(json.stdout).toContain('"reason": "spingi: è la sera del lancio"');
  });
});

describe("what the SENTINELLA may not do with the derogation", () => {
  it("refuses to grant, revoke or sweep it, and says whose it is", () => {
    for (const command of ["grant", "revoke", "sweep"]) {
      const r = burnIntent([command], { jhtHome: home });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain("jht burn on|off");
      expect(r.stderr).toContain("Nothing was changed");
      expect(safeRead(join(home, ".burn-intent.flag"))).toBeNull();
    }
  });

  it("names `status` when asked for something else entirely", () => {
    const r = burnIntent(["explode"], { jhtHome: home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("burn_intent status");
    expect(burnIntent(["status", "--force"], { jhtHome: home }).exitCode).toBe(2);
  });
});
