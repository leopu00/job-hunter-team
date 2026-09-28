/**
 * B1 (banda/piani/JHT-API-TEST.md), CAPITANO and CLOSER, and the ANALISTA's
 * tickets and taxonomy: the same commands their prompts give, run by the TUI
 * script of this tree and by the tool the API role gets, on twin databases,
 * and the two compared (helpers/b1-twins). What only one side can write (the
 * CLOSER's send, the CAPITANO's CV rework) is in banda/piani/B1-parita-ruoli.md.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/db/jobs-db.ts";
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

/** The pipeline, plus the queue of the person's tickets and the taxonomy's registry. */
function seed(db: Database): void {
  pipelineSeed(db);
  const t = "INSERT INTO position_tickets (position_id, request_text, kind, status, assigned_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)";
  db.prepare(t).run(1, "Is this still open?", "custom", "open", null, "2026-09-27 20:00:00");
  db.prepare(t).run(3, "Check the company", "custom", "open", null, "2026-09-27 21:00:00");
  db.prepare("UPDATE positions SET role_family = 'Other', role_family_proposed = 'Platform' WHERE id IN (3, 4)").run();
  const f = "INSERT INTO role_family_registry (user_id, name, status, support_count, promoted_at) VALUES (?, ?, ?, ?, ?)";
  db.prepare(f).run("local", "Backend", "active", 2, "2026-09-01 10:00:00");
  db.prepare(f).run("local", "Server Side", "active", 1, "2026-09-02 10:00:00");
  db.prepare("UPDATE positions SET role_family = 'Server Side' WHERE id = 1").run();
}

const CAPITANO: Step[] = [
  // C-15: the oldest open ticket first, to the agent that does the work.
  ["capitano-1", "ticket.py", "ticket", ["list-open"]],
  ["capitano-1", "ticket.py", "ticket", ["assign", "1", "analista-1"]],
  // C-17: the arbiter merges two families.
  ["capitano-1", "role_registry.py", "role_registry", ["merge", "--into", "Backend", "--sources", "Server Side"]],
];

const ANALISTA_QUEUE: Step[] = [
  ["capitano-1", "ticket.py", "ticket", ["assign", "1", "analista-1"]],
  // The assigned agent works the ticket and answers it; the answer is the person's.
  ["analista-1", "ticket.py", "ticket", ["touch", "1"]],
  ["analista-1", "ticket.py", "ticket", ["resolve", "1", "--response", "Still open: the careers page lists it today."]],
  // A family promoted from a cluster in Other.
  ["analista-1", "role_registry.py", "role_registry", ["promote", "--name", "Platform", "--ids", "3,4"]],
];

const CLOSER: Step[] = [
  // CL-08: an answer worked out from the profile.
  ["closer-1", "application_answers.py", "application_answers", [
    "save", "--key", "notice_period", "--value", "1 month", "--field-type", "text", "--basis", "profile", "--position-id", "4",
  ]],
  ["closer-1", "application_answers.py", "application_answers", [
    "save", "--key", "work_authorization", "--value", "Yes", "--field-type", "select", "--options", "Yes", "No", "--basis", "profile",
  ]],
];

describe.skipIf(PYTHON_SKILLS === null)("B1 · CAPITANO: the ticket queue and the taxonomy, the same rows", () => {
  it("assigns the oldest ticket and merges two families as the TUI scripts do", async () => {
    const t = twins(root, seed);
    expect(failed(await play(t, CAPITANO))).toEqual([]);
    expect(strictDiff(t)).toEqual([]);
    expect(parityDiff(t)).toEqual({});
  });
});

describe.skipIf(PYTHON_SKILLS === null)("B1 · ANALISTA: a ticket worked and a family promoted, the same rows", () => {
  it("touches and resolves its ticket and promotes a family as the TUI scripts do", async () => {
    const t = twins(root, seed);
    expect(failed(await play(t, ANALISTA_QUEUE))).toEqual([]);
    expect(strictDiff(t)).toEqual([]);
    expect(parityDiff(t)).toEqual({});
  });
});

describe.skipIf(PYTHON_SKILLS === null)("B1 · CLOSER: the answers it works out, the same rows", () => {
  it("saves its answers as the TUI script does", async () => {
    const t = twins(root, seed);
    expect(failed(await play(t, CLOSER))).toEqual([]);
    expect(strictDiff(t)).toEqual([]);
    expect(parityDiff(t)).toEqual({});
  });
});
