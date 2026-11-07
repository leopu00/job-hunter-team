import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const gate = fileURLToPath(new URL("../../../scripts/pre-commit/npm-audit-prod.mjs", import.meta.url));
const sandboxes: string[] = [];

function sandbox() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jht-npm-audit-")));
  sandboxes.push(root);
  const hook = path.join(root, "scripts/pre-commit/npm-audit-prod.mjs");
  mkdirSync(path.dirname(hook), { recursive: true });
  copyFileSync(gate, hook);
  for (const workspace of ["cli", "web"]) {
    mkdirSync(path.join(root, workspace));
    writeFileSync(path.join(root, workspace, "package.json"), JSON.stringify({ name: `fixture-${workspace}`, private: true }));
    writeFileSync(path.join(root, workspace, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  }
  const calls = path.join(root, "calls.jsonl");
  writeFileSync(calls, "");
  const preload = path.join(root, "fake-npm.mjs");
  writeFileSync(preload, `
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
childProcess.spawnSync = (command, args, options) => {
  appendFileSync(process.env.JHT_AUDIT_TEST_CALLS, JSON.stringify({ command, args, cwd: options.cwd }) + '\\n');
  return { status: path.basename(options.cwd) === process.env.JHT_AUDIT_TEST_FAILURE ? 1 : 0 };
};
syncBuiltinESMExports();
`);
  return { root, hook, calls, preload };
}

function run(fixture: ReturnType<typeof sandbox>, failure = "") {
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(fixture.preload).href, fixture.hook], {
    cwd: tmpdir(),
    encoding: "utf-8",
    env: { ...process.env, JHT_AUDIT_TEST_CALLS: fixture.calls, JHT_AUDIT_TEST_FAILURE: failure },
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const calls = readFileSync(fixture.calls, "utf-8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { ...result, calls };
}

afterEach(() => {
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("production npm audit pre-commit gate", () => {
  it("audits both complete workspaces with the production high severity policy", () => {
    const fixture = sandbox();
    const result = run(fixture);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.calls).toEqual(["cli", "web"].map((workspace) => ({
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      args: ["audit", "--omit=dev", "--audit-level=high"],
      cwd: path.join(fixture.root, workspace),
    })));
  });

  it.each([
    ["cli", "package.json"],
    ["cli", "package-lock.json"],
    ["web", "package.json"],
    ["web", "package-lock.json"],
  ])("fails with a code when %s/%s is missing and still audits the other workspace", (workspace, file) => {
    const fixture = sandbox();
    rmSync(path.join(fixture.root, workspace, file));
    const result = run(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NPM_AUDIT_INPUT_MISSING");
    expect(result.stderr).toContain(`${workspace}/${file}`);
    expect(result.calls.map((call) => path.basename(call.cwd))).toEqual([workspace === "cli" ? "web" : "cli"]);
  });

  it("reports all missing inputs instead of silently passing an empty layout", () => {
    const fixture = sandbox();
    for (const workspace of ["cli", "web"]) rmSync(path.join(fixture.root, workspace), { recursive: true });
    const result = run(fixture);
    expect(result.status).toBe(1);
    for (const workspace of ["cli", "web"]) {
      for (const file of ["package.json", "package-lock.json"]) expect(result.stderr).toContain(`${workspace}/${file}`);
    }
    expect(result.calls).toEqual([]);
  });

  it.each(["cli", "web"])("keeps audit failures in %s blocking without skipping either audit", (workspace) => {
    const fixture = sandbox();
    const result = run(fixture, workspace);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${workspace}:`);
    expect(result.calls.map((call) => path.basename(call.cwd))).toEqual(["cli", "web"]);
  });
});
