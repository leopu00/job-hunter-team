/**
 * B1 (banda/piani/JHT-API-TEST.md), SCOUT and ANALISTA: the same commands
 * their skills give, run by the TUI script of this tree and by the tool the
 * API role gets, on twin databases — then the two compared (helpers/b1-twins).
 * Every difference that is meant is listed here with its reason; anything else
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

/** Every step must have done its work on both sides: a scenario where both fail is two equal, empty databases. */
async function played(t: Parameters<typeof play>[0], steps: Step[]): Promise<void> {
  const answers = await play(t, steps);
  expect(answers.filter((a) => !a.tui || !a.api)).toEqual([]);
}

const SCOUT: Step[] = [
  // position-insert: a complete insert, as the skill writes it.
  ["scout-1", "db_insert.py", "db_insert", [
    "position", "--title", "Backend Developer", "--company", "Acme", "--url", "https://acme.example/jobs/2",
    "--location", "Milan, Italy", "--remote-type", "hybrid", "--source", "greenhouse", "--found-by", "scout-1",
    "--jd-text", "Build APIs.\nWith tests.", "--requirements", "Python, SQL",
    "--salary-declared-min", "40000", "--salary-declared-max", "50000",
  ]],
  // An empty currency: both sides store the default.
  ["scout-1", "db_insert.py", "db_insert", [
    "position", "--title", "SRE", "--company", "Hooli", "--url", "https://hooli.example/sre", "--found-by", "scout-1",
    "--salary-declared-currency", "",
  ]],
  // The scout's own new row, found to be a duplicate: excluded with a note.
  ["scout-1", "db_update.py", "db_update", ["position", "5", "--status", "excluded", "--notes", "duplicate of #1 on another board"]],
];

const ANALISTA: Step[] = [
  // analista.md: the check of a new position, every field its skill fills.
  ["analista-1", "db_update.py", "db_update", [
    "position", "1", "--status", "checked", "--jd-summary", "**Junior SWE** in Milan, hybrid.",
    "--loc-city", "Milano", "--loc-region", "Lombardia", "--loc-country", "Italy", "--loc-country-code", "IT", "--loc-continent", "Europe",
    "--work-mode", "hybrid", "--work-country", "Italy", "--work-country-code", "IT",
    "--salary-estimated-min", "35000", "--salary-estimated-max", "45000", "--salary-estimated-currency", "EUR", "--salary-estimated-source", "manual",
    "--role-family", "Software Engineering", "--is-open", "true", "--last-open-check", "now", "--last-checked", "now", "--expires-at", "2026-12-31",
  ]],
  // office-geocoding, with its maintenance event.
  ["analista-1", "db_update.py", "db_update", [
    "position", "1", "--office-lat", "45.4642", "--office-lon", "9.19", "--office-address", "Via Roma 1, Milano",
    "--office-geocoded", "true", "--office-verified", "true", "--action", "geocode", "--outcome", "updated",
  ]],
  // RULE-08: the company, and the highlights.
  ["analista-1", "db_insert.py", "db_insert", [
    "company", "--name", "Globex", "--website", "https://globex.example", "--hq-country", "DE", "--sector", "retail", "--size", "10k+",
    "--glassdoor-rating", "3.4", "--red-flags", "layoffs 2025", "--culture-notes", "large, slow", "--analyzed-by", "analista-1", "--verdict", "CAUTIOUS",
  ]],
  ["analista-1", "db_insert.py", "db_insert", ["highlight", "--position-id", "1", "--type", "pro", "--text", "Hybrid, two days in the office"]],
  ["analista-1", "db_insert.py", "db_insert", ["highlight", "--position-id", "1", "--type", "con", "--text", "Junior salary band"]],
  // A closed advert.
  ["analista-1", "db_update.py", "db_update", ["position", "2", "--status", "excluded", "--notes", "[SCADUTO] the advert is gone"]],
  // logo-extraction: the company's site, with its event.
  ["analista-1", "db_update.py", "db_update", ["company", "Acme", "--website", "https://www.acme.example", "--action", "website_fetch", "--outcome", "updated"]],
];

describe.skipIf(PYTHON_SKILLS === null)("B1 · SCOUT: the same inserts and updates, the same rows", () => {
  it("writes positions, transitions and its own exclusion as the TUI scripts do", async () => {
    const t = twins(root, pipelineSeed);
    await played(t, SCOUT);
    expect(strictDiff(t)).toEqual([]);
    expect(parityDiff(t)).toEqual({});
  });
});

describe.skipIf(PYTHON_SKILLS === null)("B1 · the same refusals", () => {
  it("skips a duplicate advert on both sides, and writes nothing", async () => {
    const t = twins(root, pipelineSeed);
    const [dup] = await play(t, [["scout-1", "db_insert.py", "db_insert", ["position", "--title", "SWE", "--company", "Acme", "--url", "https://acme.example/jobs/1"]]]);
    expect(dup).toMatchObject({ tui: false, api: false });
    expect(strictDiff(t)).toEqual([]);
  });

  it("B1-T1: fails the same way on both sides to insert a company that positions already point at", async () => {
    // A product defect, not a parity one (B1-parita-ruoli.md, B1-T1): `INSERT OR REPLACE INTO
    // companies` deletes the row positions.company_id points at, and the foreign key refuses it.
    const t = twins(root, pipelineSeed);
    const [company] = await play(t, [["analista-1", "db_insert.py", "db_insert", ["company", "--name", "Acme", "--verdict", "GO"]]]);
    expect(company).toMatchObject({ tui: false, api: false, apiSaid: "Error: FOREIGN KEY constraint failed" });
    expect(strictDiff(t)).toEqual([]);
  });
});

describe.skipIf(PYTHON_SKILLS === null)("B1 · ANALISTA: the same check, geocoding, company and highlights, the same rows", () => {
  it("writes positions, companies, highlights, transitions and maintenance events as the TUI scripts do", async () => {
    const t = twins(root, pipelineSeed);
    await played(t, ANALISTA);
    expect(strictDiff(t)).toEqual([]);
    expect(parityDiff(t)).toEqual({});
  });
});

describe.skipIf(PYTHON_SKILLS === null)("B1 · SCOUT coordination (scout_coord), a difference that is meant", () => {
  it("resets only the caller's split on the API side; the TUI's reset archives every scout's", async () => {
    const t = twins(root, (db) => {
      pipelineSeed(db);
      // A split left by a crashed team: scout-3 is not coming back.
      db.prepare("INSERT INTO scout_coordination (scout, cerchi, fonti, started_at) VALUES (?, ?, ?, ?)").run("scout-3", "3", "lever", "2026-09-27 10:00:00");
    });
    await played(t, [
      ["scout-1", "scout_coord.py", "scout_coord", ["reset"]],
      ["scout-1", "scout_coord.py", "scout_coord", ["assign", "scout-1", "--cerchi", "1,2", "--fonti", "linkedin,greenhouse"]],
    ]);
    // The only difference: the stale split is archived by the TUI reset, and stays live on the API side.
    expect(strictDiff(t).map((d) => d.replace(/"[0-9-]+T?[0-9:. ]+"/g, "<moment>"))).toEqual([
      "scout_coordination#1.superseded_at: TUI <moment> · API null",
    ]);
  });
});
