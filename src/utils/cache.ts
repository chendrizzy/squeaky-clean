/**
 * Central cache manager for performance optimization
 * Provides TTL-based caching with invalidation hooks
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

export class CacheManager {
  private static instance: CacheManager;

  private availabilityCache = new Map<string, CacheEntry<boolean>>();
  private sizeCache = new Map<string, CacheEntry<number>>();

  private constructor() {}

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  /**
   * Get cached availability with TTL (default: 5 minutes)
   */
  async getCachedAvailability(
    tool: string,
    checkFn: () => Promise<boolean>,
    ttl: number = 300000
  ): Promise<boolean> {
    const cached = this.availabilityCache.get(tool);

    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.value;
    }

    const value = await checkFn();
    this.availabilityCache.set(tool, { value, timestamp: Date.now() });
    return value;
  }

  /**
   * Get cached directory size with TTL (default: 2 minutes)
   */
  async getCachedSize(
    path: string,
    sizeFn: () => Promise<number>,
    ttl: number = 120000
  ): Promise<number> {
    const cached = this.sizeCache.get(path);

    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.value;
    }

    const value = await sizeFn();
    this.sizeCache.set(path, { value, timestamp: Date.now() });
    return value;
  }

  /**
   * Invalidate size cache for path (call after clear operations)
   */
  invalidateSize(path: string): void {
    this.sizeCache.delete(path);
  }

  /**
   * Invalidate all size caches matching a prefix
   */
  invalidateSizePrefix(prefix: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.sizeCache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.sizeCache.delete(key));
  }

  /**
   * Clear all caches (use with --refresh flag)
   */
  clearAll(): void {
    this.availabilityCache.clear();
    this.sizeCache.clear();
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): {
    availabilityCacheSize: number;
    sizeCacheSize: number;
  } {
    return {
      availabilityCacheSize: this.availabilityCache.size,
      sizeCacheSize: this.sizeCache.size,
    };
  }
}

export const cacheManager = CacheManager.getInstance();

/**
 * Check tool availability with caching (5-minute TTL by default)
 * Use this in cleaner isAvailable() methods to avoid repeated command executions
 *
 * @param toolName - Unique identifier for the tool (e.g., 'npm', 'docker')
 * @param checkFn - Async function that returns true if tool is available
 * @param ttl - Time-to-live in milliseconds (default: 5 minutes)
 * @returns Promise<boolean> - Whether the tool is available
 *
 * @example
 * async isAvailable(): Promise<boolean> {
 *   return checkToolAvailability('npm', async () => {
 *     await execa('npm', ['--version']);
 *     return true;
 *   });
 * }
 */
export async function checkToolAvailability(
  toolName: string,
  checkFn: () => Promise<boolean>,
  ttl: number = 300000,
): Promise<boolean> {
  return cacheManager.getCachedAvailability(toolName, checkFn, ttl);
}
