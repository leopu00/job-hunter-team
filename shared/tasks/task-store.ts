/**
 * Task Store — persistenza JSON su filesystem
 *
 * Salva/carica snapshot dei task in un file JSON.
 * Usato dal registry per backup e ripristino.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TaskRecord } from "./types.js";
import { exportSnapshot, restoreFromSnapshot } from "./task-registry.js";

const DEFAULT_FILENAME = "tasks.json";

type TaskStoreSnapshot = {
  version: 1;
  updatedAt: number;
  tasks: TaskRecord[];
};

let storeFilePath: string | null = null;

export function configureTaskStore(dirPath: string, filename?: string): string {
  mkdirSync(dirPath, { recursive: true });
  storeFilePath = join(dirPath, filename ?? DEFAULT_FILENAME);
  return storeFilePath;
}

export function getStoreFilePath(): string | null {
  return storeFilePath;
}

export function saveTasks(): boolean {
  if (!storeFilePath) return false;
  const snapshot: TaskStoreSnapshot = {
    version: 1,
    updatedAt: Date.now(),
    tasks: exportSnapshot(),
  };
  try {
    mkdirSync(dirname(storeFilePath), { recursive: true });
    writeFileSync(storeFilePath, JSON.stringify(snapshot, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function loadTasks(): boolean {
  if (!storeFilePath || !existsSync(storeFilePath)) return false;
  try {
    const raw = readFileSync(storeFilePath, "utf-8");
    const data = JSON.parse(raw) as TaskStoreSnapshot;
    if (!data || !Array.isArray(data.tasks)) return false;
    restoreFromSnapshot(data.tasks);
    return true;
  } catch {
    return false;
  }
}

export function hasStoredTasks(): boolean {
  if (!storeFilePath) return false;
  return existsSync(storeFilePath);
}

export function saveTasksToPath(filePath: string, tasks: TaskRecord[]): boolean {
  const snapshot: TaskStoreSnapshot = {
    version: 1,
    updatedAt: Date.now(),
    tasks,
  };
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function loadTasksFromPath(filePath: string): TaskRecord[] | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as TaskStoreSnapshot;
    if (!data || !Array.isArray(data.tasks)) return null;
    return data.tasks;
  } catch {
    return null;
  }
}
