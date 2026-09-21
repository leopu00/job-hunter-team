/**
 * The wire between a role and `jht-hub` (T18, SICUREZZA §8 phase 2).
 *
 * JSON over HTTP on the pod's loopback, one POST per operation, the role's
 * token in `Authorization: Bearer`. The hub knows the agent from the token
 * alone: nothing in a body names who is asking.
 */

import { z } from "zod";

import { AGENT_NAME } from "../parity/jht-tools.ts";

export const HUB_PATHS = {
  tool: "/v1/tool",
  send: "/v1/mailbox/send",
  drain: "/v1/mailbox/drain",
  notify: "/v1/notify",
  replies: "/v1/replies/take",
  spawn: "/v1/spawn",
  spawnStop: "/v1/spawn/stop",
  spawnList: "/v1/spawn/list",
  teamStart: "/v1/team/start",
  userRequest: "/v1/user/write-request",
  // T34: the hub writes the Critic's verdict with a uid of its own, since
  // in-process the Critic has the Writer's (docs/parity.md).
  review: "/v1/review",
} as const;

/** Largest request body: a `db_insert position` with a long job description fits well below. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** A role's token: long, random, and nothing a shell or a header would mangle. */
export const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;

export const ToolRequest = z.object({ name: z.string().min(1).max(64), args: z.unknown() }).strict();

/** `to` is an agent name, as send_message takes it: no path, no dot, no separator (HUB-1). */
export const SendRequest = z.object({ to: AGENT_NAME, text: z.string().max(8_000) }).strict();

export const NotifyRequest = z
  .object({
    kind: z.enum(["notification", "question", "digest", "alert"]),
    text: z.string().max(8_000),
    positionId: z.number().int().optional(),
  })
  .strict();

export const EmptyRequest = z.object({}).strict();

/**
 * T28: what the PERSON asks for, sent by the host with the team's own token.
 * No role has that token, and no role has a tool that sets the flag.
 */
export const UserWriteRequest = z
  .object({
    position_id: z.number().int().positive(),
    mode: z.enum(["on", "off"]).default("on"),
    kind: z.enum(["cv", "cover_letter"]).default("cv"),
  })
  .strict();

export interface ToolResponse {
  ok: boolean;
  content: string;
  details?: Record<string, unknown>;
}

export interface HubError {
  error: string;
}
