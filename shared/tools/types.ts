/**
 * Tool System — Tipi e interfacce
 *
 * Definisce la struttura dei tool, i risultati di esecuzione,
 * i profili e le sezioni del catalogo.
 */

// --- Tool Result ---

export type ToolResultContent = {
  type: "text";
  text: string;
};

export type ToolResult<TDetails = unknown> = {
  content: ToolResultContent[];
  details: TDetails;
};

// --- Tool Interface ---

export type Tool<TParams = unknown, TDetails = unknown> = {
  name: string;
  label: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (
    toolCallId: string,
    args: TParams,
    signal: AbortSignal,
  ) => Promise<ToolResult<TDetails>>;
};

// --- Exec Tool Types ---

export type ExecSecurity = "deny" | "allowlist" | "full";
export type ExecHost = "local" | "sandbox";

export type ExecToolDefaults = {
  host?: ExecHost;
  security?: ExecSecurity;
  timeoutSec?: number;
  cwd?: string;
  pathPrepend?: string[];
  env?: Record<string, string>;
  allowBackground?: boolean;
};

export type ExecToolDetails =
  | {
      status: "running";
      pid?: number;
      startedAt: number;
      cwd?: string;
      tail?: string;
    }
  | {
      status: "completed" | "failed";
      exitCode: number | null;
      durationMs: number;
      output: string;
      timedOut?: boolean;
      cwd?: string;
    };

// --- Tool Profile ---

export type ToolProfileId = "minimal" | "coding" | "full";

export type ToolProfilePolicy = {
  allow?: string[];
  deny?: string[];
};

// --- Tool Catalog ---

export type ToolSection = {
  id: string;
  label: string;
};

export type ToolDefinition = {
  id: string;
  label: string;
  description: string;
  sectionId: string;
  profiles: ToolProfileId[];
};

// --- Heartbeat Types ---

export type HeartbeatIndicatorType = "ok" | "alert" | "error";

export type HeartbeatStatus = "sent" | "ok-empty" | "ok-token" | "skipped" | "failed";

export type HeartbeatEvent = {
  ts: number;
  status: HeartbeatStatus;
  agentId?: string;
  durationMs?: number;
  reason?: string;
  indicatorType?: HeartbeatIndicatorType;
};

export type HeartbeatRunResult =
  | { status: "ran"; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export type HeartbeatHandler = (opts: {
  reason?: string;
  agentId?: string;
}) => Promise<HeartbeatRunResult>;
