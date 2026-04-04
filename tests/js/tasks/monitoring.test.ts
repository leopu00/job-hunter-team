/** Test unitari — shared/monitoring (vitest): metrics mock, heartbeat, alerter, thresholds. */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:os", () => {
  const m = {
    totalmem: vi.fn(() => 16 * 1024 * 1024 * 1024),
    freemem: vi.fn(() => 8 * 1024 * 1024 * 1024),
    cpus: vi.fn(() => [{ times: { user: 700, nice: 0, sys: 200, idle: 100, irq: 0 } }]),
    uptime: vi.fn(() => 3600),
    loadavg: vi.fn(() => [1.5, 1.2, 0.9]),
  };
  return { default: m, ...m };
});

import os from "node:os";
import {
  collectMetrics, getMetricsHistory, configureMonitor,
  registerHeartbeat, getAgentStatus, getAllAgentStatuses,
  checkHeartbeats, removeAgent, resetMonitor,
} from "../../../shared/monitoring/monitor.js";
import {
  defineThreshold, removeThreshold, getThresholds,
  checkThresholds, checkHeartbeatAlert,
  getActiveAlerts, clearAlert, clearAllAlerts, resetAlerter,
} from "../../../shared/monitoring/alerter.js";
import { DEFAULT_MONITOR_CONFIG } from "../../../shared/monitoring/types.js";

beforeEach(() => { resetMonitor(); resetAlerter(); });

describe("collectMetrics — CPU, memoria, uptime", () => {
  it("ritorna metriche corrette da OS mock (CPU 90%, mem 50%, uptime 3600)", () => {
    const m = collectMetrics();
    expect(m.cpuUsage).toBe(90);
    expect(m.memoryTotalMB).toBe(16384);
    expect(m.memoryUsedMB).toBe(8192);
    expect(m.memoryPercent).toBe(50);
    expect(m.uptimeSeconds).toBe(3600);
    expect(m.loadAvg).toEqual([1.5, 1.2, 0.9]);
    expect(m.timestamp).toBeGreaterThan(0);
  });

  it("CPU con idle diverso: 90% idle → cpuUsage 10%", () => {
    vi.mocked(os.cpus).mockReturnValueOnce([
      { model: "t", speed: 1, times: { user: 50, nice: 0, sys: 50, idle: 900, irq: 0 } },
    ] as any);
    expect(collectMetrics().cpuUsage).toBe(10);
  });

  it("cpus vuoto → cpuUsage 0", () => {
    vi.mocked(os.cpus).mockReturnValueOnce([]);
    expect(collectMetrics().cpuUsage).toBe(0);
  });

  it("metricsHistory rispetta metricsHistorySize", () => {
    configureMonitor({ metricsHistorySize: 3 });
    for (let i = 0; i < 5; i++) collectMetrics();
    expect(getMetricsHistory()).toHaveLength(3);
  });
});

describe("heartbeat — register, status, lifecycle", () => {
  it("agente registrato → status alive con metadata", () => {
    registerHeartbeat("scout", { role: "scout" });
    const s = getAgentStatus("scout");
    expect(s).not.toBeNull();
    expect(s!.status).toBe("alive");
    expect(s!.metadata).toEqual({ role: "scout" });
  });

  it("agente non registrato → null", () => {
    expect(getAgentStatus("nobody")).toBeNull();
  });

  it("stale dopo heartbeatStaleMs, dead dopo heartbeatDeadMs", () => {
    vi.useFakeTimers();
    try {
      configureMonitor({ heartbeatStaleMs: 100, heartbeatDeadMs: 500 });
      registerHeartbeat("ag1");
      vi.advanceTimersByTime(150);
      expect(getAgentStatus("ag1")!.status).toBe("stale");
      vi.advanceTimersByTime(400); // totale 550ms
      expect(getAgentStatus("ag1")!.status).toBe("dead");
    } finally { vi.useRealTimers(); }
  });

  it("checkHeartbeats ritorna solo stale/dead, non alive", () => {
    vi.useFakeTimers();
    try {
      configureMonitor({ heartbeatStaleMs: 100, heartbeatDeadMs: 500 });
      registerHeartbeat("alive-a");
      registerHeartbeat("stale-a");
      vi.advanceTimersByTime(50);
      registerHeartbeat("alive-a"); // refresh
      vi.advanceTimersByTime(60);   // stale-a: 110ms, alive-a: 60ms
      const bad = checkHeartbeats();
      expect(bad).toHaveLength(1);
      expect(bad[0].agentId).toBe("stale-a");
    } finally { vi.useRealTimers(); }
  });

  it("removeAgent elimina, getAllAgentStatuses elenca tutti", () => {
    registerHeartbeat("a1");
    registerHeartbeat("a2");
    registerHeartbeat("a3");
    expect(getAllAgentStatuses()).toHaveLength(3);
    expect(removeAgent("a2")).toBe(true);
    expect(getAllAgentStatuses()).toHaveLength(2);
    expect(removeAgent("nope")).toBe(false);
  });
});

describe("alerter — soglie e valutazione metriche", () => {
  it("defineThreshold aggiunge, getThresholds elenca", () => {
    defineThreshold({ id: "cpu-hi", metric: "cpuUsage", operator: "gt", value: 80, description: "CPU alta" });
    defineThreshold({ id: "mem-hi", metric: "memoryPercent", operator: "gt", value: 90, description: "Mem alta" });
    expect(getThresholds()).toHaveLength(2);
  });

  it("removeThreshold rimuove e ritorna boolean", () => {
    defineThreshold({ id: "t1", metric: "cpuUsage", operator: "gt", value: 90, description: "test" });
    expect(removeThreshold("t1")).toBe(true);
    expect(removeThreshold("t1")).toBe(false);
    expect(getThresholds()).toHaveLength(0);
  });

  it("checkThresholds trigghera alert quando soglia superata (gt)", () => {
    defineThreshold({ id: "mem40", metric: "memoryPercent", operator: "gt", value: 40, description: "Mem > 40%" });
    const alerts = checkThresholds(collectMetrics()); // mem 50% > 40
    expect(alerts).toHaveLength(1);
    expect(alerts[0].thresholdId).toBe("mem40");
    expect(alerts[0].currentValue).toBe(50);
    expect(alerts[0].thresholdValue).toBe(40);
  });

  it("checkThresholds NON trigghera quando sotto soglia", () => {
    defineThreshold({ id: "mem95", metric: "memoryPercent", operator: "gt", value: 95, description: "Mem > 95%" });
    expect(checkThresholds(collectMetrics())).toHaveLength(0);
  });

  it("operatore lt: CPU 2% < 5 → alert", () => {
    defineThreshold({ id: "cpu-low", metric: "cpuUsage", operator: "lt", value: 5, description: "CPU bassa" });
    vi.mocked(os.cpus).mockReturnValueOnce([
      { model: "t", speed: 1, times: { user: 10, nice: 0, sys: 10, idle: 980, irq: 0 } },
    ] as any);
    expect(checkThresholds(collectMetrics())).toHaveLength(1);
  });

  it("alert attivi: clearAlert singolo, clearAllAlerts tutti", () => {
    defineThreshold({ id: "t1", metric: "memoryPercent", operator: "gt", value: 10, description: "test" });
    checkThresholds(collectMetrics());
    expect(getActiveAlerts()).toHaveLength(1);
    clearAlert("t1");
    expect(getActiveAlerts()).toHaveLength(0);
    checkThresholds(collectMetrics()); // re-trigger
    clearAllAlerts();
    expect(getActiveAlerts()).toHaveLength(0);
  });

  it("alert rimosso automaticamente quando soglia non più superata", () => {
    defineThreshold({ id: "mem40", metric: "memoryPercent", operator: "gt", value: 40, description: "Mem" });
    checkThresholds(collectMetrics()); // 50 > 40 → alert
    expect(getActiveAlerts()).toHaveLength(1);
    vi.mocked(os.freemem).mockReturnValueOnce(15 * 1024 * 1024 * 1024); // 15GB free → ~6% used
    checkThresholds(collectMetrics()); // 6 < 40 → alert cleared
    expect(getActiveAlerts()).toHaveLength(0);
  });
});

describe("alerter — heartbeat alerts", () => {
  it("checkHeartbeatAlert trigghera con soglia heartbeat gt", () => {
    defineThreshold({ id: "hb-stale", metric: "heartbeat", operator: "gt", value: 30000, description: "HB stale" });
    const a = checkHeartbeatAlert("agent-x", 50000);
    expect(a).not.toBeNull();
    expect(a!.metric).toBe("heartbeat:agent-x");
    expect(a!.currentValue).toBe(50000);
  });

  it("nessuna soglia heartbeat → null", () => {
    defineThreshold({ id: "cpu-only", metric: "cpuUsage", operator: "gt", value: 80, description: "CPU" });
    expect(checkHeartbeatAlert("agent-y", 99999)).toBeNull();
  });
});

describe("monitor + alerter — integrazione e config defaults", () => {
  it("collect → checkThresholds → solo alert corretti attivi", () => {
    defineThreshold({ id: "mem90", metric: "memoryPercent", operator: "gt", value: 90, description: "Mem critica" });
    defineThreshold({ id: "cpu50", metric: "cpuUsage", operator: "gt", value: 50, description: "CPU alta" });
    const alerts = checkThresholds(collectMetrics()); // mem 50%, cpu 90%
    expect(alerts.some(a => a.thresholdId === "cpu50")).toBe(true);
    expect(alerts.some(a => a.thresholdId === "mem90")).toBe(false);
    expect(getActiveAlerts()).toHaveLength(1);
  });
  it("DEFAULT_MONITOR_CONFIG: staleMs=30000, deadMs=120000, historySize=60", () => {
    expect(DEFAULT_MONITOR_CONFIG.heartbeatStaleMs).toBe(30000);
    expect(DEFAULT_MONITOR_CONFIG.heartbeatDeadMs).toBe(120000);
    expect(DEFAULT_MONITOR_CONFIG.metricsHistorySize).toBe(60);
  });
});
