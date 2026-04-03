/**
 * Registry centralizzato per i plugin JHT.
 *
 * Gestisce registrazione, lookup, abilitazione/disabilitazione,
 * e stato di tutti i plugin caricati nel sistema.
 */

import type {
  PluginDefinition,
  PluginManifest,
  PluginRecord,
  PluginStatus,
  PluginsConfig,
  DEFAULT_PLUGINS_CONFIG,
} from "./types.js";

// ── REGISTRY ───────────────────────────────────────────────

export interface PluginRegistry {
  readonly plugins: ReadonlyArray<PluginRecord>;
  readonly size: number;
  get(id: string): PluginRecord | undefined;
  has(id: string): boolean;
  getActive(): PluginRecord[];
  getByKind(kind: string): PluginRecord[];
  getByStatus(status: PluginStatus): PluginRecord[];
}

/** Crea un registry vuoto immutabile */
export function createEmptyRegistry(): PluginRegistry {
  return createRegistry([]);
}

/** Crea un registry da una lista di record plugin */
export function createRegistry(records: PluginRecord[]): PluginRegistry {
  const map = new Map<string, PluginRecord>();
  for (const record of records) {
    map.set(record.id, record);
  }

  return {
    plugins: Object.freeze([...records]),
    size: map.size,

    get(id: string) {
      return map.get(id);
    },

    has(id: string) {
      return map.has(id);
    },

    getActive() {
      return records.filter((r) => r.status === "active");
    },

    getByKind(kind: string) {
      return records.filter((r) => {
        const kinds = r.manifest.kind;
        if (!kinds) return false;
        return Array.isArray(kinds) ? kinds.includes(kind as never) : kinds === kind;
      });
    },

    getByStatus(status: PluginStatus) {
      return records.filter((r) => r.status === status);
    },
  };
}

// ── MUTABLE BUILDER ────────────────────────────────────────

/** Builder mutabile per costruire il registry durante il caricamento */
export class RegistryBuilder {
  private records = new Map<string, PluginRecord>();

  /** Registra un plugin scoperto (solo manifest, non ancora caricato) */
  addDiscovered(manifest: PluginManifest, rootDir: string): void {
    if (this.records.has(manifest.id)) return;
    this.records.set(manifest.id, {
      id: manifest.id,
      manifest,
      status: "discovered",
      rootDir,
    });
  }

  /** Aggiorna un plugin con la sua definizione dopo il caricamento */
  setLoaded(id: string, definition: PluginDefinition): void {
    const record = this.records.get(id);
    if (!record) return;
    record.definition = definition;
    record.status = "loaded";
    record.loadedAt = Date.now();
  }

  /** Segna un plugin come attivo dopo il setup */
  setActive(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.status = "active";
  }

  /** Segna un plugin come in errore */
  setError(id: string, error: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.status = "error";
    record.error = error;
  }

  /** Segna un plugin come disabilitato */
  setDisabled(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.status = "disabled";
  }

  /** Verifica se un plugin è abilitato dalla configurazione */
  isPluginEnabled(id: string, config: PluginsConfig): boolean {
    if (!config.enabled) return false;
    if (config.deny?.includes(id)) return false;
    if (config.allow && config.allow.length > 0) {
      return config.allow.includes(id);
    }
    const record = this.records.get(id);
    return record?.manifest.enabledByDefault !== false;
  }

  /** Costruisce il registry immutabile finale */
  build(): PluginRegistry {
    return createRegistry(Array.from(this.records.values()));
  }

  /** Numero di plugin nel builder */
  get size(): number {
    return this.records.size;
  }

  /** Verifica se un plugin esiste nel builder */
  has(id: string): boolean {
    return this.records.has(id);
  }
}

// ── SINGLETON ──────────────────────────────────────────────

let activeRegistry: PluginRegistry | null = null;

/** Imposta il registry attivo globale */
export function setActiveRegistry(registry: PluginRegistry): void {
  activeRegistry = registry;
}

/** Ottieni il registry attivo globale */
export function getActiveRegistry(): PluginRegistry | null {
  return activeRegistry;
}

/** Ottieni il registry attivo o lancia errore */
export function requireActiveRegistry(): PluginRegistry {
  if (!activeRegistry) {
    throw new Error("Plugin registry non inizializzato. Chiama loadPlugins() prima.");
  }
  return activeRegistry;
}

/** Reset del registry globale (utile per test) */
export function resetActiveRegistry(): void {
  activeRegistry = null;
}
