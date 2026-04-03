/**
 * Usage Store — persistenza JSON metriche analytics
 *
 * Salva/carica entries su filesystem, supporta rotazione
 * per mantenere solo gli ultimi N giorni di dati.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UsageEntry, AnalyticsSnapshot } from "./types.js";
import { getEntries, restoreEntries } from "./usage-tracker.js";

const DEFAULT_FILENAME = "analytics.json";
const DEFAULT_RETENTION_DAYS = 30;

let storeFilePath: string | null = null;

export function configureAnalyticsStore(dirPath: string, filename?: string): string {
  mkdirSync(dirPath, { recursive: true });
  storeFilePath = join(dirPath, filename ?? DEFAULT_FILENAME);
  return storeFilePath;
}

export function getAnalyticsStorePath(): string | null {
  return storeFilePath;
}

export function saveAnalytics(): boolean {
  if (!storeFilePath) return false;
  const snapshot: AnalyticsSnapshot = {
    version: 1,
    updatedAt: Date.now(),
    entries: getEntries(),
  };
  try {
    mkdirSync(dirname(storeFilePath), { recursive: true });
    writeFileSync(storeFilePath, JSON.stringify(snapshot, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function loadAnalytics(): boolean {
  if (!storeFilePath || !existsSync(storeFilePath)) return false;
  try {
    const raw = readFileSync(storeFilePath, "utf-8");
    const data = JSON.parse(raw) as AnalyticsSnapshot;
    if (!data || !Array.isArray(data.entries)) return false;
    restoreEntries(data.entries);
    return true;
  } catch {
    return false;
  }
}

export function hasStoredAnalytics(): boolean {
  if (!storeFilePath) return false;
  return existsSync(storeFilePath);
}

/** Rimuove entries piu' vecchie di retentionDays dal tracker */
export function rotateEntries(retentionDays?: number): number {
  const days = retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = Date.now() - days * 24 * 60 * 60_000;
  const current = getEntries();
  const kept = current.filter((e) => e.timestamp >= cutoff);
  const removed = current.length - kept.length;
  if (removed > 0) restoreEntries(kept);
  return removed;
}

/** Salva entries su un path specifico (per export/backup) */
export function saveAnalyticsToPath(filePath: string, entries: UsageEntry[]): boolean {
  const snapshot: AnalyticsSnapshot = {
    version: 1,
    updatedAt: Date.now(),
    entries,
  };
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** Carica entries da un path specifico (per import) */
export function loadAnalyticsFromPath(filePath: string): UsageEntry[] | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as AnalyticsSnapshot;
    if (!data || !Array.isArray(data.entries)) return null;
    return data.entries;
  } catch {
    return null;
  }
}
