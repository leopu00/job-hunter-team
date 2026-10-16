import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readerOnProfile } from "./existing-team-reader-fixture";

// The reader the core runs on the team's VPS (POSITIONS_READ_PY in
// src-tauri/src/existing_team_runtime.rs), run for real on a synthetic profile
// folder: the candidate_profile.yml and summaries/*.md it may read, and the
// neighbours it must never open. Synthetic text only.
const python = spawnSync("python3", ["-I", "-c", "import os"]);
const available = python.status === 0;

// vitest runs from desktop/
const SOURCE = readFileSync(resolve(process.cwd(), "src-tauri/src/existing_team_runtime.rs"), "utf8");
const READER = /const POSITIONS_READ_PY: &str = r#"([\s\S]*?)"#;/.exec(SOURCE)?.[1] ?? "";

const YAML_MAX = 65536;
const SUMMARY_MAX = 32768;
const BUDGET = 1363148;
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

let root = "";
let reader = "";
let profile = "";

function ask(request: unknown = { op: "profile" }): any {
  const run = spawnSync("python3", ["-I", reader], { input: `${JSON.stringify(request)}\n`, maxBuffer: 64 * 1024 * 1024 });
  expect(run.status, String(run.stderr)).toBe(0);
  return { reply: JSON.parse(run.stdout.toString("utf8")), bytes: run.stdout.length };
}
const data = () => ask().reply.data;

beforeAll(() => {
  if (!available) return;
  root = mkdtempSync(join(tmpdir(), "jht-core-profile-"));
  reader = join(root, "reader.py");
  expect(READER).toContain("if op=='profile':");
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  if (!available) return;
  profile = join(root, `p${Math.random().toString(36).slice(2)}`);
  mkdirSync(profile);
  writeFileSync(reader, readerOnProfile(READER, profile));
});
afterEach(() => {
  if (profile) rmSync(profile, { recursive: true, force: true });
});

const YAML = "name: Synthetic Persona\ntarget_role: Synthetic Role\nlocation: Città — 東京\nnotes: |\n  " + "linea lunga ".repeat(200) + "\n";

describe.skipIf(!available)("the core's profile op on a synthetic profile folder", () => {
  it("reads the file and the summaries, with their lengths and hashes, non-ASCII included", () => {
    writeFileSync(join(profile, "candidate_profile.yml"), YAML);
    mkdirSync(join(profile, "summaries"));
    writeFileSync(join(profile, "summaries", "about.md"), "Sono una persona sintetica — 日本語.\n");
    writeFileSync(join(profile, "summaries", "goals.md"), "Obiettivo sintetico.\n");
    const result = data();
    expect(result.profile).toEqual({ state: "ok", bytes: Buffer.byteLength(YAML), sha256: sha(YAML), text: YAML });
    expect(result.summaries).toMatchObject({ state: "ok", included: 2, of: 2 });
    expect(result.summaries.items.map((item: any) => item.name)).toEqual(["about", "goals"]);
    expect(result.summaries.items[0]).toEqual({
      name: "about", state: "ok", bytes: Buffer.byteLength("Sono una persona sintetica — 日本語.\n"),
      sha256: sha("Sono una persona sintetica — 日本語.\n"), text: "Sono una persona sintetica — 日本語.\n",
    });
  });

  it("says a profile that is not there is not there: no folder, no file, no summaries", () => {
    rmSync(profile, { recursive: true });
    expect(data()).toEqual({ profile: { state: "absent" }, summaries: { state: "absent", items: [], included: 0, of: 0 } });
    mkdirSync(profile);
    expect(data()).toEqual({ profile: { state: "absent" }, summaries: { state: "absent", items: [], included: 0, of: 0 } });
    mkdirSync(join(profile, "summaries"));
    expect(data().summaries).toEqual({ state: "ok", items: [], included: 0, of: 0 });
  });

  it("refuses a file over the cap without reading it, and says its size", () => {
    writeFileSync(join(profile, "candidate_profile.yml"), "a: " + "x".repeat(YAML_MAX));
    const result = data().profile;
    expect(result).toEqual({ state: "too_large", bytes: YAML_MAX + 3 });
    // at the cap exactly it is read
    writeFileSync(join(profile, "candidate_profile.yml"), "a: " + "x".repeat(YAML_MAX - 3));
    expect(data().profile).toMatchObject({ state: "ok", bytes: YAML_MAX });
  });

  it("says a file that is not text is not text, with its hash and no content", () => {
    writeFileSync(join(profile, "candidate_profile.yml"), Buffer.from([0x6e, 0x3a, 0x20, 0xff, 0xfe, 0x0a]));
    expect(data().profile).toEqual({ state: "not_utf8", bytes: 6, sha256: sha(Buffer.from([0x6e, 0x3a, 0x20, 0xff, 0xfe, 0x0a])) });
  });

  it("keeps to summary names of letters, digits, dash and underscore, and reports every one it does not read", () => {
    mkdirSync(join(profile, "summaries"));
    const dir = join(profile, "summaries");
    writeFileSync(join(dir, "about.md"), "ok");
    writeFileSync(join(dir, "notes.txt"), "not a summary");
    writeFileSync(join(dir, "a b.md"), "space in the name");
    writeFileSync(join(dir, ".hidden.md"), "dot file");
    mkdirSync(join(dir, "folder.md"));
    writeFileSync(join(dir, "big.md"), "x".repeat(SUMMARY_MAX + 1));
    writeFileSync(join(dir, "edge.md"), "x".repeat(SUMMARY_MAX));
    const items = data().summaries.items as any[];
    expect(items.map((item) => [item.name, item.state])).toEqual([
      ["about", "ok"], ["big", "too_large"], ["edge", "ok"], ["folder", "unreadable"],
    ]);
    expect(items.find((item) => item.name === "big")).toEqual({ name: "big", state: "too_large", bytes: SUMMARY_MAX + 1 });
    expect(JSON.stringify(items)).not.toContain("not a summary");
  });

  it("reads 32 summaries at most and says how many there were", () => {
    mkdirSync(join(profile, "summaries"));
    for (let n = 0; n < 40; n++) writeFileSync(join(profile, "summaries", `s${String(n).padStart(2, "0")}.md`), `text ${n}`);
    const { summaries } = data();
    expect(summaries.included).toBe(32);
    expect(summaries.of).toBe(40);
    expect(summaries.items).toHaveLength(32);
  });

  it("never follows a link: a profile or a summary that points elsewhere is unreadable, and what it points at is not in the reply", () => {
    const secret = join(root, "outside-secret.txt");
    writeFileSync(secret, "SYNTHETIC-SECRET-MARKER");
    symlinkSync(secret, join(profile, "candidate_profile.yml"));
    mkdirSync(join(profile, "summaries"));
    symlinkSync(secret, join(profile, "summaries", "link.md"));
    const result = data();
    expect(result.profile).toEqual({ state: "unreadable" });
    expect(result.summaries.items).toEqual([{ state: "unreadable", name: "link" }]);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC-SECRET-MARKER");
    // a summaries folder that is a link is not entered
    rmSync(join(profile, "summaries"), { recursive: true });
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "about.md"), "SYNTHETIC-SECRET-MARKER");
    symlinkSync(elsewhere, join(profile, "summaries"));
    const linked = data();
    expect(linked.summaries).toEqual({ state: "absent", items: [], included: 0, of: 0 });
    expect(JSON.stringify(linked)).not.toContain("SYNTHETIC-SECRET-MARKER");
    // and a profile folder that is a link is not entered either
    rmSync(profile, { recursive: true });
    symlinkSync(elsewhere, profile);
    expect(data().profile).toEqual({ state: "absent" });
    rmSync(profile);
    mkdirSync(profile);
  });

  it("never opens the neighbours of the profile: configuration, original documents, flags", () => {
    writeFileSync(join(profile, "candidate_profile.yml"), YAML);
    writeFileSync(join(profile, "jht.config.json"), '{"token":"SYNTHETIC-CONFIG-MARKER"}');
    mkdirSync(join(profile, "sources"));
    writeFileSync(join(profile, "sources", "SYNTHETIC-DOCUMENT-NAME.pdf"), "SYNTHETIC-DOCUMENT-MARKER");
    writeFileSync(join(profile, "ready.flag"), "SYNTHETIC-FLAG-MARKER");
    writeFileSync(join(profile, "welcomed.flag"), "x");
    const text = JSON.stringify(data());
    for (const marker of ["SYNTHETIC-CONFIG-MARKER", "SYNTHETIC-DOCUMENT", "SYNTHETIC-FLAG-MARKER", "jht.config", "sources", "ready.flag"]) {
      expect(text, marker).not.toContain(marker);
    }
  });

  it("cuts the reply to a byte budget by dropping the heaviest summary text first, and says which", () => {
    writeFileSync(join(profile, "candidate_profile.yml"), YAML);
    mkdirSync(join(profile, "summaries"));
    // a CJK character is three bytes on disk and six once serialized: 32 files near the cap overflow the budget
    for (let n = 0; n < 32; n++) {
      const text = "日".repeat(Math.floor(SUMMARY_MAX / 3) - (n % 5));
      writeFileSync(join(profile, "summaries", `s${String(n).padStart(2, "0")}.md`), text);
    }
    const { reply, bytes } = ask();
    expect(bytes).toBeLessThanOrEqual(BUDGET + 1);
    const items = reply.data.summaries.items as any[];
    const dropped = items.filter((item) => item.state === "over_budget");
    expect(dropped.length).toBeGreaterThan(0);
    for (const item of dropped) expect(item).toMatchObject({ text: null, bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(items.filter((item) => item.state === "ok").length + dropped.length).toBe(32);
    // the profile file itself is never the one dropped
    expect(reply.data.profile.state).toBe("ok");
  });

  it("answers only the closed request, and never touches a database", () => {
    expect(ask({ op: "profile", path: "/jht_home/x" }).reply).toEqual({ ok: false, error: "positions_request_invalid" });
    expect(ask({ op: "profile", filters: {} }).reply).toEqual({ ok: false, error: "positions_request_invalid" });
    expect(existsSync(join(profile, "jobs.db"))).toBe(false);
    expect(ask({ op: "profile" }).reply.ok).toBe(true);
  });
});
