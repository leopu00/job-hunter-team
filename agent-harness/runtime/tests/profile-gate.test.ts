/**
 * The native profile gate against `shared/skills/profile_gate.py`: every
 * profile below is written to a file, judged by the script, and judged here.
 * The verdict and the reason must be the same; for a file PyYAML cannot parse
 * only the reason's prefix is compared, since each parser words its error
 * its own way.
 *
 * Needs python3 with PyYAML; without it the parity cases are skipped and the
 * native-only cases still run.
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkMinimumViableProfile } from "../src/parity/skills/profile-gate.ts";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "shared", "skills", "profile_gate.py");
const HAS_PYYAML = spawnSync("python3", ["-c", "import yaml"]).status === 0;

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-profile-gate-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function python(path: string): { ok: boolean; reason: string } {
  const run = spawnSync("python3", [GATE, path], { encoding: "utf8" });
  const reason = run.stderr.match(/^PROFILE_MISSING: (.*)$/m)?.[1] ?? "";
  return { ok: run.status === 0, reason };
}

const PROFILES: Record<string, string | Uint8Array> = {
  "full": "name: Ada Example\ntarget_role: Backend Engineer\nskills: [go, sql]\n",
  "nested candidate": "candidate:\n  target_role: Data Engineer\n  skills:\n    primary: python\n",
  "target_roles list": "target_roles:\n  - SRE\nlocation: Turin\n",
  "only target_role": "target_role: Backend Engineer\n",
  "blank target": "target_role: '   '\nname: Ada\n",
  "no target": "name: Ada\nskills: [go]\n",
  "template name": "name: '  NOME Cognome '\ntarget_role: Dev\n",
  "personal name": "personal:\n  name: Ada\ntarget_role: Dev\n",
  "experience_years int": "target_role: Dev\nexperience_years: 5\n",
  "experience_years float": "target_role: Dev\nexperience_years: 5.0\n",
  "experience_years bool": "target_role: Dev\nexperience_years: yes\n",
  "experience_years string": "target_role: Dev\nexperience_years: '5'\n",
  "experience_years sexagesimal": "target_role: Dev\nexperience_years: 1:30\n",
  "target 1e3": "target_role: 1e3\nname: Ada\n",
  "target 1.5e3": "target_role: 1.5e3\nname: Ada\n",
  "target 1.5e+3": "target_role: 1.5e+3\nname: Ada\n",
  "target explicit float": "target_role: !!float 1\nname: Ada\n",
  "target explicit int": "target_role: !!int '7'\nname: Ada\n",
  "target yes": "target_role: yes\nname: Ada\n",
  "target date": "target_role: 2024-01-01\nname: Ada\n",
  "target null": "target_role: ~\nname: Ada\n",
  "empty skills dict": "target_role: Dev\nskills: {a: '', b: []}\n",
  "skills dict nested": "target_role: Dev\nskills: {a: {b: x}}\n",
  "empty list languages": "target_role: Dev\nlanguages: []\n",
  "languages list": "target_role: Dev\nlanguages: [it]\n",
  "experience list": "target_role: Dev\nexperience: [{}]\n",
  "duplicate keys": "target_role: ''\ntarget_role: Dev\nname: Ada\n",
  "merge key": "base: &b\n  target_role: Dev\n  name: Ada\ncandidate:\n  <<: *b\n",
  "empty file": "",
  "only comment": "# nothing yet\n",
  "empty dict": "{}\n",
  "scalar": "just a string\n",
  "list": "- target_role: Dev\n",
  "unicode space target": "target_role: \"\\u3000\"\nname: Ada\n",
  "nbsp name only": "target_role: Dev\nname: \"\\xa0\"\n",
  "bom": "\ufefftarget_role: Dev\nname: Ada\n",
  "python tag": "target_role: !!python/object:os.system Dev\nname: Ada\n",
  "custom tag": "target_role: !custom Dev\nname: Ada\n",
  "str tag": "target_role: !!str 123\nname: Ada\n",
  "two documents": "target_role: Dev\n---\nname: Ada\n",
  "broken yaml": "target_role: [Dev\nname: Ada\n",
  "invalid utf8": new Uint8Array([0x74, 0x61, 0x72, 0x3a, 0x20, 0xff, 0xfe, 0x0a]),
};

/**
 * Both refuse, for different reasons. PyYAML does not catch a decode error:
 * the script dies with a traceback. `!!float 1` is 1.0 to PyYAML, not a
 * target role; the parser here cannot resolve the tag and refuses the file.
 */
const VERDICT_ONLY = new Set(["invalid utf8", "target explicit float"]);

describe("profile_gate ↔ profile_gate.py", () => {
  it.skipIf(!HAS_PYYAML).each(Object.keys(PROFILES))("%s", async (label) => {
    const dir = join(root, label.replaceAll(" ", "-"));
    await mkdir(dir, { recursive: true });
    const path = join(dir, "candidate_profile.yml");
    await writeFile(path, PROFILES[label]!);
    const native = checkMinimumViableProfile(path);
    const script = python(path);
    expect(native.ok, native.reason).toBe(script.ok);
    const prefix = "candidate profile could not be";
    if (script.reason.startsWith(prefix)) expect(native.reason.startsWith(prefix), native.reason).toBe(true);
    else if (!VERDICT_ONLY.has(label)) expect(native.reason).toBe(script.reason);
  });
});

describe("profile_gate, native", () => {
  it("fails closed on a missing file and on a folder", async () => {
    expect(checkMinimumViableProfile(join(root, "absent.yml"))).toEqual({
      ok: false,
      reason: `candidate profile is missing: file not found (${join(root, "absent.yml")})`,
    });
    expect(checkMinimumViableProfile(root).ok).toBe(false);
  });

  it("refuses a billion-laughs profile instead of expanding it", async () => {
    const lines = ["a: &a [x, x, x, x, x, x, x, x, x]"];
    for (let i = 1; i < 10; i++) lines.push(`${"a".repeat(i + 1)}: &${"a".repeat(i + 1)} [${Array(9).fill(`*${"a".repeat(i)}`).join(", ")}]`);
    lines.push("target_role: Dev", "name: Ada");
    const path = join(root, "laughs.yml");
    await writeFile(path, lines.join("\n") + "\n");
    expect(checkMinimumViableProfile(path)).toMatchObject({ ok: false, reason: expect.stringContaining("could not be parsed") });
  });
});
