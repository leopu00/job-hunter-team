/**
 * T38: the ASSISTENTE's profile validator, judged against the script it
 * replaces.
 *
 * Every case runs `shared/skills/validate_profile.py` and the port on the same
 * file and compares what each prints, line for line, on stdout and stderr, and
 * the exit code. The port is a copy of a validator, and a copy is precisely
 * how a ruler splits in silence — so the comparison is the test, not a list of
 * expectations written by hand.
 *
 * Skipped where python3 or the commit the schema was dumped from is not at
 * hand (the image has neither); the checks that do not need Python still run.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createValidateProfileTool, runValidateProfile } from "../src/parity/skills/validate-profile.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const SKILLS = pythonSkills();
const context = { account: undefined as never, remainingMs: () => 60_000 };

let root: string;
let workdir: string;
let profileDir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-validate-profile-"));
  workdir = join(root, "home");
  profileDir = join(root, "profile");
  for (const dir of [workdir, profileDir]) mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A profile the whole team would accept, as `profile-schema/SKILL.md` writes it. */
const GOOD = `name: A Person
target_role: Backend Engineer
location: Roma, Italia
experience_years: 6
has_degree: true
seniority_target: mid
skills:
  primary:
    - TypeScript
    - SQLite
  secondary:
    - Docker
languages:
  - language: Italiano
    level: madrelingua
  - language: English
    level: C1
`;

/** Each case: a name, and the profile text both sides are given. */
const CASES: Array<[string, string]> = [
  ["a profile the team can use", GOOD],
  ["one with nothing in it", "{}\n"],
  ["one that is not a mapping", "- a list\n- of things\n"],
  ["one whose YAML does not parse", "name: [unclosed\n"],
  ["one missing the mandatory core", "name: A Person\nskills:\n  primary: [Go]\nlanguages:\n  - language: it\n    level: C2\n"],
  ["years as a float, which Python does not take for an int", GOOD.replace("experience_years: 6", "experience_years: 6.0")],
  ["years as a YAML 1.1 string", GOOD.replace("experience_years: 6", "experience_years: '6'")],
  ["a negative number of years", GOOD.replace("experience_years: 6", "experience_years: -1")],
  ["has_degree written as yes, which YAML 1.1 reads as a boolean", GOOD.replace("has_degree: true", "has_degree: yes")],
  ["has_degree written as a word", GOOD.replace("has_degree: true", 'has_degree: "true"')],
  ["the legacy flat list of skills", GOOD.replace("skills:\n  primary:\n    - TypeScript\n    - SQLite\n  secondary:\n    - Docker", "skills:\n  - TypeScript")],
  ["an empty flat list of skills", GOOD.replace("skills:\n  primary:\n    - TypeScript\n    - SQLite\n  secondary:\n    - Docker", "skills: []")],
  ["skills that are not a list at all", GOOD.replace("skills:\n  primary:\n    - TypeScript\n    - SQLite\n  secondary:\n    - Docker", "skills: TypeScript")],
  ["the legacy name of a language", GOOD.replace("- language: Italiano", "- name: Italiano")],
  ["a language with no level", GOOD.replace("  - language: English\n    level: C1", "  - language: English")],
  ["a language that is a string", GOOD.replace("  - language: English\n    level: C1", "  - English")],
  ["no languages at all", GOOD.replace(/languages:\n(?:.*\n)+$/, "languages: []\n")],
  [
    "the dashboard blocks, all six kinds",
    `${GOOD}blocks:
  - key: about
    title: About
    kind: narrative
    content: A paragraph.
  - key: tags
    title: Tags
    kind: tag_list
    content: [go, sql]
  - key: facts
    title: Facts
    kind: key_value
    content:
      - label: Base
        value: Roma
  - key: points
    title: Points
    kind: key_points
    content:
      - heading: One
        text: first
  - key: path
    title: Path
    kind: timeline
    content:
      - title: A job
  - key: split
    title: Split
    kind: distribution
    content:
      - label: Backend
        value: 70
`,
  ],
  [
    "blocks with a bad kind, a duplicate key and content of the wrong shape",
    `${GOOD}blocks:
  - key: about
    title: About
    kind: essay
    content: A paragraph.
  - key: about
    title: Again
    kind: tag_list
    content: not a list
  - key: split
    title: Split
    kind: distribution
    content:
      - label: Backend
        value: "seventy"
  - a string, not an object
`,
  ],
  ["blocks that are not a list", `${GOOD}blocks: nope\n`],
  ["a target role category that is not canonical", `${GOOD}target_role_category_id: wizardry\n`],
  ["a specialty without its category", `${GOOD}target_specialty: backend\n`],
  ["a specialty that belongs to another category", `${GOOD}target_role_category_id: data\ntarget_specialty: backend\n`],
  ["a canonical pair", `${GOOD}target_role_category_id: software\ntarget_specialty: backend\n`],
];

describe("against shared/skills/validate_profile.py", () => {
  for (const [name, text] of CASES) {
    for (const flags of [[], ["--strict"], ["--json"]] as string[][]) {
      it.skipIf(SKILLS === null)(`says the same as the script for ${name}${flags.length ? ` ${flags.join(" ")}` : ""}`, () => {
        const file = join(profileDir, "candidate_profile.yml");
        writeFileSync(file, text);
        const mine = runValidateProfile([file, ...flags], (p) => p);
        const script = runPython(SKILLS!, [join(SKILLS!, "validate_profile.py"), file, ...flags], {});

        expect(mine.stdout).toBe(script.stdout);
        // The script's YAML error carries PyYAML's own wording; ours carries
        // the reader's. Both say INVALID_PROFILE first, and that is the line
        // the skill acts on.
        const trimmed = (out: string) => out.split("\n").slice(0, 1).join("\n");
        expect(mine.stderr.includes("YAML could not be parsed") ? trimmed(mine.stderr) : mine.stderr).toBe(
          script.stderr.includes("YAML could not be parsed") ? trimmed(script.stderr) : script.stderr,
        );
        expect(mine.exitCode).toBe(script.status);
      });
    }
  }

  it.skipIf(SKILLS === null)("says the same as the script with no path at all, and for a file that is not there", () => {
    for (const args of [[], [join(profileDir, "missing.yml")]]) {
      const mine = runValidateProfile(args, (p) => p);
      const script = runPython(SKILLS!, [join(SKILLS!, "validate_profile.py"), ...args], {});
      expect(mine.stdout).toBe(script.stdout);
      expect(mine.stderr).toBe(script.stderr);
      expect(mine.exitCode).toBe(script.status);
    }
  });
});

describe("the tool", () => {
  const tool = () => createValidateProfileTool({ profileDir, workdir });
  const call = (args: string[]) => {
    const handler = tool();
    return handler.execute(handler.spec.schema.parse({ args }), context);
  };

  it("validates the profile the ASSISTENTE just wrote, and says which line is wrong", async () => {
    const file = join(profileDir, "candidate_profile.yml");
    writeFileSync(file, GOOD);
    expect(await call([file])).toMatchObject({ ok: true, content: expect.stringContaining("VALID_PROFILE") });

    writeFileSync(file, GOOD.replace("has_degree: true", "has_degree: maybe"));
    const bad = await call([file]);
    // Exit 1 is an answer here, not a failure: the skill reads it and fixes.
    expect(bad.ok).toBe(true);
    expect(bad.content).toContain("INVALID_PROFILE");
    expect(bad.content).toContain("has_degree: boolean required");
  });

  it("reads a draft in the agent's own folder, and nothing outside those two", async () => {
    writeFileSync(join(workdir, "draft.yml"), GOOD);
    expect(await call([join(workdir, "draft.yml")])).toMatchObject({ ok: true, content: expect.stringContaining("VALID_PROFILE") });

    writeFileSync(join(root, "elsewhere.yml"), GOOD);
    const outside = await call([join(root, "elsewhere.yml")]);
    expect(outside.content).toMatch(/the person's profile folder and your own/);
    expect(outside.content).not.toContain("VALID_PROFILE");
    const climbing = await call([join(profileDir, "..", "elsewhere.yml")]);
    expect(climbing.content).toMatch(/the person's profile folder and your own/);
  });

  it("makes the transition's warnings blocking with --strict, as the CLI does after a migration", () => {
    const file = join(profileDir, "candidate_profile.yml");
    writeFileSync(file, GOOD.replace("- language: Italiano", "- name: Italiano"));
    const report = JSON.parse(runValidateProfile([file, "--json"], (p) => p).stdout) as { ok: boolean; errors: string[]; warnings: string[] };
    expect(report).toEqual({ ok: true, errors: [], warnings: ["languages[0]: use 'language' (not 'name') — canonical key"] });
    expect(runValidateProfile([file], (p) => p).exitCode).toBe(0);
    expect(runValidateProfile([file, "--strict"], (p) => p).exitCode).toBe(1);
  });

  it("reads the YAML as PyYAML reads it, where the two differ", () => {
    const file = join(profileDir, "candidate_profile.yml");
    // `yes` is a boolean in YAML 1.1 and a string in 1.2: the profile the
    // person's box writes is read by PyYAML, so 1.1 is the right answer.
    writeFileSync(file, GOOD.replace("has_degree: true", "has_degree: yes"));
    expect(runValidateProfile([file], (p) => p).exitCode).toBe(0);
    // An int is not a float: `6.0` fails the years, as it does in the script.
    writeFileSync(file, GOOD.replace("experience_years: 6", "experience_years: 6.0"));
    expect(runValidateProfile([file], (p) => p).stderr).toContain("experience_years: integer >= 0 required");
  });
});
