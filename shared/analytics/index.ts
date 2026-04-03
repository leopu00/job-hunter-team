/**
 * Modulo analytics — metriche e statistiche API
 *
 * Conteggio chiamate per provider, token usati,
 * latenza media/p95, costo stimato per modello.
 */

// Tipi
export type {
  ProviderName,
  ModelCost,
  TokenUsage,
  UsageEntry,
  LatencyStats,
  ProviderStats,
  ModelStats,
  DailyStats,
  UsageSummary,
  AnalyticsSnapshot,
} from "./types.js";

// Tracker
export type { RecordCallParams } from "./usage-tracker.js";

export {
  getModelCost,
  setModelCost,
  estimateCost,
  recordCall,
  getSummary,
  getEntries,
  getEntryCount,
  restoreEntries,
  clearEntries,
  formatTokenCount,
  formatUsd,
} from "./usage-tracker.js";

// Store
export {
  configureAnalyticsStore,
  getAnalyticsStorePath,
  saveAnalytics,
  loadAnalytics,
  hasStoredAnalytics,
  rotateEntries,
  saveAnalyticsToPath,
  loadAnalyticsFromPath,
} from "./usage-store.js";
