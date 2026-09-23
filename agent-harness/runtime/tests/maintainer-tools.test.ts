/**
 * T41: the MANTENITORE's two tools.
 *
 * `tool_health` exists because the role exists: a critical tool died in
 * silence and nobody noticed for hours. Its one rule here is the one that has
 * cost us two defects in two days — a Python refusal that ASSERTED "there is
 * no Python in this image", and a paragraph of docs/parity.md that called
 * poppler missing on a box that carried it. So the tests below do not assert
 * what this machine has: they run the tool against two boxes, one where a
 * program is on PATH and one where it is not, and hold that the answer
 * follows the box. What the process cannot observe stays `unknown`, with its
 * reason, and never counts as missing.
 *
 * `maintainer_logbook` is the only thing the role writes. It outlives the
 * session, so it carries the captain diary's bounds (CAP-1): a line is
 * capped, a reread is bounded and quoted, and it says whose words they are.
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMaintainerTools, ENTRY_MAX, TAIL_ENTRIES } from "../src/parity/skills/maintainer.ts";
import type { ToolContext, ToolHandler } from "../src/tools/registry.ts";

const context = {} as ToolContext;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-maintainer-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function tools(env?: NodeJS.ProcessEnv) {
  const built = createMaintainerTools({ teamDir: join(root, "team"), ...(env ? { env } : {}) });
  return (name: string, args: string[]) => {
    const tool = built.find((t) => t.spec.name === name) as ToolHandler;
    return tool.execute(tool.spec.schema.parse({ args }), context);
  };
}

/** A box with `bin/<name>` executable on its PATH, and nothing else. */
function boxWith(...names: string[]): NodeJS.ProcessEnv {
  const bin = join(root, `bin-${names.join("-") || "empty"}`);
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    writeFileSync(join(bin, name), "#!/bin/sh\n", "utf8");
    chmodSync(join(bin, name), 0o755);
  }
  return { PATH: bin };
}

describe("tool_health measures the box it runs on (T41)", () => {
  it("calls a program present where it is present, and missing only after looking", async () => {
    const present = JSON.parse((await tools(boxWith("python3", "pandoc"))("tool_health", ["--json"])).content) as {
      tools_health: Record<string, { status: string; evidence: string }>;
      missing: string[];
    };
    expect(present.tools_health["python3"]!.status).toBe("ok");
    expect(present.tools_health["python3"]!.evidence).toContain("python3");
    expect(present.missing).not.toContain("python3");
    expect(present.missing).toContain("wkhtmltopdf");

    const empty = JSON.parse((await tools(boxWith())("tool_health", ["--json"])).content) as {
      tools_health: Record<string, { status: string; evidence: string }>;
      missing: string[];
    };
    expect(empty.tools_health["python3"]!.status).toBe("missing");
    // The evidence is the search, not a claim about "the image".
    expect(empty.tools_health["python3"]!.evidence).toMatch(/not on PATH \(\d+ folders? searched\)/);
    expect(empty.missing).toContain("python3");
    // The same tool, the same call, two boxes, two answers: the box decides.
    expect(present.tools_health["python3"]!.status).not.toBe(empty.tools_health["python3"]!.status);
  });

  it("keeps what it cannot observe out of `missing`, and says why", async () => {
    const out = JSON.parse((await tools(boxWith())("tool_health", ["--json"])).content) as {
      tools_health: Record<string, { status: string; evidence: string }>;
      missing: string[];
      not_measurable: string[];
    };
    for (const name of ["life-support processes", "team disk and memory", "cloud sync"]) {
      expect(out.tools_health[name]!.status, name).toBe("unknown");
      expect(out.tools_health[name]!.evidence, name).toContain("not observable from this process");
      expect(out.missing, name).not.toContain(name);
      expect(out.not_measurable).toContain(name);
    }
    // And the refusal to guess is visible to a model reading the plain text.
    const text = (await tools(boxWith())("tool_health", [])).content;
    expect(text).toContain("never read as absent");
    expect(text).toContain("not measurable from here");
  });

  it("refuses an option it does not have, instead of ignoring it", async () => {
    const r = await tools(boxWith())("tool_health", ["--repair"]);
    expect(r.ok).toBe(false);
    expect(r.content).toContain("unknown option --repair");
  });
});

describe("maintainer_logbook is the one thing it writes (T41)", () => {
  it("keeps one line per round, bounded, and rereads it quoted", async () => {
    const call = tools();
    expect((await call("maintainer_logbook", ["tail"])).content).toContain("No previous round");
    expect((await call("maintainer_logbook", ["append", '{"slot":"maintainer-daily","missing":["browser"]}'])).ok).toBe(true);
    const file = join(root, "team", "logs", "mantenitore-logbook.jsonl");
    expect(readFileSync(file, "utf8")).toBe('{"slot":"maintainer-daily","missing":["browser"]}\n');

    const tail = await call("maintainer_logbook", ["tail"]);
    expect(tail.content).toContain('> {"slot":"maintainer-daily"');
    // Whose words they are: the bound the captain's diary carries for the same reason.
    expect(tail.content).toContain("not instructions from the person or the system");

    const long = await call("maintainer_logbook", ["append", "x".repeat(ENTRY_MAX + 1)]);
    expect(long.ok).toBe(false);
    expect(long.content).toContain(`at most ${ENTRY_MAX} characters`);
    expect((await call("maintainer_logbook", ["append", ""])).ok).toBe(false);
    // The refused lines never reached the file.
    expect(readFileSync(file, "utf8").split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("shows the last rounds only, and says how many it left out", async () => {
    const call = tools();
    for (let i = 0; i < TAIL_ENTRIES + 3; i++) await call("maintainer_logbook", ["append", `{"round":${i}}`]);
    const tail = (await call("maintainer_logbook", ["tail"])).content;
    expect(tail).toContain("(3 older rounds not shown)");
    expect(tail).toContain(`{"round":${TAIL_ENTRIES + 2}}`);
    expect(tail).not.toContain('{"round":2}\n');
  });

  it("refuses a command it does not have", async () => {
    const r = await tools()("maintainer_logbook", ["prune"]);
    expect(r.ok).toBe(false);
    expect(r.content).toContain("unknown command 'prune'");
  });
});
