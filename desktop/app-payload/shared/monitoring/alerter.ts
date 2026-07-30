/**
 * Monitoring — Alerter: soglie, valutazione, alert attivi
 */
import type { AlertThreshold, AlertEvent, SystemMetrics } from './types.js';

const thresholds = new Map<string, AlertThreshold>();
const activeAlerts = new Map<string, AlertEvent>();

/** Registra una soglia di alert */
export function defineThreshold(threshold: AlertThreshold): void {
  thresholds.set(threshold.id, threshold);
}

/** Rimuove una soglia */
export function removeThreshold(id: string): boolean {
  activeAlerts.delete(id);
  return thresholds.delete(id);
}

/** Lista soglie registrate */
export function getThresholds(): AlertThreshold[] {
  return [...thresholds.values()];
}

/** Valuta le metriche contro le soglie e ritorna nuovi alert */
export function checkThresholds(metrics: SystemMetrics): AlertEvent[] {
  const triggered: AlertEvent[] = [];

  for (const t of thresholds.values()) {
    if (t.metric === 'heartbeat') continue;
    const current = metrics[t.metric] as number;
    const fired = evaluate(current, t.operator, t.value);

    if (fired) {
      const event: AlertEvent = {
        thresholdId: t.id, metric: t.metric,
        currentValue: current, thresholdValue: t.value,
        operator: t.operator, description: t.description,
        triggeredAt: Date.now(),
      };
      activeAlerts.set(t.id, event);
      triggered.push(event);
    } else {
      activeAlerts.delete(t.id);
    }
  }

  return triggered;
}

/** Valuta alert heartbeat (chiamare con tempo dall'ultimo heartbeat in ms) */
export function checkHeartbeatAlert(agentId: string, elapsedMs: number): AlertEvent | null {
  for (const t of thresholds.values()) {
    if (t.metric !== 'heartbeat') continue;
    if (evaluate(elapsedMs, t.operator, t.value)) {
      const event: AlertEvent = {
        thresholdId: t.id, metric: `heartbeat:${agentId}`,
        currentValue: elapsedMs, thresholdValue: t.value,
        operator: t.operator, description: `${t.description} (${agentId})`,
        triggeredAt: Date.now(),
      };
      activeAlerts.set(`${t.id}:${agentId}`, event);
      return event;
    }
  }
  return null;
}

/** Ritorna tutti gli alert attivi */
export function getActiveAlerts(): AlertEvent[] {
  return [...activeAlerts.values()];
}

/** Rimuove un alert attivo */
export function clearAlert(thresholdId: string): boolean {
  return activeAlerts.delete(thresholdId);
}

/** Rimuove tutti gli alert */
export function clearAllAlerts(): void {
  activeAlerts.clear();
}

/** Reset completo (per test) */
export function resetAlerter(): void {
  thresholds.clear();
  activeAlerts.clear();
}

function evaluate(current: number, op: string, threshold: number): boolean {
  if (op === 'gt') return current > threshold;
  if (op === 'lt') return current < threshold;
  if (op === 'eq') return current === threshold;
  return false;
}
