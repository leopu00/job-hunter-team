/**
 * Error taxonomy for the runtime.
 *
 * Every failure the runtime raises deliberately is an `HarnessError` with a stable
 * `code`. Codes are what the audit trail records and what a transport switches
 * on; messages are for humans and may change.
 */

export type HarnessErrorCode =
  | "config_invalid"
  | "live_gate_closed"
  | "pricing_unknown"
  | "budget_exhausted"
  | "step_limit_reached"
  | "tool_call_limit_reached"
  | "token_limit_reached"
  | "deadline_exceeded"
  | "input_too_large"
  | "provider_failed"
  // An upstream 429 that outlived the runtime's backoff: the ACCOUNT's rate
  // limit, not a limit of ours. It has a code of its own because reading it as
  // one of ours has already cost the team two diagnoses (MASTER, 23/09): the
  // ledger's note and the audit trail now say which wall a run hit.
  | "provider_rate_limited"
  | "model_incapable"
  | "output_invalid"
  | "agent_running"
  | "hub_unreachable"
  | "hub_failed";

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HarnessError";
    this.code = code;
  }
}

export function isHarnessError(value: unknown): value is HarnessError {
  return value instanceof HarnessError;
}
