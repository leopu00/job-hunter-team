/**
 * T33: the Critic's verdict has to reach the person.
 *
 * On the live chain of 21/09 the loop ran to the end and `critiche/` stayed
 * empty: in-process the Critic writes with the Writer's uid, and that folder
 * is refused to it by the deliverables guard (and by the modes on a real
 * box). The review now goes in through a tool whose path the model does not
 * choose, and never replaces an older one — the Writer may still be reading
 * it (critico.md).
 *
 * T34 joined the two halves: with a hub the file is the hub's to write, with
 * its own uid; without one (`npm run role` on a developer's machine) it is
 * written here. Both roads call the SAME `saveReview`, and the tests below
 * pin that down — two spellings of the name would turn `reviewsFor`, which
 * looks for a verdict's review by name, into a generator of false alarms.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { MAX_REVIEW_CHARS, reviewFileName } from "../src/hub/review.ts";
import { createSaveReviewTool } from "../src/parity/skills/review.ts";
import { deliverableWriteGuard } from "../src/parity/deliverables.ts";
import { createWorkspaceTools } from "../src/tools/workspace.ts";

const context = { signal: new AbortController().signal } as never;

let root: string;
let db: Database;

/** One position to judge: its company is what names the file. */
function seed(company: string): void {
  db = openJobsDb(join(root, "jobs.db"));
  db.prepare(
    "INSERT INTO positions (title, company, url, status, found_by) VALUES ('Backend Engineer', ?, 'https://acme.example/1', 'scored', 'scout-1')",
  ).run(company);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-review-"));
  seed("Acme Srl");
});
afterEach(() => {
  db?.close();
  rmSync(root, { recursive: true, force: true });
});

const tool = (day = "2026-09-21") =>
  createSaveReviewTool({ userDir: root, db: () => db, now: () => new Date(`${day}T10:00:00Z`) });

const save = (positionId: number, text: string, day?: string) => {
  const t = tool(day);
  return t.execute(t.spec.schema.parse({ position_id: positionId, text }), context);
};

describe("save_review", () => {
  it("writes the verdict where the person reads it, under the hub's own name", async () => {
    const r = await save(1, "# Blind review\n\nSCORE: 6.5/10\n");
    expect(r.ok).toBe(true);
    const dir = join(root, "critiche");
    // The name is the hub's function, not a second spelling of it.
    const name = reviewFileName("Acme Srl", "2026-09-21");
    expect(readdirSync(dir)).toEqual([name]);
    expect(name).toBe("review-acme-srl-2026-09-21.md");
    expect(readFileSync(join(dir, name), "utf8")).toContain("SCORE: 6.5/10");
    // The answer is the path, which the Critic cites in its [RES].
    expect(r.content).toContain(join(dir, name));
  });

  it("never replaces a review: the three rounds of a day leave three files", async () => {
    for (const score of ["5.0", "6.0", "7.0"]) await save(1, `SCORE: ${score}/10\n`);
    expect(readdirSync(join(root, "critiche")).sort()).toEqual([
      "review-acme-srl-2026-09-21-v2.md",
      "review-acme-srl-2026-09-21-v3.md",
      "review-acme-srl-2026-09-21.md",
    ]);
    // The first round's verdict is still the first round's: the Writer may be reading it.
    expect(readFileSync(join(root, "critiche", "review-acme-srl-2026-09-21.md"), "utf8")).toBe("SCORE: 5.0/10\n");
  });

  it("takes the position and the text, and nothing that could choose a path", async () => {
    const t = tool();
    expect(() => t.spec.schema.parse({ position_id: 1, text: "x", path: "/etc/passwd" })).toThrow();
    expect(() => t.spec.schema.parse({ position_id: -1, text: "x" })).toThrow();
    expect(() => t.spec.schema.parse({ position_id: 1, text: "" })).toThrow();
    // The same ceiling as the hub's, so nothing the tool accepts is refused there.
    expect(() => t.spec.schema.parse({ position_id: 1, text: "x".repeat(MAX_REVIEW_CHARS + 1) })).toThrow();
    const r = await save(1, "no trailing newline");
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, "critiche", "review-acme-srl-2026-09-21.md"), "utf8")).toBe("no trailing newline\n");
  });

  it("a company that reads like a path still names a file inside critiche/", async () => {
    rmSync(join(root, "jobs.db"));
    seed("../../etc");
    const r = await save(1, "SCORE: 4/10\n");
    expect(r.ok).toBe(true);
    expect(readdirSync(join(root, "critiche"))).toEqual(["review-etc-2026-09-21.md"]);
  });

  it("a review of a position that does not exist writes nothing, and says so", async () => {
    const r = await save(99, "SCORE: 9/10\n");
    expect(r.ok).toBe(false);
    expect(r.content).toContain("#99");
    expect(existsSync(join(root, "critiche", "review-acme-srl-2026-09-21.md"))).toBe(false);
  });

  it("with a hub the file is the hub's to write, and the refusal reaches the model", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const hub = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        if ((body as { position_id: number }).position_id === 99) return { ok: false, error: "position 99 does not exist" };
        return { ok: true, path: "/jht_out/critiche/review-acme-2026-09-21.md" };
      },
    } as never;
    const withHub = createSaveReviewTool({ userDir: root, db: () => db, hub, now: () => new Date("2026-09-21T10:00:00Z") });
    const ok = await withHub.execute(withHub.spec.schema.parse({ position_id: 1, text: "SCORE: 6/10" }), context);
    expect(ok.ok).toBe(true);
    expect(ok.content).toContain("/jht_out/critiche/review-acme-2026-09-21.md");
    expect(calls).toEqual([{ path: "/v1/review", body: { position_id: 1, text: "SCORE: 6/10\n" } }]);
    // Nothing is written here: the hub has the uid the Writer must not have.
    expect(existsSync(join(root, "critiche"))).toBe(false);
    const refused = await withHub.execute(withHub.spec.schema.parse({ position_id: 99, text: "x" }), context);
    expect(refused.ok).toBe(false);
    expect(refused.content).toContain("position 99 does not exist");
  });

  it("says why when the verdict cannot be saved, instead of losing it", async () => {
    const locked = createSaveReviewTool({
      userDir: join(root, "nope", "\0bad"),
      db: () => db,
      now: () => new Date("2026-09-21T10:00:00Z"),
    });
    const r = await locked.execute(locked.spec.schema.parse({ position_id: 1, text: "x" }), context);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/was not saved|could not be saved/);
    const broken = createSaveReviewTool({
      userDir: root,
      db: () => db,
      hub: { post: async () => { throw new Error("hub unreachable"); } } as never,
    });
    const r2 = await broken.execute(broken.spec.schema.parse({ position_id: 1, text: "x" }), context);
    expect(r2.ok).toBe(false);
    expect(r2.content).toContain("hub unreachable");
  });

  it("is the only way in: the file tools still refuse that folder to the Writer", async () => {
    const workdir = join(root, "home");
    mkdirSync(workdir, { recursive: true });
    const guarded = deliverableWriteGuard(createWorkspaceTools({ workdir, ownRoots: [workdir, root] }), {
      userDir: root,
      agent: "scrittore-1",
      workdir,
    });
    const write = guarded.find((t) => t.spec.name === "write_file")!;
    const r = await write.execute(
      write.spec.schema.parse({ path: join(root, "critiche", "review-by-hand.md"), content: "x" }),
      context,
    );
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/critiche\/ is the CRITICO's to write/);
  });
});
