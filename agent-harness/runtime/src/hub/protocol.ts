/**
 * The wire between a role and `jht-hub` (T18, SICUREZZA §8 phase 2).
 *
 * JSON over HTTP on the pod's loopback, one POST per operation, the role's
 * token in `Authorization: Bearer`. The hub knows the agent from the token
 * alone: nothing in a body names who is asking.
 */

import { z } from "zod";

export const HUB_PATHS = {
  tool: "/v1/tool",
  send: "/v1/mailbox/send",
  drain: "/v1/mailbox/drain",
  notify: "/v1/notify",
  replies: "/v1/replies/take",
} as const;

/** Largest request body: a `db_insert position` with a long job description fits well below. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** A role's token: long, random, and nothing a shell or a header would mangle. */
export const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;

export const ToolRequest = z.object({ name: z.string().min(1).max(64), args: z.unknown() }).strict();

export const SendRequest = z.object({ to: z.string().min(1).max(64), text: z.string().max(8_000) }).strict();

export const NotifyRequest = z
  .object({
    kind: z.enum(["notification", "question", "digest", "alert"]),
    text: z.string().max(8_000),
    positionId: z.number().int().optional(),
  })
  .strict();

export const EmptyRequest = z.object({}).strict();

export interface ToolResponse {
  ok: boolean;
  content: string;
  details?: Record<string, unknown>;
}

export interface HubError {
  error: string;
}
