/**
 * Migrations — Runner con version tracking, rollback, backup
 */
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import type {
  Migration, MigrationResult, MigrationState,
  MigrationConfig, MigrationBatchResult, AppliedMigration,
} from './types.js';

const DEFAULT_STATE_PATH = path.join(homedir(), '.jht', 'migrations.json');

// --- State persistence ---

export function loadState(statePath?: string): MigrationState {
  const p = statePath || DEFAULT_STATE_PATH;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw) as MigrationState;
  } catch {
    return { currentVersion: '0.0.0', applied: [], updatedAt: Date.now() };
  }
}

export function saveState(state: MigrationState, statePath?: string): void {
  const p = statePath || DEFAULT_STATE_PATH;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

// --- Version comparison ---

function parseVersion(v: string): number[] {
  return v.split('.').map(n => parseInt(n, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// --- Backup ---

function backupConfig(configPath: string): string | null {
  if (!fs.existsSync(configPath)) return null;
  const backupPath = `${configPath}.bak.${Date.now()}`;
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

// --- Run single migration ---

function runSingle(
  migration: Migration,
  config: Record<string, unknown>,
  direction: 'up' | 'down',
): MigrationResult {
  const start = Date.now();
  try {
    const fn = direction === 'up' ? migration.up : migration.down;
    fn(config);
    return {
      version: migration.version, description: migration.description,
      direction, success: true, durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      version: migration.version, description: migration.description,
      direction, success: false, error: String(err), durationMs: Date.now() - start,
    };
  }
}

// --- Migration runner ---

/**
 * Esegue migrazioni up dalla versione corrente alla target.
 * Se una migrazione fallisce, rollback di tutte quelle gia' applicate.
 */
export function migrateUp(
  migrations: Migration[],
  config: Record<string, unknown>,
  opts?: MigrationConfig,
): MigrationBatchResult {
  const statePath = opts?.statePath || DEFAULT_STATE_PATH;
  const state = loadState(statePath);
  const sorted = [...migrations].sort((a, b) => compareVersions(a.version, b.version));
  const pending = sorted.filter(m => compareVersions(m.version, state.currentVersion) > 0);

  if (pending.length === 0) {
    return { ok: true, from: state.currentVersion, to: state.currentVersion, applied: [], rolledBack: false };
  }

  const applied: MigrationResult[] = [];

  for (const migration of pending) {
    const result = runSingle(migration, config, 'up');
    applied.push(result);

    if (!result.success) {
      // Rollback migrazioni gia' applicate in ordine inverso
      const toRollback = applied.filter(r => r.success).reverse();
      for (const r of toRollback) {
        const m = sorted.find(s => s.version === r.version);
        if (m) runSingle(m, config, 'down');
      }
      return { ok: false, from: state.currentVersion, to: migration.version, applied, rolledBack: toRollback.length > 0 };
    }

    state.applied.push({ version: migration.version, description: migration.description, appliedAt: Date.now() });
    state.currentVersion = migration.version;
  }

  saveState(state, statePath);
  return { ok: true, from: sorted[0].version, to: state.currentVersion, applied, rolledBack: false };
}

/**
 * Esegue migrazioni down fino alla versione target.
 */
export function migrateDown(
  migrations: Migration[],
  config: Record<string, unknown>,
  targetVersion: string,
  opts?: MigrationConfig,
): MigrationBatchResult {
  const statePath = opts?.statePath || DEFAULT_STATE_PATH;
  const state = loadState(statePath);
  const sorted = [...migrations].sort((a, b) => compareVersions(b.version, a.version));
  const toRevert = sorted.filter(m =>
    compareVersions(m.version, state.currentVersion) <= 0 &&
    compareVersions(m.version, targetVersion) > 0
  );

  if (toRevert.length === 0) {
    return { ok: true, from: state.currentVersion, to: state.currentVersion, applied: [], rolledBack: false };
  }

  const applied: MigrationResult[] = [];

  for (const migration of toRevert) {
    const result = runSingle(migration, config, 'down');
    applied.push(result);
    if (!result.success) {
      return { ok: false, from: state.currentVersion, to: targetVersion, applied, rolledBack: false };
    }
    state.applied = state.applied.filter(a => a.version !== migration.version);
    state.currentVersion = targetVersion;
  }

  saveState(state, statePath);
  return { ok: true, from: state.currentVersion, to: targetVersion, applied, rolledBack: false };
}

/** Ritorna le migrazioni pendenti (non ancora applicate) */
export function getPendingMigrations(migrations: Migration[], statePath?: string): Migration[] {
  const state = loadState(statePath);
  return migrations
    .filter(m => compareVersions(m.version, state.currentVersion) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

/** Ritorna la versione corrente */
export function getCurrentVersion(statePath?: string): string {
  return loadState(statePath).currentVersion;
}
