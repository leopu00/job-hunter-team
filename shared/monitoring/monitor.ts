/**
 * Monitoring — Raccolta metriche sistema e heartbeat agenti
 */
import os from 'node:os';
import type { SystemMetrics, AgentHeartbeat, MonitorConfig } from './types.js';
import { DEFAULT_MONITOR_CONFIG } from './types.js';

const heartbeats = new Map<string, { lastSeen: number; metadata?: Record<string, unknown> }>();
const metricsHistory: SystemMetrics[] = [];
let config: Required<MonitorConfig> = { ...DEFAULT_MONITOR_CONFIG };

/** Configura il monitor */
export function configureMonitor(opts: MonitorConfig): void {
  config = { ...DEFAULT_MONITOR_CONFIG, ...opts };
}

/** Raccoglie metriche di sistema correnti */
export function collectMetrics(): SystemMetrics {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  let cpuUsage = 0;
  if (cpus.length > 0) {
    const totals = cpus.reduce((acc, c) => {
      const t = Object.values(c.times).reduce((s, v) => s + v, 0);
      return { idle: acc.idle + c.times.idle, total: acc.total + t };
    }, { idle: 0, total: 0 });
    cpuUsage = Math.round((1 - totals.idle / totals.total) * 10000) / 100;
  }

  const metrics: SystemMetrics = {
    cpuUsage,
    memoryUsedMB: Math.round(usedMem / 1048576),
    memoryTotalMB: Math.round(totalMem / 1048576),
    memoryPercent: Math.round((usedMem / totalMem) * 10000) / 100,
    uptimeSeconds: Math.floor(os.uptime()),
    loadAvg: os.loadavg() as [number, number, number],
    timestamp: Date.now(),
  };

  metricsHistory.push(metrics);
  while (metricsHistory.length > config.metricsHistorySize) metricsHistory.shift();

  return metrics;
}

/** Ritorna storico metriche */
export function getMetricsHistory(): SystemMetrics[] {
  return [...metricsHistory];
}

/** Registra heartbeat di un agente */
export function registerHeartbeat(agentId: string, metadata?: Record<string, unknown>): void {
  heartbeats.set(agentId, { lastSeen: Date.now(), metadata });
}

/** Stato di un singolo agente */
export function getAgentStatus(agentId: string): AgentHeartbeat | null {
  const hb = heartbeats.get(agentId);
  if (!hb) return null;
  return { agentId, lastSeen: hb.lastSeen, status: resolveStatus(hb.lastSeen), metadata: hb.metadata };
}

/** Stato di tutti gli agenti registrati */
export function getAllAgentStatuses(): AgentHeartbeat[] {
  return [...heartbeats.entries()].map(([agentId, hb]) => ({
    agentId, lastSeen: hb.lastSeen, status: resolveStatus(hb.lastSeen), metadata: hb.metadata,
  }));
}

/** Controlla heartbeat e ritorna agenti stale/dead */
export function checkHeartbeats(): AgentHeartbeat[] {
  return getAllAgentStatuses().filter(a => a.status !== 'alive');
}

/** Rimuove un agente dal monitoraggio */
export function removeAgent(agentId: string): boolean {
  return heartbeats.delete(agentId);
}

/** Reset completo (per test) */
export function resetMonitor(): void {
  heartbeats.clear();
  metricsHistory.length = 0;
  config = { ...DEFAULT_MONITOR_CONFIG };
}

function resolveStatus(lastSeen: number): 'alive' | 'stale' | 'dead' {
  const elapsed = Date.now() - lastSeen;
  if (elapsed > config.heartbeatDeadMs) return 'dead';
  if (elapsed > config.heartbeatStaleMs) return 'stale';
  return 'alive';
}
