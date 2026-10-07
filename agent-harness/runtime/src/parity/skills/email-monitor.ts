/**
 * `shared/skills/email_monitor.py` as a native tool, in its "not configured"
 * form.
 *
 * The script reads the team's dedicated mailbox over IMAP with a password
 * from `$JHT_HOME/credentials/email_monitor.json`. This runtime has no IMAP
 * client and does not read that file: a mailbox password is exactly what an
 * API agent must not hold. So the tool answers as the script answers when no
 * mailbox is set up — `status` says `configured: false`, `count` counts
 * nothing, `poll` finds no leads — and the Scout's prompt already knows what
 * to do then: skip email and source from the web. The cycle never breaks.
 *
 * When the credentials file does exist, `status` says so and adds a `note`, so
 * nobody mistakes "not available here" for "not set up".
 *
 * `send` (the chat skills' way to email someone) answers like the script with
 * no mailbox: `{"ok": false, "reason": "not_configured"}`. No SMTP here either.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { ToolHandler } from "../../tools/registry.ts";
import { printed, pyJson } from "./py-compat.ts";

export const EMAIL_MONITOR_TOOL = "email_monitor";
export const IMAP_UNAVAILABLE_NOTE = "imap-unavailable-in-api-runtime";

export interface EmailMonitorOptions {
  /** `$JHT_HOME` as the script reads it; `/jht_home` when unset, as in the script. */
  jhtHome?: string | undefined;
}

const schema = z
  .object({
    command: z.enum(["status", "count", "poll", "send"]),
    since_days: z.number().int().min(0).max(365).optional().describe("count, poll: how many days back"),
    to: z.array(z.string()).optional().describe("send: recipients"),
    subject: z.string().optional().describe("send: subject"),
    body: z.string().optional().describe("send: plain-text body"),
  })
  .strict();

export function createEmailMonitorTool(options: EmailMonitorOptions = {}): ToolHandler {
  const home = options.jhtHome?.trim() || "/jht_home";
  const credsPath = join(home, "credentials", "email_monitor.json");
  const statePath = join(home, "state", "email_monitor_seen.json");

  return {
    spec: {
      name: EMAIL_MONITOR_TOOL,
      description:
        "The team mailbox of forwarded job alerts (replaces `python3 …/email_monitor.py`). " +
        "status: is it configured. count: new messages by sender. poll: one JSON lead per line. " +
        "send: email someone from the team mailbox. " +
        "In this runtime the mailbox is never configured: when status says configured=false, source from the web.",
      schema,
    },

    classify(args) {
      return { risk: "none", paths: [], summary: `email_monitor ${(args as { command: string }).command}` };
    },

    async execute(args) {
      const { command } = args as z.infer<typeof schema>;
      if (command === "poll") return { ok: true, content: printed([]) };
      if (command === "send") return { ok: false, content: pyJson({ ok: false, reason: "not_configured" }) };
      if (command === "count") {
        return { ok: true, content: pyJson({ configured: false, new_total: 0, by_sender: {} }, { indent: 2 }) };
      }
      // Existence only: the file holds a password and is never opened.
      const credsExists = exists(credsPath);
      return {
        ok: true,
        content: pyJson(
          {
            configured: false,
            // The script reports why a credentials file was refused; this
            // runtime never opens it, so there is nothing to refuse.
            credentials_problem: null,
            user: "",
            host: "",
            from_filters: [],
            any_platform: true,
            seen_count: seenCount(statePath),
            state_path: statePath,
            creds_path: credsPath,
            creds_exists: credsExists,
            ...(credsExists ? { note: IMAP_UNAVAILABLE_NOTE } : {}),
          },
          { indent: 2 },
        ),
      };
    },
  };
}

/** Message-IDs already processed, from the state file the TUI script keeps. Not a secret. */
function seenCount(path: string): number {
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as { seen_message_ids?: unknown };
    return Array.isArray(state.seen_message_ids) ? state.seen_message_ids.length : 0;
  } catch {
    return 0;
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
