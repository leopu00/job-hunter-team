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
 *
 * Both roads lead to the SAME function, `saveReview` in src/hub/review.ts:
 * the hub calls it over the socket, `npm run role` calls it here. A second
 * implementation would mean a second spelling of the file name, and the
 * guardian that looks for a verdict's review by name (`reviewsFor`) would
 * start announcing missing files that are on disk under the other name.
 */

import { join } from "node:path";
import { z } from "zod";

import type { Database } from "../../db/jobs-db.ts";
import type { HubClient } from "../../hub/client.ts";
import { HUB_PATHS } from "../../hub/protocol.ts";
import { MAX_REVIEW_CHARS, saveReview } from "../../hub/review.ts";
import type { ToolHandler } from "../../tools/registry.ts";

export interface ReviewToolOptions {
  /** The deliverables folder: the review goes in its `critiche/`. */
  userDir: string;
  /** With a hub, the review is written there, by a user of its own (T34). */
  hub?: HubClient | undefined;
  /** Without a hub: the company of the position being judged comes from here. */
  db?: (() => Database) | undefined;
  /** Test seam: the day the file is named after. */
  now?: () => Date;
}

/** The position and the text, and nothing that could choose a path or a name. */
const schema = z
  .object({
    position_id: z.number().int().positive(),
    // The ceiling is the hub's: one number, so a review the tool accepts is
    // never one the hub then refuses.
    text: z.string().min(1).max(MAX_REVIEW_CHARS),
  })
  .strict();

export function createSaveReviewTool(options: ReviewToolOptions): ToolHandler {
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
      // No hub: no second uid to protect anything from, but the same writer,
      // so the name and the refusals are the hub's, not a copy of them.
      if (!options.db) {
        return { ok: false, content: "The review was not saved: no hub and no database, so nothing can name the file." };
      }
      try {
        const written = saveReview(options.db(), {
          userDir: options.userDir,
          positionId: a.position_id,
          text,
          ...(options.now ? { now: options.now } : {}),
        });
        if (!written.ok || !written.path) {
          return { ok: false, content: `The review was not saved: ${written.error ?? "refused"}` };
        }
        return { ok: true, content: `Review saved to ${written.path}` };
      } catch (error) {
        // The folder belongs to the Critic on a real box: say so, do not swallow it.
        const dir = join(options.userDir, "critiche");
        return { ok: false, content: `The review could not be saved in ${dir}: ${(error as Error).message}` };
      }
    },
  };
}
