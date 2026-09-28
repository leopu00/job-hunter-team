/**
 * B1-T2 (banda/piani/B1-parita-ruoli.md): the SCORER scores a position again
 * on the person's request.
 *
 * In the TUI a rescore ticket goes to a SCORER (capitano.md C-15,
 * [RESCORE-TICKET]), which saves with `db_insert score --action rescore` on a
 * position already past its queue and resolves the ticket once the score is
 * newer than the request. The API SCORER could do none of it: `--action` was
 * refused, it had no `ticket` tool, and a score was taken only on a `checked`
 * position. A "score it again" of the person found no one in the API team.
 *
 * The flow on twin databases, the TUI scripts of this tree against the tools
 * the API roles get (helpers/b1-twins). Narrower than the script on purpose,
 * and fixed here: the API takes a rescore only on a rescore ticket assigned
 * to the SCORER that writes it, where the script takes it from anyone.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { api, parityDiff, pipelineSeed, play, PYTHON_SKILLS, strictDiff, twins, type Step } from "./helpers/b1-twins.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-b1-rescore-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The steps that did not do their work on both sides: a scenario where both fail is two equal, empty databases. */
const failed = (answers: Awaited<ReturnType<typeof play>>) => answers.filter((a) => !a.tui || !a.api);

/** The pipeline, and the person's request to score position 4 (already `scored`, 78) again. */
function seed(db: Database): void {
  pipelineSeed(db);
  db.prepare("INSERT INTO position_tickets (position_id, request_text, kind, status, created_at) VALUES (?, ?, ?, ?, ?)").run(
    4,
    "Rivaluta: ho aggiunto Kubernetes al profilo.",
    "rescore",
    "open",
    "2026-09-27 20:00:00",
  );
}

const SCORE = [
  "score", "--position-id", "4", "--total", "84", "--stack-match", "36", "--remote-fit", "20", "--salary-fit", "10",
  "--experience-fit", "10", "--strategic-fit", "8", "--breakdown", "Kubernetes now in the profile.", "--scored-by", "scorer-1",
];

const RESCORE: Step[] = [
  // C-15: a rescore ticket always goes to a Scorer.
  ["capitano-1", "ticket.py", "ticket", ["assign", "1", "scorer-1"]],
  ["scorer-1", "ticket.py", "ticket", ["touch", "1"]],
  ["scorer-1", "db_insert.py", "db_insert", [...SCORE, "--action", "rescore"]],
  // The same score again: the history says nothing moved, and it is said.
  ["scorer-1", "db_insert.py", "db_insert", [...SCORE, "--action", "rescore"]],
  // Resolved only once scores.scored_at is newer than the request.
  ["scorer-1", "ticket.py", "ticket", ["resolve", "1", "--response", "Nuovo punteggio 84/100: Kubernetes ora conta."]],
];

describe.skipIf(PYTHON_SKILLS === null)("B1-T2 · SCORER: a rescore on the person's ticket, the same rows", () => {
  it("rescores a scored position, records the change and resolves the ticket as the TUI scripts do", async () => {
    const t = twins(root, seed);
    const answers = await play(t, RESCORE);
    expect(failed(answers)).toEqual([]);
    expect(answers[3]!.apiSaid).toBe("Score unchanged for position 4: 84/100 (no fields changed)");
    expect(strictDiff(t)).toEqual([]);
    expect(parityDiff(t)).toEqual({});

    // Not two equal, empty histories: the score moved, the change is recorded, the ticket is closed.
    const db = openJobsDb(t.api);
    try {
      expect(db.prepare("SELECT total_score, scored_by FROM scores WHERE position_id = 4").get()).toEqual({ total_score: 84, scored_by: "scorer-1" });
      expect(db.prepare("SELECT field, before, after, outcome FROM maintenance_events WHERE action = 'rescore' ORDER BY id").all()).toEqual([
        { field: "total_score", before: "78", after: "84", outcome: "updated" },
        { field: "stack_match", before: null, after: "36", outcome: "updated" },
        { field: "remote_fit", before: null, after: "20", outcome: "updated" },
        { field: "salary_fit", before: null, after: "10", outcome: "updated" },
        { field: "experience_fit", before: null, after: "10", outcome: "updated" },
        { field: "strategic_fit", before: null, after: "8", outcome: "updated" },
        { field: "breakdown", before: null, after: "Kubernetes now in the profile.", outcome: "updated" },
        { field: null, before: null, after: null, outcome: "unchanged" },
      ]);
      expect(db.prepare("SELECT status FROM position_tickets WHERE id = 1").get()).toEqual({ status: "resolved" });
    } finally {
      db.close();
    }
  });
});

describe.skipIf(PYTHON_SKILLS === null)("B1-T2 · the API SCORER rescores only on its own rescore ticket", () => {
  it("refuses a rescore with no ticket, on another scorer's ticket, and any other maintenance action", async () => {
    const t = twins(root, seed);
    // No ticket assigned yet: the person asked, the Capitano has not given it to this SCORER.
    const unassigned = await api(t, "scorer-1", "db_insert", [...SCORE, "--action", "rescore"]);
    expect(unassigned).toMatchObject({ ok: false, content: expect.stringContaining("no rescore ticket assigned to you") });
    expect((await api(t, "capitano-1", "ticket", ["assign", "1", "scorer-2"])).ok).toBe(true);
    const others = await api(t, "scorer-1", "db_insert", [...SCORE, "--action", "rescore"]);
    expect(others).toMatchObject({ ok: false, content: expect.stringContaining("no rescore ticket assigned to you") });
    const liveness = await api(t, "scorer-2", "db_insert", [...SCORE, "--action", "liveness_check"]);
    expect(liveness).toMatchObject({ ok: false, content: expect.stringContaining("only `rescore`") });
    // Without --action a scored position is still not the SCORER's to write.
    const plain = await api(t, "scorer-2", "db_insert", SCORE);
    expect(plain).toMatchObject({ ok: false, content: expect.stringContaining("is 'scored', not 'checked'") });

    const db = openJobsDb(t.api);
    try {
      expect(db.prepare("SELECT total_score FROM scores WHERE position_id = 4").get()).toEqual({ total_score: 78 });
      expect(db.prepare("SELECT count(*) AS n FROM maintenance_events").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
    // The SCORER the ticket is assigned to does it.
    expect(await api(t, "scorer-2", "db_insert", [...SCORE, "--action", "rescore"])).toMatchObject({ ok: true });
  });
});

describe.skipIf(PYTHON_SKILLS === null)("B1-T2 · the rescore ticket must be assigned, and a rescore one", () => {
  // Revisione incrociata del 28/09 (charles): with `AND status = 'assigned'` or `kind = 'rescore'`
  // taken out of the rescore's WHERE, the tests above stayed green.
  it("refuses a rescore on this SCORER's ticket once it is resolved", async () => {
    const t = twins(root, (db) => {
      seed(db);
      db.prepare("UPDATE position_tickets SET status = 'resolved', assigned_agent = 'scorer-1' WHERE id = 1").run();
    });
    const again = await api(t, "scorer-1", "db_insert", [...SCORE, "--action", "rescore"]);
    expect(again).toMatchObject({ ok: false, content: expect.stringContaining("no rescore ticket assigned to you") });
  });

  it("refuses a rescore on a ticket of another kind assigned to this SCORER", async () => {
    const t = twins(root, (db) => {
      seed(db);
      db.prepare("UPDATE position_tickets SET kind = 'custom', status = 'assigned', assigned_agent = 'scorer-1' WHERE id = 1").run();
    });
    const custom = await api(t, "scorer-1", "db_insert", [...SCORE, "--action", "rescore"]);
    expect(custom).toMatchObject({ ok: false, content: expect.stringContaining("no rescore ticket assigned to you") });
  });
});

const LOW = [
  "score", "--position-id", "4", "--total", "35", "--stack-match", "10", "--remote-fit", "10", "--salary-fit", "5",
  "--experience-fit", "5", "--strategic-fit", "5", "--breakdown", "The salary is now far below target.", "--scored-by", "scorer-1",
];

describe.skipIf(PYTHON_SKILLS === null)("B1-T2 · after a rescore the SCORER applies RULE-04 again", () => {
  it("moves a scored position that falls under 40 to excluded, as the TUI Scorer does", async () => {
    const t = twins(root, seed);
    const answers = await play(t, [
      ["capitano-1", "ticket.py", "ticket", ["assign", "1", "scorer-1"]],
      ["scorer-1", "db_insert.py", "db_insert", [...LOW, "--action", "rescore"]],
      ["scorer-1", "db_update.py", "db_update", ["position", "4", "--status", "excluded", "--notes", "EXCLUDED: [SALARY] far below target after the rescore"]],
      ["scorer-1", "ticket.py", "ticket", ["resolve", "1", "--response", "Nuovo punteggio 35/100: esclusa."]],
    ]);
    expect(failed(answers)).toEqual([]);
    expect(strictDiff(t)).toEqual([]);
    const db = openJobsDb(t.api);
    try {
      expect(db.prepare("SELECT status FROM positions WHERE id = 4").get()).toEqual({ status: "excluded" });
    } finally {
      db.close();
    }
  });

  it("moves an excluded position that rises to 84 back to scored, so the person sees it", async () => {
    const t = twins(root, (db) => {
      seed(db);
      db.prepare("UPDATE positions SET status = 'excluded' WHERE id = 4").run();
    });
    const answers = await play(t, [
      ["capitano-1", "ticket.py", "ticket", ["assign", "1", "scorer-1"]],
      ["scorer-1", "db_insert.py", "db_insert", [...SCORE, "--action", "rescore"]],
      ["scorer-1", "db_update.py", "db_update", ["position", "4", "--status", "scored"]],
      ["scorer-1", "ticket.py", "ticket", ["resolve", "1", "--response", "Nuovo punteggio 84/100."]],
    ]);
    expect(failed(answers)).toEqual([]);
    expect(strictDiff(t)).toEqual([]);
  });

  it("moves nothing without its assigned rescore ticket, nor once the ticket is resolved", async () => {
    const t = twins(root, seed);
    // No ticket assigned to this SCORER: a scored position is not its to move (the TUI script would).
    const before = await api(t, "scorer-1", "db_update", ["position", "4", "--status", "excluded"]);
    expect(before).toMatchObject({ ok: false });
    expect((await api(t, "capitano-1", "ticket", ["assign", "1", "scorer-1"])).ok).toBe(true);
    expect((await api(t, "scorer-1", "db_insert", [...LOW, "--action", "rescore"])).ok).toBe(true);
    expect((await api(t, "scorer-1", "ticket", ["resolve", "1", "--response", "35/100."])).ok).toBe(true);
    // Resolved: the move closes with the ticket.
    const after = await api(t, "scorer-1", "db_update", ["position", "4", "--status", "excluded"]);
    expect(after).toMatchObject({ ok: false });
    // Nothing moved: the rescored position is still where the first score put it.
    const db = openJobsDb(t.api);
    try {
      expect(db.prepare("SELECT status FROM positions WHERE id = 4").get()).toEqual({ status: "scored" });
    } finally {
      db.close();
    }
  });
});
