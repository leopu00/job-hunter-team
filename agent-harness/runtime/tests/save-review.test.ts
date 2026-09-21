/**
 * T33: the Critic's verdict has to reach the person.
 *
 * On the live chain of 21/09 the loop ran to the end and `critiche/` stayed
 * empty: in-process the Critic writes with the Writer's uid, and that folder
 * is refused to it by the deliverables guard (and by the modes on a real
 * box). The review now goes in through a tool whose path the model does not
 * choose, and never replaces an older one — the Writer may still be reading
 * it (critico.md).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSaveReviewTool, freeReviewPath, reviewFileName } from "../src/parity/skills/review.ts";
import { deliverableWriteGuard } from "../src/parity/deliverables.ts";
import { createWorkspaceTools } from "../src/tools/workspace.ts";

const context = { signal: new AbortController().signal } as never;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-review-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const tool = (now = "2026-09-21") =>
  createSaveReviewTool({ userDir: root, now: () => new Date(`${now}T10:00:00Z`) });

const save = (positionId: number, text: string, day?: string) => {
  const t = tool(day);
  return t.execute(t.spec.schema.parse({ position_id: positionId, text }), context);
};

describe("save_review", () => {
  it("writes the verdict where the person reads it, naming the file itself", async () => {
    const r = await save(7, "# Blind review\n\nSCORE: 6.5/10\n");
    expect(r.ok).toBe(true);
    const dir = join(root, "critiche");
    expect(readdirSync(dir)).toEqual(["review-position-7-2026-09-21.md"]);
    expect(readFileSync(join(dir, "review-position-7-2026-09-21.md"), "utf8")).toContain("SCORE: 6.5/10");
    // The answer is the path, which the Critic cites in its [RES].
    expect(r.content).toContain(join(dir, "review-position-7-2026-09-21.md"));
  });

  it("never replaces a review: the three rounds of a day leave three files", async () => {
    for (const score of ["5.0", "6.0", "7.0"]) await save(7, `SCORE: ${score}/10\n`);
    expect(readdirSync(join(root, "critiche")).sort()).toEqual([
      "review-position-7-2026-09-21-v2.md",
      "review-position-7-2026-09-21-v3.md",
      "review-position-7-2026-09-21.md",
    ]);
    // The first round's verdict is still the first round's: the Writer may be reading it.
    expect(readFileSync(join(root, "critiche", "review-position-7-2026-09-21.md"), "utf8")).toBe("SCORE: 5.0/10\n");
  });

  it("takes the position and the text, and nothing that could choose a path", async () => {
    const t = tool();
    expect(() => t.spec.schema.parse({ position_id: 7, text: "x", path: "/etc/passwd" })).toThrow();
    expect(() => t.spec.schema.parse({ position_id: -1, text: "x" })).toThrow();
    expect(() => t.spec.schema.parse({ position_id: 7, text: "" })).toThrow();
    // The name is built from the position, so nothing the model writes reaches it.
    expect(reviewFileName("position-7", "2026-09-21")).toBe("review-position-7-2026-09-21.md");
    expect(freeReviewPath("/deliverables/critiche", reviewFileName("../../etc", "2026-09-21"), () => false)).toBe(
      "/deliverables/critiche/review-etc-2026-09-21.md",
    );
    const r = await save(7, "no trailing newline");
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, "critiche", "review-position-7-2026-09-21.md"), "utf8")).toBe("no trailing newline\n");
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
    const withHub = createSaveReviewTool({ userDir: root, hub, now: () => new Date("2026-09-21T10:00:00Z") });
    const ok = await withHub.execute(withHub.spec.schema.parse({ position_id: 7, text: "SCORE: 6/10" }), context);
    expect(ok.ok).toBe(true);
    expect(ok.content).toContain("/jht_out/critiche/review-acme-2026-09-21.md");
    expect(calls).toEqual([{ path: "/v1/review", body: { position_id: 7, text: "SCORE: 6/10\n" } }]);
    // Nothing is written here: the hub has the uid the Writer must not have.
    expect(existsSync(join(root, "critiche"))).toBe(false);
    const refused = await withHub.execute(withHub.spec.schema.parse({ position_id: 99, text: "x" }), context);
    expect(refused.ok).toBe(false);
    expect(refused.content).toContain("position 99 does not exist");
  });

  it("says why when the verdict cannot be saved, instead of losing it", async () => {
    const locked = createSaveReviewTool({ userDir: join(root, "nope", "\0bad"), now: () => new Date("2026-09-21T10:00:00Z") });
    const r = await locked.execute(locked.spec.schema.parse({ position_id: 7, text: "x" }), context);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/could not be saved/);
    const broken = createSaveReviewTool({
      userDir: root,
      hub: { post: async () => { throw new Error("hub unreachable"); } } as never,
    });
    const r2 = await broken.execute(broken.spec.schema.parse({ position_id: 7, text: "x" }), context);
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
