/**
 * Cache — Tipi per sistema cache in-memory
 */

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: number;
  accessedAt: number;
  /** Expiry timestamp (0 = no expiry) */
  expiresAt: number;
  /** Numero di accessi */
  hits: number;
  /** Dimensione stimata in byte (per budget) */
  size?: number;
}

export interface CacheConfig {
  /** Numero massimo di entry (default: 1000) */
  maxEntries?: number;
  /** TTL di default in ms (0 = no expiry, default: 300000 = 5min) */
  defaultTTL?: number;
  /** Callback invocata quando una entry viene rimossa */
  onEvict?: (key: string, reason: EvictReason) => void;
}

export type EvictReason = 'expired' | 'lru' | 'manual' | 'clear';

export interface CacheStats {
  /** Entry attualmente in cache */
  entries: number;
  /** Numero totale di hit */
  hits: number;
  /** Numero totale di miss */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Numero di eviction */
  evictions: number;
}

export interface CacheSetOptions {
  /** TTL custom per questa entry in ms (sovrascrive defaultTTL) */
  ttl?: number;
  /** Dimensione stimata in byte */
  size?: number;
}

export const DEFAULT_CACHE_CONFIG: Required<Pick<CacheConfig, 'maxEntries' | 'defaultTTL'>> = {
  maxEntries: 1000,
  defaultTTL: 5 * 60 * 1000, // 5 minuti
};
