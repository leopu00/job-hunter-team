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

/**
 * Which window of a plan is spent. The names are the agent-state vocabulary's
 * (`shared/skills/agent_state.py`), not a second one: the runtime sets one only
 * when it can prove it.
 */
export const QUOTA_REASONS = ["limite_5h", "limite_settimanale", "limite_spesa_org"] as const;
export type QuotaReason = (typeof QUOTA_REASONS)[number];

/**
 * What the provider's 429 said, kept on the error for whoever manages the
 * team. `rate_limit_429` is a burst to wait out; `quota` is a spent window.
 */
export interface RateLimitDetails {
  kind: "rate_limit_429" | "quota";
  /** What the provider asked to wait, in ms, when it asked. */
  retryAfterMs?: number;
  /** When that wait ends, ISO 8601 on this computer's clock. */
  resumeAt?: string;
  /** `retry-after` and the `…ratelimit…` headers, plain values only. */
  headers: Record<string, string>;
  reason?: QuotaReason;
}

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly rateLimit?: RateLimitDetails;

  constructor(code: HarnessErrorCode, message: string, options?: { cause?: unknown; rateLimit?: RateLimitDetails }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HarnessError";
    this.code = code;
    if (options?.rateLimit) this.rateLimit = options.rateLimit;
  }
}

export function isHarnessError(value: unknown): value is HarnessError {
  return value instanceof HarnessError;
}
