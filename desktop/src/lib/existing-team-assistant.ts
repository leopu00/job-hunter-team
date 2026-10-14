import { invoke } from "@tauri-apps/api/core";
import { teamStatusErrorCode } from "./existing-team-status";

/**
 * «Attiva assistente» on an existing team: the one native command that starts the
 * ASSISTENTE session on the team's pinned target. It is called only from the
 * confirmation the person gives in the Squadra page, never at mount, refresh or
 * connect. The native side checks the target and the team, does nothing if the
 * assistant is already running, starts it once and probes the readiness again;
 * what comes back is one of four results, and only the first two carry a readiness.
 */
const COMMAND = "existing_team_assistant_start";

export type AssistantStartOutcome =
  | { kind: "started" | "already_active"; at: number; captainRunning: boolean }
  | { kind: "timeout"; code: string }
  | { kind: "error"; code: string };

/** Codes that mean the start was asked for but could not be seen to finish in time. */
const TIMEOUT_CODES: readonly string[] = ["assistant_verify_timeout", "timeout"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export async function startExistingTeamAssistant(
  call: () => Promise<unknown> = () => invoke<unknown>(COMMAND, { request: { confirmed: true } }),
  now: () => number = Date.now,
): Promise<AssistantStartOutcome> {
  try {
    const reply = await call();
    if (
      isRecord(reply) &&
      (reply.outcome === "started" || reply.outcome === "already_active") &&
      typeof reply.captainRunning === "boolean" &&
      reply.assistantRunning === true
    ) {
      return { kind: reply.outcome, at: now(), captainRunning: reply.captainRunning };
    }
    return { kind: "error", code: "desktop_bad_reply" };
  } catch (error) {
    const code = teamStatusErrorCode(error);
    return TIMEOUT_CODES.includes(code) ? { kind: "timeout", code } : { kind: "error", code };
  }
}
