/**
 * B1 (banda/piani/JHT-API-TEST.md), SCORER and SCRITTORE: the same commands
 * their skills give, run by the TUI script of this tree and by the tool the
 * API role gets, on twin databases, and the two compared (helpers/b1-twins).
 * A difference that is meant is written here with its reason; anything else
 * is red. The table of all roles is banda/piani/B1-parita-ruoli.md.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parityDiff, pipelineSeed, play, PYTHON_SKILLS, strictDiff, twins, type Step } from "./helpers/b1-twins.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-b1-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The steps that did not do their work on both sides: a scenario where both fail is two equal, empty databases. */
const failed = (answers: Awaited<ReturnType<typeof play>>) => answers.filter((a) => !a.tui || !a.api);

const SCORER: Step[] = [
  // scorer.md: the link checked first, then the score, then the status.
  ["scorer-1", "db_update.py", "db_update", ["position", "3", "--last-checked", "now"]],
  ["scorer-1", "db_insert.py", "db_insert", [
    "score", "--position-id", "3", "--total", "82", "--stack-match", "35", "--remote-fit", "22", "--salary-fit", "10",
    "--experience-fit", "8", "--strategic-fit", "7", "--breakdown", "Go and APIs: strong match.", "--pros", "remote EU",
    "--cons", "no salary", "--notes", "**Good fit**: remote, Go.", "--scored-by", "scorer-1",
  ]],
  ["scorer-1", "db_update.py", "db_update", ["position", "3", "--status", "scored"]],
];

const SCRITTORE: Step[] = [
  // application-flow: writing, the application row, the PDFs, the critic's rounds, ready.
  ["scrittore-1", "db_update.py", "db_update", ["position", "4", "--status", "writing"]],
  ["scrittore-1", "db_insert.py", "db_insert", [
    "application", "--position-id", "4", "--cv-path", "/jht_out/cv/umbrella-cv.md", "--cl-path", "/jht_out/cv/umbrella-cl.md", "--written-by", "scrittore-1",
  ]],
  ["scrittore-1", "db_update.py", "db_update", ["application", "4", "--cv-pdf-path", "/jht_out/cv/umbrella-cv.pdf", "--cl-pdf-path", "/jht_out/cv/umbrella-cl.pdf"]],
  ["scrittore-1", "db_update.py", "db_update", [
    "application", "4", "--critic-verdict", "NEEDS_WORK", "--critic-score", "6.5", "--critic-round", "1",
    "--critic-notes", "**Too generic** in the summary.", "--reviewed-by", "critico-1",
  ]],
  ["scrittore-1", "db_update.py", "db_update", [
    "application", "4", "--critic-verdict", "PASS", "--critic-score", "8.2", "--critic-round", "2",
    "--critic-notes", "**Ready**: specific and short.", "--reviewed-by", "critico-1", "--status", "ready",
  ]],
  ["scrittore-1", "db_update.py", "db_update", ["position", "4", "--status", "ready"]],
];

describe.skipIf(PYTHON_SKILLS === null)("B1 · SCORER: the same check, score and status, the same rows", () => {
  it("writes the score, the position's status and its transition as the TUI scripts do", async () => {
    const t = twins(root, pipelineSeed);
    expect(failed(await play(t, SCORER))).toEqual([]);
    expect(strictDiff(t)).toEqual([]);
    expect(parityDiff(t)).toEqual({});
  });
});

describe.skipIf(PYTHON_SKILLS === null)("B1 · SCRITTORE: the same application, rounds and statuses, the same rows", () => {
  it("writes the application, the critic's rounds and the position's statuses as the TUI scripts do", async () => {
    const t = twins(root, pipelineSeed);
    expect(failed(await play(t, SCRITTORE))).toEqual([]);
    expect(strictDiff(t)).toEqual([]);
    expect(parityDiff(t)).toEqual({});
  });
});

describe.skipIf(PYTHON_SKILLS === null)("B1 · SCRITTORE, a difference that is meant (B1-T5)", () => {
  it("replaces an existing application on the TUI side, and refuses on the API side", async () => {
    const t = twins(root, pipelineSeed);
    expect(failed(await play(t, SCRITTORE))).toEqual([]);
    const [again] = await play(t, [
      ["scrittore-1", "db_insert.py", "db_insert", ["application", "--position-id", "4", "--cv-path", "/jht_out/cv/umbrella-cv-v2.md", "--written-by", "scrittore-1"]],
    ]);
    expect(again).toMatchObject({ tui: true, api: false });
    // INSERT OR REPLACE drops the row and writes a new one: the critic's rounds and the PDFs
    // go with it on the TUI side. The API keeps the application as it was.
    const columns = new Set(strictDiff(t).filter((d) => d.startsWith("applications#")).map((d) => d.split(":")[0]!.split(".")[1]));
    expect([...columns]).toEqual(expect.arrayContaining(["cv_path", "cv_pdf_path", "critic_verdict", "critic_score"]));
  });
});
