/**
 * The ASSISTENTE's flags (ready.flag, welcomed.flag) as a tool.
 *
 * With bash in the kernel sandbox the ASSISTENTE can no longer write the
 * person's profile from the shell (integrated in 811212588): `date > ready.flag`
 * and `rm -f ready.flag` of its profile-yaml skill fail, and the removal — the
 * step that puts the "Vai alla dashboard" button back on hold — has no other
 * tool at all. The tool is exactly as wide as that job.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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

  it("is the ASSISTENTE's alone", () => {
    const names = (agent: string) => createSkillTools({ skills: [], agent, profileDir }).map((t) => t.spec.name);
    expect(names("assistente-1")).toContain("profile_flag");
    for (const agent of ["scout-1", "capitano-1", "scrittore-1", "mentor-1"]) expect(names(agent), agent).not.toContain("profile_flag");
  });
});
