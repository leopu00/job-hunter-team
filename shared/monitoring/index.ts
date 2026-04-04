/**
 * Monitoring — Monitoraggio runtime, heartbeat, alerting
 */

export type {
  SystemMetrics, AgentHeartbeat,
  AlertThreshold, AlertEvent, MonitorConfig,
} from './types.js';
export { DEFAULT_MONITOR_CONFIG } from './types.js';

export {
  configureMonitor, collectMetrics, getMetricsHistory,
  registerHeartbeat, getAgentStatus, getAllAgentStatuses,
  checkHeartbeats, removeAgent, resetMonitor,
} from './monitor.js';

export {
  defineThreshold, removeThreshold, getThresholds,
  checkThresholds, checkHeartbeatAlert,
  getActiveAlerts, clearAlert, clearAllAlerts, resetAlerter,
} from './alerter.js';
