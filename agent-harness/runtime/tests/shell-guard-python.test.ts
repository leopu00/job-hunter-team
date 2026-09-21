/**
 * Every `python3` a role types is answered, not left to die (21/09).
 *
 * The image carries no interpreter, so any of these calls would have come
 * back as `command not found`, exit 127. Until now only the scripts WITH a
 * native tool were refused by name; everything else — `freeze_team.py`,
 * `check_usage.py`, a bare `python3 -c` — reached the shell and got that 127.
 * A live mock run on the VPS died exactly there, and the role learned nothing
 * from it: "command not found" is not a boundary, it is a silence with an
 * exit code. The MASTER put it best — a model that reads `use db_query` stops
 * trying, one that reads `command not found` tries the next path.
 *
 * So the assertions below are on the WORDS of the refusal, never on the name
 * of the script: the name appears in the shell's own error too, which is how
 * the defect passed under a test of mine that asserted just that.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { guardShellTool, pythonRefusal } from "../src/parity/jht-tools.ts";
import type { ToolContext, ToolHandler } from "../src/tools/registry.ts";

const context = {} as ToolContext;

/** A shell that reports being run: what must NOT happen for a refused line. */
function shell(): { tool: ToolHandler; ran: string[] } {
  const ran: string[] = [];
  const tool: ToolHandler = {
    spec: { name: "bash", description: "run", schema: { parse: (x: unknown) => x } as never },
    classify: () => ({ risk: "execute", paths: [], summary: "" }),
    async execute(args) {
      ran.push((args as { command: string }).command);
      return { ok: true, content: "ran" };
    },
  };
  return { tool, ran };
}

/**
 * A PATH with no interpreter on it, and one with an interpreter on it. The
 * refusal is the same on both; only its REASON may differ, and these two make
 * the difference visible instead of leaving it to whatever box runs the suite
 * — this Mac has a `python3`, the image does not.
 */
const noPython = { PATH: mkdtempSync(join(tmpdir(), "no-python-")) };
const withPython = (() => {
  const dir = mkdtempSync(join(tmpdir(), "with-python-"));
  writeFileSync(join(dir, "python3"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { PATH: dir };
})();

const guarded = (overrides: Record<string, string> = {}, env: NodeJS.ProcessEnv = noPython) => {
  const { tool, ran } = shell();
  return { guard: guardShellTool(tool, (a) => (a as { command: string }).command, overrides, env), ran };
};

const run = (command: string, overrides: Record<string, string> = {}, env: NodeJS.ProcessEnv = noPython) => {
  const { guard, ran } = guarded(overrides, env);
  return guard.execute({ command }, context).then((r) => ({ ...r, ran }));
};

describe("a python call with a native tool", () => {
  it("is answered with the tool's name, and the shell never sees it", async () => {
    const r = await run("python3 /app/shared/skills/db_query.py position 1");
    expect(r.ok).toBe(false);
    expect(r.content).toContain("Use the `db_query` tool instead");
    expect(r.content).toContain("Nothing was run");
    expect(r.ran).toEqual([]);
  });

  it("names the role's own tool where the role has one (office-geocoding)", async () => {
    const r = await run("python3 /app/shared/skills/safe_fetch.py https://x.example --status", { "safe_fetch.py": "safe_fetch" });
    expect(r.content).toContain("Use the `safe_fetch` tool instead");
  });
});

describe("a shared skill with no tool of its own", () => {
  it("says what the harness has in its place, not that the command is missing", async () => {
    const r = await run("python3 /app/shared/skills/freeze_team.py");
    expect(r.ok).toBe(false);
    // The words are the boundary: what it does, why it cannot, and who does it here.
    expect(r.content).toContain("tmux panes");
    expect(r.content).toContain("stopping the team is the hub's");
    expect(r.content).toContain("CAPITANO");
    // And it must NOT read like a shell failure — that is the difference the
    // old test could not see, because the script's name is in both.
    expect(r.content).not.toMatch(/command not found/);
    expect(r.content).not.toMatch(/127/);
    expect(r.ran).toEqual([]);
  });

  it("covers the rest of the SENTINELLA's host-side scripts too", async () => {
    expect((await run("python3 /app/shared/skills/soft_pause_team.py --reason x")).content).toContain("ask the CAPITANO");
    expect((await run("python3 /app/shared/skills/check_usage.py")).content).toContain("with the tick that woke you");
    expect((await run("python3 /app/shared/skills/weekly_pace.py")).content).toContain("inside the tick");
    expect((await run("python3 /app/shared/skills/throttle.py 600 --agent scout-1")).content).toContain("`throttle` tool");
  });
});

describe("any other Python at all", () => {
  it("a script nobody ported still gets a reason, not a 127", async () => {
    const r = await run("cd /app && python shared/skills/mystery.py --x");
    expect(r.content).toContain("the image carries no Python");
    expect(r.content).toContain("say in your report which one you needed");
    expect(r.ran).toEqual([]);
  });

  it("an interpreter without a script — `-c`, a REPL — is refused as plainly", async () => {
    for (const command of ["python3 -c \"import os; print(os.listdir('/'))\"", "python3", "/usr/bin/python3.11 -q"]) {
      const r = await run(command);
      expect(r.ok).toBe(false);
      expect(r.content).toContain("no Python in this image");
      expect(r.ran).toEqual([]);
    }
  });

  it("leaves alone a line that only mentions the word", async () => {
    const r = await run("grep -rn python3 README.md");
    expect(r.ok).toBe(true);
    expect(r.ran).toEqual(["grep -rn python3 README.md"]);
    expect(pythonRefusal("ls -la /app/shared/skills", {}, noPython)).toBeNull();
    expect(pythonRefusal("echo 'python3 is not here'", {}, noPython)).toBeNull();
  });

  it("a python hidden after a separator is still a python", async () => {
    for (const command of [
      "ls; python3 /app/shared/skills/freeze_team.py",
      "true && python3 /app/shared/skills/db_query.py stats",
      "echo $(python3 -c 'print(1)')",
    ]) {
      expect((await run(command)).ok).toBe(false);
    }
  });
});

/**
 * The refusal is a constant, the REASON is a measurement (21/09, rilievo di
 * SICUREZZA on 8fad63768). The two closing messages asserted a fact about the
 * box — "the image carries no Python". True of today's image, measured; false
 * on a development box, and false the day an image ships an interpreter. A
 * model handed a reason it can check and find wrong has been given a door, not
 * a wall. Same shape as the PDF toolchain, where the rule we took was
 * "detected, not declared".
 */
describe("the reason for refusing python is measured, not asserted", () => {
  it("refuses either way: the script has a tool, wherever Python is", () => {
    for (const env of [noPython, withPython]) {
      const refusal = pythonRefusal("python3 /app/shared/skills/db_query.py stats", {}, env);
      expect(refusal).toContain("db_query");
      expect(refusal).toContain("Nothing was run.");
    }
  });

  it("says the interpreter is missing only where it is missing", () => {
    for (const command of ["python3 /app/shared/skills/unknown_script.py", "python3 -c 'print(1)'"]) {
      expect(pythonRefusal(command, {}, noPython)).toContain("no Python");

      const present = pythonRefusal(command, {}, withPython) ?? "";
      expect(present).toContain("Nothing was run.");
      expect(present).not.toContain("no Python");
      expect(present).not.toContain("there is no interpreter");
      expect(present).toContain("does not run Python");
    }
  });
});
