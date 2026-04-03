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
} from "./types.js";

export {
  registerTool,
  getTool,
  listTools,
  registerCustomDefinition,
  listAllDefinitions,
  resolveProfilePolicy,
  listSections,
  isKnownToolId,
} from "./tool-registry.js";

export { createExecTool } from "./bash-tool.js";

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
} from "./heartbeat.js";
