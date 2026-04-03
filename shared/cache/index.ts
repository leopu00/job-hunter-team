/**
 * Cache — Sistema cache in-memory con TTL e LRU eviction
 */

export type {
  CacheEntry,
  CacheConfig,
  CacheStats,
  CacheSetOptions,
  EvictReason,
} from './types.js';
export { DEFAULT_CACHE_CONFIG } from './types.js';

export { LRUCache } from './lru-cache.js';
