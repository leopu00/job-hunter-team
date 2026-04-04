/**
 * Migrations — Sistema migrazione config tra versioni
 */

export type {
  Migration,
  MigrationResult,
  MigrationState,
  MigrationConfig,
  MigrationBatchResult,
  AppliedMigration,
} from './types.js';
export { DEFAULT_MIGRATION_CONFIG } from './types.js';

export {
  loadState,
  saveState,
  compareVersions,
  migrateUp,
  migrateDown,
  getPendingMigrations,
  getCurrentVersion,
} from './runner.js';
