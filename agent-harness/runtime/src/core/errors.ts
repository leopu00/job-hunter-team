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
  | "model_incapable"
  | "output_invalid"
  | "agent_running";

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
