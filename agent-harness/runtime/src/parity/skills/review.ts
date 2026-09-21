/**
 * Where the Critic's verdict lands (T33).
 *
 * In the TUI the CRITICO is a one-shot agent with its own session, its own
 * uid, and `critiche/` is its folder to write. In the harness the review loop
 * runs in-process: the Critic is a one-shot SUBAGENT owned by the SCRITTORE,
 * with the Writer's prompt-and-skills replaced by the Critic's, and the
 * Writer's uid. That is the parity difference COORD accepted, and it has a
 * cost written in docs/parity.md: the two folders are separated by ownership
 * on disk, and in-process that separation is one process wide.
 *
 * On the live chain of 21/09 the loop ran to the end — CV, PDF, verdict
 * NEEDS_WORK 7.2 — and `critiche/` stayed EMPTY: the review existed only in
 * the trace, because the prompt says to save it with the file tools and those
 * refuse that folder to the Writer. A verdict nobody can read is not a
 * verdict, so it goes in through here.
 *
 * Who writes the file: with a hub, the **hub** does (T34), which has a uid of
 * its own — the Writer must not be able to rewrite the review of its own CV,
 * and in-process it would, since the kernel sees one user. The role side
 * carries no name and no path: it posts the position and the text, and the
 * hub reads the company from the row and answers with the path, which the
 * Critic then cites as its skill promises. Without a hub (`npm run role` on a
 * developer's machine) there is no second uid to protect anything from, and
 * the file is written here, with the same naming.
 *
 * A review never overwrites the one before it (critico.md forbids it: the
 * Writer may still be reading it), which is why the three rounds of one day
 * leave three files.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { HubClient } from "../../hub/client.ts";
import { HUB_PATHS } from "../../hub/protocol.ts";
import type { ToolHandler } from "../../tools/registry.ts";

export interface ReviewToolOptions {
  /** The deliverables folder: the review goes in its `critiche/`. */
  userDir: string;
  /** With a hub, the review is written there, by a user of its own (T34). */
  hub?: HubClient | undefined;
  /** Test seam: the day the file is named after. */
  now?: () => Date;
}

const MAX_REVIEW_CHARS = 40_000;

const schema = z
  .object({
    position_id: z.number().int().positive(),
    text: z.string().min(1).max(MAX_REVIEW_CHARS),
  })
  .strict();

/** `review-<company>-<date>.md`, as blind-review names it: lowercase, no spaces, no path. */
export function reviewFileName(company: string, day: string): string {
  const slug = company
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `review-${slug || "azienda"}-${day}.md`;
}

/** The first free name: `-v2`, `-v3`… A review never replaces the one the Writer may be reading. */
export function freeReviewPath(dir: string, name: string, exists = existsSync): string {
  const base = name.replace(/\.md$/, "");
  let candidate = join(dir, name);
  for (let version = 2; exists(candidate); version++) {
    candidate = join(dir, `${base}-v${version}.md`);
  }
  return candidate;
}

export function createSaveReviewTool(options: ReviewToolOptions): ToolHandler {
  const day = () => (options.now?.() ?? new Date()).toISOString().slice(0, 10);
  return {
    spec: {
      name: "save_review",
        description:
        "Save the blind review where the person reads it (critiche/). Give the position it judges and the review " +
        "text; the file name is the harness's, a new review never overwrites an older one, and the answer is the " +
        "path to cite in your [RES].",
      schema,
    },
    classify: (args) => {
      const a = args as z.infer<typeof schema>;
      return { risk: "write", paths: [join(options.userDir, "critiche")], summary: `position ${a.position_id}` };
    },
    async execute(args) {
      const a = args as z.infer<typeof schema>;
      const text = a.text.endsWith("\n") ? a.text : `${a.text}\n`;
      if (options.hub) {
        try {
          const answer = await options.hub.post<{ ok?: boolean; path?: string; error?: string }>(HUB_PATHS.review, {
            position_id: a.position_id,
            text,
          });
          if (answer.ok === false || !answer.path) {
            return { ok: false, content: `The review was not saved: ${answer.error ?? "the hub refused it"}` };
          }
          return { ok: true, content: `Review saved to ${answer.path}` };
        } catch (error) {
          return { ok: false, content: `The review was not saved: ${error instanceof Error ? error.message : String(error)}` };
        }
      }
      const dir = join(options.userDir, "critiche");
      try {
        mkdirSync(dir, { recursive: true });
        const path = freeReviewPath(dir, reviewFileName(`position-${a.position_id}`, day()));
        writeFileSync(path, text, "utf8");
        return { ok: true, content: `Review saved to ${path}` };
      } catch (error) {
        // The folder belongs to the Critic on a real box: say so, do not swallow it.
        return { ok: false, content: `The review could not be saved in ${dir}: ${(error as Error).message}` };
      }
    },
  };
}
