import { describe, it, expect, beforeEach, vi } from "vitest";
import { CacheManager } from "../../utils/cache";

describe("CacheManager", () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = CacheManager.getInstance();
    cacheManager.clearAll();
  });

  describe("getCachedAvailability", () => {
    it("should cache availability results with TTL", async () => {
      let callCount = 0;
      const checkFn = vi.fn(async () => {
        callCount++;
        return true;
      });

      const result1 = await cacheManager.getCachedAvailability(
        "npm",
        checkFn,
        1000,
      );
      const result2 = await cacheManager.getCachedAvailability(
        "npm",
        checkFn,
        1000,
      );

      expect(callCount).toBe(1); // Only called once, second was cached
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(checkFn).toHaveBeenCalledTimes(1);
    });

    it("should invalidate cache after TTL expires", async () => {
      let callCount = 0;
      const checkFn = vi.fn(async () => {
        callCount++;
        return true;
      });

      await cacheManager.getCachedAvailability("npm", checkFn, 100);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await cacheManager.getCachedAvailability("npm", checkFn, 100);

      expect(callCount).toBe(2); // Called twice due to TTL expiration
      expect(checkFn).toHaveBeenCalledTimes(2);
    });

    it("should cache different tools separately", async () => {
      const npmFn = vi.fn(async () => true);
      const dockerFn = vi.fn(async () => false);

      const npmResult = await cacheManager.getCachedAvailability(
        "npm",
        npmFn,
        1000,
      );
      const dockerResult = await cacheManager.getCachedAvailability(
        "docker",
        dockerFn,
        1000,
      );

      expect(npmResult).toBe(true);
      expect(dockerResult).toBe(false);
      expect(npmFn).toHaveBeenCalledTimes(1);
      expect(dockerFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("getCachedSize", () => {
    it("should cache directory sizes with TTL", async () => {
      const sizeFn = vi.fn(async () => 1024 * 1024); // 1MB

      const size1 = await cacheManager.getCachedSize(
        "/tmp/cache",
        sizeFn,
        1000,
      );
      const size2 = await cacheManager.getCachedSize(
        "/tmp/cache",
        sizeFn,
        1000,
      );

      expect(size1).toBe(1024 * 1024);
      expect(size2).toBe(1024 * 1024);
      expect(sizeFn).toHaveBeenCalledTimes(1); // Only called once
    });

    it("should invalidate size cache after TTL expires", async () => {
      const sizeFn = vi.fn(async () => 1024 * 1024);

      await cacheManager.getCachedSize("/tmp/cache", sizeFn, 50);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await cacheManager.getCachedSize("/tmp/cache", sizeFn, 50);

      expect(sizeFn).toHaveBeenCalledTimes(2);
    });

    it("should cache different paths separately", async () => {
      const sizeFn1 = vi.fn(async () => 1024);
      const sizeFn2 = vi.fn(async () => 2048);

      const size1 = await cacheManager.getCachedSize("/tmp/cache1", sizeFn1);
      const size2 = await cacheManager.getCachedSize("/tmp/cache2", sizeFn2);

      expect(size1).toBe(1024);
      expect(size2).toBe(2048);
    });
  });

  describe("invalidateSize", () => {
    it("should invalidate specific path cache", async () => {
      const sizeFn = vi.fn(async () => 1024);

      await cacheManager.getCachedSize("/tmp/cache", sizeFn);
      expect(sizeFn).toHaveBeenCalledTimes(1);

      cacheManager.invalidateSize("/tmp/cache");

      await cacheManager.getCachedSize("/tmp/cache", sizeFn);
      expect(sizeFn).toHaveBeenCalledTimes(2); // Called again after invalidation
    });
  });

  describe("invalidateSizePrefix", () => {
    it("should invalidate all paths with matching prefix", async () => {
      const sizeFn1 = vi.fn(async () => 1024);
      const sizeFn2 = vi.fn(async () => 2048);
      const sizeFn3 = vi.fn(async () => 4096);

      await cacheManager.getCachedSize("/tmp/cache/dir1", sizeFn1);
      await cacheManager.getCachedSize("/tmp/cache/dir2", sizeFn2);
      await cacheManager.getCachedSize("/other/path", sizeFn3);

      cacheManager.invalidateSizePrefix("/tmp/cache");

      await cacheManager.getCachedSize("/tmp/cache/dir1", sizeFn1);
      await cacheManager.getCachedSize("/tmp/cache/dir2", sizeFn2);
      await cacheManager.getCachedSize("/other/path", sizeFn3);

      expect(sizeFn1).toHaveBeenCalledTimes(2); // Invalidated
      expect(sizeFn2).toHaveBeenCalledTimes(2); // Invalidated
      expect(sizeFn3).toHaveBeenCalledTimes(1); // Not invalidated
    });
  });

  describe("clearAll", () => {
    it("should clear all caches", async () => {
      const availFn = vi.fn(async () => true);
      const sizeFn = vi.fn(async () => 1024);

      await cacheManager.getCachedAvailability("npm", availFn);
      await cacheManager.getCachedSize("/tmp/cache", sizeFn);

      const statsBefore = cacheManager.getStats();
      expect(statsBefore.availabilityCacheSize).toBe(1);
      expect(statsBefore.sizeCacheSize).toBe(1);

      cacheManager.clearAll();

      const statsAfter = cacheManager.getStats();
      expect(statsAfter.availabilityCacheSize).toBe(0);
      expect(statsAfter.sizeCacheSize).toBe(0);

      // Both should be called again after clear
      await cacheManager.getCachedAvailability("npm", availFn);
      await cacheManager.getCachedSize("/tmp/cache", sizeFn);

      expect(availFn).toHaveBeenCalledTimes(2);
      expect(sizeFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("getStats", () => {
    it("should return accurate cache statistics", async () => {
      const stats1 = cacheManager.getStats();
      expect(stats1.availabilityCacheSize).toBe(0);
      expect(stats1.sizeCacheSize).toBe(0);

      await cacheManager.getCachedAvailability("npm", async () => true);
      await cacheManager.getCachedAvailability("docker", async () => false);
      await cacheManager.getCachedSize("/tmp/cache1", async () => 1024);
      await cacheManager.getCachedSize("/tmp/cache2", async () => 2048);
      await cacheManager.getCachedSize("/tmp/cache3", async () => 4096);

      const stats2 = cacheManager.getStats();
      expect(stats2.availabilityCacheSize).toBe(2);
      expect(stats2.sizeCacheSize).toBe(3);
    });
  });

  describe("singleton pattern", () => {
    it("should return the same instance", () => {
      const instance1 = CacheManager.getInstance();
      const instance2 = CacheManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });
});
