/**
 * Monitoring — Tipi per monitoraggio runtime
 */

/** Metriche di sistema */
export interface SystemMetrics {
  cpuUsage: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  memoryPercent: number;
  uptimeSeconds: number;
  loadAvg: [number, number, number];
  timestamp: number;
}

/** Heartbeat di un agente */
export interface AgentHeartbeat {
  agentId: string;
  lastSeen: number;
  status: 'alive' | 'stale' | 'dead';
  metadata?: Record<string, unknown>;
}

/** Soglia di alert */
export interface AlertThreshold {
  id: string;
  metric: 'cpuUsage' | 'memoryPercent' | 'heartbeat';
  operator: 'gt' | 'lt' | 'eq';
  value: number;
  description: string;
}

/** Evento di alert attivo */
export interface AlertEvent {
  thresholdId: string;
  metric: string;
  currentValue: number;
  thresholdValue: number;
  operator: string;
  description: string;
  triggeredAt: number;
}

/** Configurazione monitor */
export interface MonitorConfig {
  heartbeatStaleMs?: number;
  heartbeatDeadMs?: number;
  metricsHistorySize?: number;
}

export const DEFAULT_MONITOR_CONFIG: Required<MonitorConfig> = {
  heartbeatStaleMs: 30_000,
  heartbeatDeadMs: 120_000,
  metricsHistorySize: 60,
};
