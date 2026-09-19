import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { displayPath, isInside, isSensitivePath, resolveUserPath } from "../src/tools/paths.ts";
import { TurnAccount } from "../src/core/agent-loop.ts";
import type { ToolHandler } from "../src/tools/registry.ts";

const CONTEXT = { account: new TurnAccount(Date.now), remainingMs: () => 60_000 };
import { createWorkspaceTools } from "../src/tools/workspace.ts";

let root: string;
let tools: Record<string, ToolHandler>;

async function call(name: string, args: Record<string, unknown>) {
  const tool = tools[name]!;
  const parsed = tool.spec.schema.parse(args);
  return tool.execute(parsed, CONTEXT);
}

beforeAll(async () => {
  // Real path: the tools resolve symlinks, and on macOS the temp folder is one.
  root = await realpath(await mkdtemp(join(tmpdir(), "jht-api-ws-")));
  await mkdir(join(root, "notes", "deep"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "notes", "README.md"), "# Search\nbudget: 1400\nzone: Rome\n");
  await writeFile(join(root, "notes", "deep", "areas.md"), "Monteverde\nTrastevere\n");
  await writeFile(join(root, "node_modules", "pkg", "index.md"), "budget: hidden\n");
  await writeFile(join(root, ".env"), "OPENAI_API_KEY=budget-secret\n");
  await writeFile(join(root, "blob.bin"), Buffer.from([1, 0, 2, 3]));
  await writeFile(join(root, "long.txt"), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
  tools = Object.fromEntries(
    createWorkspaceTools({ workdir: root, homeDir: root }).map((t) => [t.spec.name, t]),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("read_file", () => {
  it("returns numbered lines", async () => {
    const result = await call("read_file", { path: "notes/README.md" });
    expect(result).toEqual({ ok: true, content: "1\t# Search\n2\tbudget: 1400\n3\tzone: Rome" });
  });

  it("accepts ~ and absolute paths", async () => {
    expect((await call("read_file", { path: "~/notes/README.md" })).ok).toBe(true);
    expect((await call("read_file", { path: join(root, "notes/README.md") })).ok).toBe(true);
  });

  it("reads a window and says where it is", async () => {
    const result = await call("read_file", { path: "long.txt", offset: 10, limit: 3 });
    expect(result.content).toBe("10\tline 10\n11\tline 11\n12\tline 12\n[lines 10–12 of 30]");
  });

  it("explains a missing file, a folder and a binary file", async () => {
    expect(await call("read_file", { path: "nope.md" })).toEqual({ ok: false, content: "There is no file at ~/nope.md." });
    expect((await call("read_file", { path: "notes" })).content).toContain("is a folder");
    expect((await call("read_file", { path: "blob.bin" })).content).toContain("looks binary");
  });
});

describe("write_file and edit_file", () => {
  it("creates parent folders and reports bytes, not content", async () => {
    const result = await call("write_file", { path: "out/new/file.md", content: "hello" });
    expect(result).toEqual({ ok: true, content: "Created ~/out/new/file.md (5 bytes)." });
    expect(await readFile(join(root, "out/new/file.md"), "utf8")).toBe("hello");
    expect((await call("write_file", { path: "out/new/file.md", content: "again" })).content).toContain("Replaced");
  });

  it("replaces text that appears exactly once, literally", async () => {
    await call("write_file", { path: "edit.md", content: "a = 1\nb = 2\n" });
    const result = await call("edit_file", { path: "edit.md", old_string: "b = 2", new_string: "b = $&3" });
    expect(result).toEqual({ ok: true, content: "Replaced 1 occurrence in ~/edit.md." });
    expect(await readFile(join(root, "edit.md"), "utf8")).toBe("a = 1\nb = $&3\n");
  });

  it("refuses a missing or ambiguous old_string, and replace_all fixes the second", async () => {
    await call("write_file", { path: "dup.md", content: "x x x" });
    expect((await call("edit_file", { path: "dup.md", old_string: "y", new_string: "z" })).content).toContain("not found");
    expect((await call("edit_file", { path: "dup.md", old_string: "x", new_string: "z" })).content).toContain("appears 3 times");
    expect((await call("edit_file", { path: "dup.md", old_string: "x", new_string: "z", replace_all: true })).ok).toBe(true);
    expect(await readFile(join(root, "dup.md"), "utf8")).toBe("z z z");
  });
});

describe("glob and grep", () => {
  it("finds files by pattern and skips node_modules", async () => {
    const result = await call("glob", { pattern: "**/*.md" });
    expect(result.content).toContain("notes/README.md");
    expect(result.content).toContain("notes/deep/areas.md");
    expect(result.content).not.toContain("node_modules");
  });

  it("searches contents, skipping node_modules, binaries and credential files", async () => {
    const result = await call("grep", { pattern: "budget" });
    expect(result.content).toContain("notes/README.md:2:budget: 1400");
    expect(result.content).not.toContain("hidden");
    expect(result.content).not.toContain("secret");
  });

  it("filters by glob, ignores case and reports an invalid pattern", async () => {
    expect((await call("grep", { pattern: "monteverde", ignore_case: true, glob: "*.md" })).content).toContain(
      "notes/deep/areas.md:1:Monteverde",
    );
    expect((await call("grep", { pattern: "Rome", glob: "*.txt" })).content).toContain("No matches");
    expect((await call("grep", { pattern: "(" })).content).toContain("Invalid regular expression");
  });
});

describe("classify", () => {
  it("names the risk and the absolute paths before anything runs", () => {
    expect(tools["read_file"]!.classify({ path: "~/notes/README.md" })).toEqual({
      risk: "read",
      paths: [join(root, "notes/README.md")],
      summary: "~/notes/README.md",
    });
    expect(tools["edit_file"]!.classify({ path: "a.md", old_string: "x", new_string: "y" }).risk).toBe("write");
    expect(tools["grep"]!.classify({ pattern: "x", path: "/etc" }).paths).toEqual([realpathSync("/etc")]);
  });
});

describe("path helpers", () => {
  it("resolves ~, relative and absolute paths", () => {
    expect(resolveUserPath("~/a", "/work", "/home/me")).toBe("/home/me/a");
    expect(resolveUserPath("a/../b", "/work", "/home/me")).toBe("/work/b");
    expect(resolveUserPath("/etc", "/work", "/home/me")).toBe("/etc");
  });

  it("treats only a whole .. segment as leaving a folder", () => {
    expect(isInside("/notes", "/notes/..notes.md")).toBe(true);
    expect(isInside("/notes", "/notes-old")).toBe(false);
    expect(isInside("/notes", "/")).toBe(false);
  });

  it("hides the home directory", () => {
    expect(displayPath("/home/me/Documents", "/home/me")).toBe("~/Documents");
    expect(displayPath("/home/meadow", "/home/me")).toBe("/home/meadow");
  });

  it("recognises credential files", () => {
    for (const p of ["/r/.env", "/r/.env.local", "/h/.ssh/config", "/h/.aws/credentials", "/h/id_rsa", "/k/server.pem", "/h/.npmrc"]) {
      expect(isSensitivePath(p), p).toBe(true);
    }
    for (const p of ["/r/.env.example", "/r/README.md", "/r/environment.md", "/r/keys.md"]) {
      expect(isSensitivePath(p), p).toBe(false);
    }
  });
});
