/**
 * Backup — Backup automatico config e dati con retention
 */

export type {
  BackupEntry,
  BackupResult,
  RestoreResult,
  BackupConfig,
  BackupManifest,
  RetentionPolicy,
} from './types.js';
export { DEFAULT_BACKUP_CONFIG } from './types.js';

export {
  createBackup,
  restoreBackup,
  listBackups,
  applyRetention,
} from './runner.js';
