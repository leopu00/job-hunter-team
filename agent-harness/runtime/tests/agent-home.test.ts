import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HOME_MARKER, prepareAgentHome, writeIdentity } from "../src/core/agent-home.ts";
import { isHarnessError } from "../src/core/errors.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-api-home-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("prepareAgentHome", () => {
  it("creates a home holding only the marker, the identity and the skills", async () => {
    const skills = join(root, "repo-skills");
    await mkdir(join(skills, "copy-in"), { recursive: true });
    await writeFile(join(skills, "copy-in", "SKILL.md"), "skill\n");
    const dir = join(root, "agents", "scout");

    await prepareAgentHome({ dir, role: "scout", skillsSource: skills, fresh: true });
    await writeIdentity(dir, "prompt");

    expect((await readdir(dir)).sort()).toEqual([HOME_MARKER, "AGENTS.md", "skills"].sort());
    expect(await readFile(join(dir, "skills", "copy-in", "SKILL.md"), "utf8")).toBe("skill\n");
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("prompt\n");
  });

  it("empties what an earlier run left when fresh, and keeps it otherwise", async () => {
    const dir = join(root, "home");
    await prepareAgentHome({ dir, role: "scout", fresh: true });
    await mkdir(join(dir, "inputs"));
    await writeFile(join(dir, "inputs", "note.md"), "x");

    await prepareAgentHome({ dir, role: "scout", fresh: false });
    expect(await readdir(dir)).toContain("inputs");

    await prepareAgentHome({ dir, role: "scout", fresh: true });
    expect(await readdir(dir)).toEqual([HOME_MARKER]);
  });

  it("refuses to empty a folder it did not create", async () => {
    const dir = join(root, "someone-else");
    await mkdir(dir);
    await writeFile(join(dir, "precious.txt"), "keep me");

    const error = await prepareAgentHome({ dir, role: "scout", fresh: true }).catch((e: unknown) => e);
    expect(isHarnessError(error) && error.code).toBe("config_invalid");
    expect(await readFile(join(dir, "precious.txt"), "utf8")).toBe("keep me");
  });
});
