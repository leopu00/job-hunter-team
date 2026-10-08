/**
 * `shared/skills/email_monitor.py` as a native tool, in its "no broker" form.
 *
 * The mailbox account lives in the portal-secrets broker (container
 * `jht-broker`, P1 of 08/10), and the script only talks to the broker's
 * socket. This runtime has no broker socket, no IMAP and no SMTP, and it never
 * reads a credentials file: a mailbox password is exactly what an API agent
 * must not hold. So the tool answers as the script answers when the broker is
 * unreachable — `status` succeeds with `configured: false` and the reason,
 * `count`, `poll` and `send` refuse with `broker_unavailable` — and the Scout's prompt already
 * knows what to do then: skip email and source from the web.
 */

import { z } from "zod";

import type { ToolHandler } from "../../tools/registry.ts";
import { printed, pyJson } from "./py-compat.ts";

export const EMAIL_MONITOR_TOOL = "email_monitor";
export const BROKER_UNAVAILABLE = "broker_unavailable";

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

export function createEmailMonitorTool(_options: EmailMonitorOptions = {}): ToolHandler {
  return {
    spec: {
      name: EMAIL_MONITOR_TOOL,
      description:
        "The team mailbox of forwarded job alerts (replaces `python3 …/email_monitor.py`). " +
        "status: is it configured. count: new messages by sender. poll: one JSON lead per line. " +
        "send: an email from the team mailbox, as a draft the user approves. " +
        "In this runtime the mailbox broker is never reachable: when status says configured=false, source from the web.",
      schema,
    },

    classify(args) {
      return { risk: "none", paths: [], summary: `email_monitor ${(args as { command: string }).command}` };
    },

    async execute(args) {
      const { command } = args as z.infer<typeof schema>;
      const refusal = { ok: false, reason: BROKER_UNAVAILABLE };
      if (command === "poll") return { ok: false, content: printed([]) };
      if (command === "send") return { ok: false, content: pyJson(refusal) };
      if (command === "count") {
        return {
          ok: false,
          content: pyJson({ ...refusal, configured: false, new_total: 0, by_sender: {} }, { indent: 2 }),
        };
      }
      // status reports a state, as the script does: not configured, and why.
      return { ok: true, content: pyJson({ ok: true, configured: false, unavailable: BROKER_UNAVAILABLE }, { indent: 2 }) };
    },
  };
}
