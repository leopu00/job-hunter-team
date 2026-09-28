/**
 * The ASSISTENTE's flags (ready.flag, welcomed.flag) as a tool.
 *
 * With bash in the kernel sandbox the ASSISTENTE can no longer write the
 * person's profile from the shell (integrated in 811212588): `date > ready.flag`
 * and `rm -f ready.flag` of its profile-yaml skill fail, and the removal — the
 * step that puts the "Vai alla dashboard" button back on hold — has no other
 * tool at all. The tool is exactly as wide as that job.
 */

import { existsSync, lstatSync, lutimesSync, mkdirSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSkillTools } from "../src/parity/skills/index.ts";
import { createProfileFlagTool } from "../src/parity/skills/profile-flag.ts";
import type { ToolContext } from "../src/tools/registry.ts";

const CONTEXT = { remainingMs: () => 60_000 } as unknown as ToolContext;

let root: string;
let profileDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-profile-flag-"));
  profileDir = join(root, "profile");
  mkdirSync(profileDir);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const tool = () => createProfileFlagTool({ profileDir, now: () => new Date("2026-09-28T01:30:12.345Z") });
const call = (flag: string, action: string) => tool().execute({ flag, action }, CONTEXT);
/** The temps of a `set` of ready.flag in the profile folder, left behind or in flight. */
const temps = () => readdirSync(profileDir).filter((name) => /^\.ready\.flag\..+\.tmp$/.test(name));
/** Five minutes old: well past the age at which a leftover is taken for one. */
const age = (path: string) => {
  const old = new Date(Date.now() - 5 * 60_000);
  utimesSync(path, old, old);
};

describe("profile_flag", () => {
  it("sets, checks and clears ready.flag, reading the answer back from the disk", async () => {
    expect(await call("ready", "check")).toMatchObject({ ok: true, content: "FLAG_MISSING ready.flag" });
    expect(await call("ready", "set")).toMatchObject({ ok: true, content: "FLAG_OK ready.flag" });
    // What `date -u +%Y-%m-%dT%H:%M:%SZ > ready.flag` writes.
    expect(readFileSync(join(profileDir, "ready.flag"), "utf8")).toBe("2026-09-28T01:30:12Z\n");
    expect(await call("ready", "check")).toMatchObject({ ok: true, content: "FLAG_OK ready.flag" });

    // The button back on hold: the one step with no other tool.
    expect(await call("ready", "clear")).toMatchObject({ ok: true, content: "FLAG_MISSING ready.flag" });
    expect(existsSync(join(profileDir, "ready.flag"))).toBe(false);
    expect(await call("ready", "clear")).toMatchObject({ ok: true, content: "FLAG_MISSING ready.flag" });
  });

  it("touches welcomed.flag empty, as the welcome handshake does", async () => {
    expect(await call("welcomed", "set")).toMatchObject({ ok: true, content: "FLAG_OK welcomed.flag" });
    expect(readFileSync(join(profileDir, "welcomed.flag"), "utf8")).toBe("");
  });

  it("names no path: two flags, three actions, nothing else in the folder", () => {
    const schema = tool().spec.schema;
    expect(schema.safeParse({ flag: "ready", action: "set" }).success).toBe(true);
    for (const args of [
      { flag: "candidate_profile.yml", action: "set" },
      { flag: "../ready", action: "set" },
      { flag: "ready", action: "write" },
      { flag: "ready", action: "set", path: "/etc/passwd" },
    ]) {
      expect(schema.safeParse(args).success, JSON.stringify(args)).toBe(false);
    }
  });

  it("does not follow a link where the flag should be, and does not replace it", async () => {
    const outside = join(root, "not-the-profile.txt");
    writeFileSync(outside, "someone else's file\n");
    symlinkSync(outside, join(profileDir, "ready.flag"));

    for (const action of ["set", "clear"]) {
      const answer = await call("ready", action);
      expect(answer.ok, action).toBe(false);
      expect(answer.content).toContain("symbolic link");
    }
    expect(readFileSync(outside, "utf8")).toBe("someone else's file\n");
    expect(lstatSync(join(profileDir, "ready.flag")).isSymbolicLink()).toBe(true);
  });

  it("is not blocked by the temp a failed set left behind, and removes it once it is stale", async () => {
    // The old name: the pid alone, the same after every restart of the container.
    const leftover = join(profileDir, `.ready.flag.${process.pid}.tmp`);
    writeFileSync(leftover, "");
    age(leftover);
    // Young: possibly another process's write in flight, so left alone.
    const young = join(profileDir, ".ready.flag.4242.tmp");
    writeFileSync(young, "");
    // Not a leftover of ready.flag: not looked at.
    const others = [".ready.flag.tmp", ".welcomed.flag.7.tmp", "ready.flag.7.tmp", ".ready.flag.7.tmp.bak"];
    for (const name of others) {
      writeFileSync(join(profileDir, name), "");
      age(join(profileDir, name));
    }

    expect(await call("ready", "set")).toMatchObject({ ok: true, content: "FLAG_OK ready.flag" });
    expect(readFileSync(join(profileDir, "ready.flag"), "utf8")).toBe("2026-09-28T01:30:12Z\n");
    expect(existsSync(leftover)).toBe(false);
    expect(temps()).toEqual([".ready.flag.4242.tmp"]);
    for (const name of others) expect(existsSync(join(profileDir, name)), name).toBe(true);
  });

  it("does not follow or remove a link or a directory that has a leftover's name", async () => {
    const outside = join(root, "not-the-profile.txt");
    writeFileSync(outside, "someone else's file\n");
    age(outside);
    const link = join(profileDir, ".ready.flag.123.tmp");
    symlinkSync(outside, link);
    const old = new Date(Date.now() - 5 * 60_000);
    lutimesSync(link, old, old);
    const dir = join(profileDir, ".ready.flag.456.tmp");
    mkdirSync(dir);
    writeFileSync(join(dir, "inside"), "kept\n");
    age(dir);

    expect(await call("ready", "set")).toMatchObject({ ok: true, content: "FLAG_OK ready.flag" });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(outside, "utf8")).toBe("someone else's file\n");
    expect(lstatSync(dir).isDirectory()).toBe(true);
    expect(readFileSync(join(dir, "inside"), "utf8")).toBe("kept\n");
    expect(temps().sort()).toEqual([".ready.flag.123.tmp", ".ready.flag.456.tmp"]);
  });

  it("leaves no temp behind when the rename fails, and says the flag is missing", async () => {
    // A directory takes the flag's name after the check and before the rename:
    // the temp is written, the rename over a directory fails.
    const racing = createProfileFlagTool({
      profileDir,
      now: () => {
        mkdirSync(join(profileDir, "ready.flag"));
        return new Date("2026-09-28T01:30:12.345Z");
      },
    });
    const answer = await racing.execute({ flag: "ready", action: "set" }, CONTEXT);
    expect(answer.ok).toBe(false);
    expect(answer.content).toContain("could not be written");
    expect(answer.content).toContain("FLAG_MISSING ready.flag");
    expect(temps()).toEqual([]);
    expect(lstatSync(join(profileDir, "ready.flag")).isDirectory()).toBe(true);
  });

  it("is the ASSISTENTE's alone", () => {
    const names = (agent: string) => createSkillTools({ skills: [], agent, profileDir }).map((t) => t.spec.name);
    expect(names("assistente-1")).toContain("profile_flag");
    for (const agent of ["scout-1", "capitano-1", "scrittore-1", "mentor-1"]) expect(names(agent), agent).not.toContain("profile_flag");
  });
});
