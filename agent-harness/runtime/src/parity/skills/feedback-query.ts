/**
 * `shared/skills/feedback_query.py check` as a native tool: the user's
 * like/dislike/hide/star on one position, newest first.
 *
 * Local first, as the script: the judgement lives in `jobs.db`
 * (`position_feedback`) and is answered from there. When the local table
 * cannot be read, the script asks the cloud with the bearer token in
 * `$JHT_HOME/cloud.json`; this runtime has no cloud lane and never reads that
 * token, so it answers with the script's own neutral payload for a cloud that
 * is off — `note: no-signal:cloud-disabled` — and the Scout carries on.
 *
 * Only `check`, the Scout's use. `recent` and `themes` read the cloud
 * aggregate for the Mentor and the Scorer; they come with those roles.
 *
 * `reason` and `comment` are raw: only `display_reason` / `display_comment`,
 * sanitised as the script does, may reach the user.
 */

import { z } from "zod";

import type { Database } from "../../db/jobs-db.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { sanitizeFeedbackDisplay } from "./feedback-display.ts";
import { pyJson } from "./py-compat.ts";

export const FEEDBACK_QUERY_TOOL = "feedback_query";
export const NO_SIGNAL_CLOUD_DISABLED = "no-signal:cloud-disabled";

export interface FeedbackQueryOptions {
  /** Opens the team database. The runtime decides which file. */
  db: () => Database;
  /** `$JHT_HOME` as the environment gives it: the sanitiser hides it in displayed text. */
  jhtHome?: string | undefined;
}

type Row = Record<string, unknown>;

const schema = z
  .object({
    command: z.literal("check"),
    legacy_id: z.string().min(1).max(64).describe("The position's legacy_id"),
  })
  .strict();

export function createFeedbackQueryTool(options: FeedbackQueryOptions): ToolHandler {
  /** The judgement events, newest first, or null when the local table cannot answer. */
  const localEvents = (legacyId: string): Row[] | null => {
    if (!/^-?\d+$/.test(legacyId)) return null;
    try {
      const db = options.db();
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='position_feedback'")
        .get();
      if (!table) return null;
      return db
        .prepare(
          "SELECT action, reason, comment, score, direction, created_at FROM position_feedback " +
            "WHERE position_id = ? ORDER BY id DESC",
        )
        .all(Number(legacyId)) as Row[];
    } catch {
      return null;
    }
  };

  const display = (value: unknown) => sanitizeFeedbackDisplay(value, { jhtHome: options.jhtHome });

  return {
    spec: {
      name: FEEDBACK_QUERY_TOOL,
      description:
        "The user's feedback on one position (replaces `python3 …/feedback_query.py check <legacy_id>`): " +
        "latest_action, latest_direction and every event, newest first, as JSON. " +
        "A `note` of no-signal:* means no data, not no feedback. Never quote reason/comment to the user; " +
        "use display_reason/display_comment.",
      schema,
    },

    classify(args) {
      return { risk: "read", paths: [], summary: `feedback_query check ${(args as { legacy_id: string }).legacy_id}` };
    },

    async execute(args) {
      const { legacy_id: legacyId } = args as z.infer<typeof schema>;
      const events = localEvents(legacyId);
      if (events === null) {
        return {
          ok: true,
          content: pyJson(
            {
              ok: true,
              legacy_id: legacyId,
              latest_action: null,
              latest_direction: null,
              count: 0,
              actions: [],
              note: NO_SIGNAL_CLOUD_DISABLED,
            },
            { ensureAscii: false },
          ),
        };
      }
      const actions = events.map((f) => ({
        action: f["action"],
        created_at: f["created_at"] ?? null,
        reason: f["reason"] ?? null,
        comment: f["comment"] ?? null,
        display_reason: display(f["reason"]),
        display_comment: display(f["comment"]),
        score: f["score"] ?? null,
        direction: f["direction"] ?? null,
      }));
      // The most recent direction anywhere in the history, not only on the latest event.
      const latestDirection = actions.find((a) => a.direction)?.direction ?? null;
      return {
        ok: true,
        content: pyJson(
          {
            ok: true,
            legacy_id: legacyId,
            latest_action: actions[0]?.action ?? null,
            latest_direction: latestDirection,
            count: actions.length,
            actions,
            source: "local",
          },
          { ensureAscii: false },
        ),
      };
    },
  };
}
