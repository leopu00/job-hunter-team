/**
 * Migrations — Tipi per sistema migrazione config
 */

/** Singola migrazione con up/down */
export interface Migration {
  /** Versione target (es. "1.1.0") */
  version: string;
  /** Descrizione della migrazione */
  description: string;
  /** Applica la migrazione: riceve config, ritorna config modificata */
  up: (config: Record<string, unknown>) => Record<string, unknown>;
  /** Reverte la migrazione */
  down: (config: Record<string, unknown>) => Record<string, unknown>;
}

/** Risultato di una singola migrazione */
export interface MigrationResult {
  version: string;
  description: string;
  direction: 'up' | 'down';
  success: boolean;
  error?: string;
  durationMs: number;
}

/** Stato persistente delle migrazioni applicate */
export interface MigrationState {
  /** Versione corrente della config */
  currentVersion: string;
  /** Storico migrazioni applicate */
  applied: AppliedMigration[];
  /** Ultimo aggiornamento */
  updatedAt: number;
}

export interface AppliedMigration {
  version: string;
  description: string;
  appliedAt: number;
}

/** Configurazione del migration runner */
export interface MigrationConfig {
  /** Path del file di stato migrazioni (default: ~/.jht/migrations.json) */
  statePath?: string;
  /** Versione iniziale se nessuno stato esiste (default: "0.0.0") */
  initialVersion?: string;
  /** Se true, crea backup config prima di ogni migrazione */
  backup?: boolean;
}

export const DEFAULT_MIGRATION_CONFIG: Required<MigrationConfig> = {
  statePath: '',  // risolto a runtime
  initialVersion: '0.0.0',
  backup: true,
};

/** Risultato batch di migrazioni */
export interface MigrationBatchResult {
  ok: boolean;
  from: string;
  to: string;
  applied: MigrationResult[];
  rolledBack: boolean;
}
