import {
  ScoutWorkerErrorSchema,
  type ScoutWorkerError,
  type WorkerErrorCode,
} from "./contract.js";

const PUBLIC_MESSAGES: Record<WorkerErrorCode, string> = {
  INPUT_VALIDATION: "The Scout worker input is invalid.",
  PROFILE_VALIDATION: "The model profile is invalid.",
  CAPABILITY_UNSUPPORTED:
    "The selected model profile does not declare the required capabilities.",
  LIVE_NOT_ENABLED: "Live provider access requires the explicit live flag.",
  LIVE_BUDGET_REQUIRED:
    "Live provider access requires explicit pricing and a positive run budget.",
  API_KEY_MISSING:
    "The selected live provider key is missing from its environment variable.",
  CONCURRENT_RUN: "Another Scout API run already owns the worker lock.",
  INPUT_LIMIT: "The next provider request exceeds the input limit.",
  OUTPUT_LIMIT: "The provider output exceeds a configured output limit.",
  STEP_LIMIT: "The run reached its provider step limit.",
  TOOL_CALL_LIMIT: "The run reached its tool-call limit.",
  BUDGET_EXCEEDED: "The next provider step would exceed the run budget.",
  TIMEOUT: "The Scout run exceeded its time limit.",
  TOOL_ERROR: "An authorized Scout tool failed.",
  PROVIDER_ERROR: "The model provider failed to complete the Scout run.",
  OUTPUT_VALIDATION: "The provider returned an invalid Scout proposal.",
  INTERNAL_ERROR: "The Scout worker failed safely.",
};

export class WorkerFault extends Error {
  readonly code: WorkerErrorCode;
  readonly retryable: boolean;
  readonly limit?: ScoutWorkerError["limit"];

  constructor(
    code: WorkerErrorCode,
    options: {
      retryable?: boolean;
      limit?: ScoutWorkerError["limit"];
      cause?: unknown;
    } = {},
  ) {
    super(PUBLIC_MESSAGES[code], { cause: options.cause });
    this.name = "WorkerFault";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.limit = options.limit;
  }

  toContract(runId?: string): ScoutWorkerError {
    return ScoutWorkerErrorSchema.parse({
      contractVersion: "1",
      runId,
      role: "scout",
      code: this.code,
      message: PUBLIC_MESSAGES[this.code],
      retryable: this.retryable,
      limit: this.limit,
    });
  }
}

export function normalizeFault(error: unknown): WorkerFault {
  if (error instanceof WorkerFault) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new WorkerFault("TIMEOUT", {
      retryable: true,
      limit: "timeout_ms",
      cause: error,
    });
  }
  return new WorkerFault("INTERNAL_ERROR", { cause: error });
}
