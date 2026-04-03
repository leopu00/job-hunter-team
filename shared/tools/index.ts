/**
 * Tool System — Barrel exports
 *
 * Esporta tipi, registry, bash executor e heartbeat.
 */

export type {
  Tool,
  ToolResult,
  ToolResultContent,
  ExecSecurity,
  ExecHost,
  ExecToolDefaults,
  ExecToolDetails,
  ToolProfileId,
  ToolProfilePolicy,
  ToolSection,
  ToolDefinition,
  HeartbeatIndicatorType,
  HeartbeatStatus,
  HeartbeatEvent,
  HeartbeatRunResult,
  HeartbeatHandler,
} from "./types";

export {
  registerTool,
  getTool,
  listTools,
  registerCustomDefinition,
  listAllDefinitions,
  resolveProfilePolicy,
  listSections,
  isKnownToolId,
} from "./tool-registry";

export { createExecTool } from "./bash-tool";

export {
  resolveIndicatorType,
  emitHeartbeatEvent,
  onHeartbeatEvent,
  getLastHeartbeatEvent,
  setHeartbeatHandler,
  setHeartbeatsEnabled,
  areHeartbeatsEnabled,
  requestHeartbeatNow,
  startHeartbeat,
  stopHeartbeat,
  resetHeartbeatForTest,
} from "./heartbeat";
