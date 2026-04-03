/**
 * Cache — LRU con TTL e invalidazione
 */
import type { CacheEntry, CacheConfig, CacheStats, CacheSetOptions, EvictReason } from './types.js';
import { DEFAULT_CACHE_CONFIG } from './types.js';

export class LRUCache<T = unknown> {
  private entries = new Map<string, CacheEntry<T>>();
  private maxEntries: number;
  private defaultTTL: number;
  private onEvict?: (key: string, reason: EvictReason) => void;

  private totalHits = 0;
  private totalMisses = 0;
  private totalEvictions = 0;

  constructor(config?: CacheConfig) {
    this.maxEntries = config?.maxEntries ?? DEFAULT_CACHE_CONFIG.maxEntries;
    this.defaultTTL = config?.defaultTTL ?? DEFAULT_CACHE_CONFIG.defaultTTL;
    this.onEvict = config?.onEvict;
  }

  /** Inserisce o aggiorna una entry. */
  set(key: string, value: T, opts?: CacheSetOptions): void {
    // Se esiste, rimuovi per reinserire in fondo (piu' recente)
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    // Evict LRU se al limite
    while (this.entries.size >= this.maxEntries) {
      this.evictLRU();
    }

    const ttl = opts?.ttl ?? this.defaultTTL;
    const now = Date.now();

    this.entries.set(key, {
      key,
      value,
      createdAt: now,
      accessedAt: now,
      expiresAt: ttl > 0 ? now + ttl : 0,
      hits: 0,
      size: opts?.size,
    });
  }

  /** Recupera una entry. Ritorna undefined se non trovata o scaduta. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      this.totalMisses++;
      return undefined;
    }

    // Controlla TTL
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.remove(key, 'expired');
      this.totalMisses++;
      return undefined;
    }

    // Aggiorna accesso (move-to-end per LRU)
    entry.accessedAt = Date.now();
    entry.hits++;
    this.entries.delete(key);
    this.entries.set(key, entry);

    this.totalHits++;
    return entry.value;
  }

  /** Verifica se una chiave esiste e non e' scaduta. */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.remove(key, 'expired');
      return false;
    }
    return true;
  }

  /** Rimuove una entry per chiave. */
  delete(key: string): boolean {
    return this.remove(key, 'manual');
  }

  /** Invalida tutte le chiavi che matchano un prefisso. */
  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.remove(key, 'manual');
        count++;
      }
    }
    return count;
  }

  /** Invalida chiavi che matchano un pattern (RegExp). */
  invalidateByPattern(pattern: RegExp): number {
    let count = 0;
    for (const key of [...this.entries.keys()]) {
      if (pattern.test(key)) {
        this.remove(key, 'manual');
        count++;
      }
    }
    return count;
  }

  /** Rimuove tutte le entry scadute. */
  purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this.remove(key, 'expired');
        count++;
      }
    }
    return count;
  }

  /** Svuota tutta la cache. */
  clear(): void {
    if (this.onEvict) {
      for (const key of this.entries.keys()) {
        this.onEvict(key, 'clear');
      }
    }
    this.entries.clear();
  }

  /** Numero di entry in cache. */
  get size(): number {
    return this.entries.size;
  }

  /** Tutte le chiavi in cache. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Statistiche della cache. */
  stats(): CacheStats {
    const total = this.totalHits + this.totalMisses;
    return {
      entries: this.entries.size,
      hits: this.totalHits,
      misses: this.totalMisses,
      hitRate: total > 0 ? this.totalHits / total : 0,
      evictions: this.totalEvictions,
    };
  }

  /** Reset delle statistiche. */
  resetStats(): void {
    this.totalHits = 0;
    this.totalMisses = 0;
    this.totalEvictions = 0;
  }

  // --- Internals ---

  private remove(key: string, reason: EvictReason): boolean {
    const existed = this.entries.delete(key);
    if (existed) {
      this.totalEvictions++;
      this.onEvict?.(key, reason);
    }
    return existed;
  }

  private evictLRU(): void {
    // Map mantiene ordine di inserimento — il primo e' il meno recente
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) {
      this.remove(oldest, 'lru');
    }
  }
}
