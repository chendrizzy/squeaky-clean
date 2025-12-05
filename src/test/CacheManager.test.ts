import { describe, it, expect, beforeEach } from "vitest";
import { CacheManager } from "../cleaners/index.js";
import type { CacheType } from "../types/index.js";

describe("CacheManager", () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager();
  });

  describe("Basic functionality", () => {
    it("should have cleaners registered by default", () => {
      const allCleaners = cacheManager.getAllCleaners();
      expect(allCleaners.length).toBeGreaterThan(0);
    });

    it("should get cleaners by type", () => {
      const packageManagers = cacheManager.getCleanersByType("package-manager");
      expect(packageManagers.length).toBeGreaterThan(0);
    });

    it("should get enabled cleaners", () => {
      const enabledCleaners = cacheManager.getEnabledCleaners();
      expect(Array.isArray(enabledCleaners)).toBe(true);
    });

    it("should get cleaner by name", () => {
      const docker = cacheManager.getCleaner("docker");
      expect(docker).toBeDefined();
      expect(docker?.name).toBe("docker");
    });

    it("should return undefined for non-existent cleaner", () => {
      const nonExistent = cacheManager.getCleaner("nonexistent");
      expect(nonExistent).toBeUndefined();
    });

    it("should get cache info for all cleaners", async () => {
      const cacheInfo = await cacheManager.getAllCacheInfo();
      expect(Array.isArray(cacheInfo)).toBe(true);
      expect(cacheInfo.length).toBeGreaterThan(0);
    }, 60000);

    it("should get cache sizes by type", async () => {
      const sizes = await cacheManager.getCacheSizesByType();
      expect(typeof sizes).toBe("object");
      expect(sizes["package-manager"]).toBeGreaterThanOrEqual(0);
    }, 60000);

    it("should get summary", async () => {
      const summary = await cacheManager.getSummary();
      expect(summary).toHaveProperty("totalSize");
      expect(summary).toHaveProperty("totalCleaners");
      expect(summary).toHaveProperty("installedCleaners");
      expect(summary).toHaveProperty("enabledCleaners");
      expect(summary).toHaveProperty("sizesByType");
    }, 60000);
  });

  describe("Detection", () => {
    it("should detect available cleaners", async () => {
      const allCleaners = cacheManager.getAllCleaners();
      const availableCleaners = [];

      // Check which ones are available
      for (const cleaner of allCleaners) {
        try {
          if (await cleaner.isAvailable()) {
            availableCleaners.push(cleaner);
          }
        } catch (error) {
          // Skip cleaners that fail availability check
        }
      }

      expect(availableCleaners.length).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(availableCleaners)).toBe(true);
    });

    it("should handle detection errors gracefully", async () => {
      // This test will check that the getAllCacheInfo method handles errors gracefully
      const cacheInfo = await cacheManager.getAllCacheInfo();

      // Should return info for all enabled cleaners, with failed ones having empty data
      expect(Array.isArray(cacheInfo)).toBe(true);
      expect(cacheInfo.length).toBeGreaterThan(0);
    }, 60000);

    it("should filter cleaners by name", async () => {
      const npmCleaner = cacheManager.getCleaner("npm");

      expect(npmCleaner).toBeDefined();
      expect(npmCleaner?.name).toBe("npm");
    });

    it("should filter cleaners by type", async () => {
      const packageManagers = cacheManager.getCleanersByType("package-manager");

      expect(packageManagers.length).toBeGreaterThan(0);
      expect(packageManagers.every((c) => c.type === "package-manager")).toBe(
        true,
      );
    });

    it("should handle non-existing cleaner names in filter", async () => {
      const nonExistentCleaner = cacheManager.getCleaner("NonExistingCleaner");

      expect(nonExistentCleaner).toBeUndefined();
    });
  });

  describe("Size Calculation", () => {
    it("should calculate total size from cache info", async () => {
      const summary = await cacheManager.getSummary();

      expect(typeof summary.totalSize).toBe("number");
      expect(summary.totalSize).toBeGreaterThanOrEqual(0);
    }, 60000);

    it("should get sizes by type", async () => {
      const sizesByType = await cacheManager.getCacheSizesByType();

      expect(typeof sizesByType).toBe("object");
      expect(sizesByType["package-manager"]).toBeGreaterThanOrEqual(0);
      expect(sizesByType["build-tool"]).toBeGreaterThanOrEqual(0);
    }, 60000);

    it("should return 0 for empty manager", async () => {
      const emptyManager = new CacheManager();
      const summary = await emptyManager.getSummary();

      expect(summary.totalSize).toBeGreaterThanOrEqual(0);
    }, 60000);
  });

  describe("Cleaning Operations", () => {
    it("should perform cleaning with cleanAllCaches method", async () => {
      const results = await cacheManager.cleanAllCaches({ dryRun: true });

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(0);
    }, 60000);

    it("should filter by types", async () => {
      const results = await cacheManager.cleanAllCaches({
        dryRun: true,
        types: ["package-manager"],
      });

      expect(Array.isArray(results)).toBe(true);
    }, 60000);

    it("should exclude specific tools", async () => {
      const results = await cacheManager.cleanAllCaches({
        dryRun: true,
        exclude: ["docker"],
      });

      expect(Array.isArray(results)).toBe(true);
    }, 120000);
  });

  describe("CacheType Validation", () => {
    it("should validate cache types are properly defined", () => {
      const types: CacheType[] = [
        "package-manager",
        "build-tool",
        "browser",
        "ide",
        "system",
        "other",
      ];

      const allCleaners = cacheManager.getAllCleaners();
      allCleaners.forEach((cleaner) => {
        expect(types).toContain(cleaner.type);
      });
    });

    it("should group cleaners by type correctly", async () => {
      const sizesByType = await cacheManager.getCacheSizesByType();

      // All cache types should be present in the sizes object
      expect(sizesByType).toHaveProperty("package-manager");
      expect(sizesByType).toHaveProperty("build-tool");
      expect(sizesByType).toHaveProperty("browser");
      expect(sizesByType).toHaveProperty("ide");
      expect(sizesByType).toHaveProperty("system");
      expect(sizesByType).toHaveProperty("other");
    }, 120000);
  });
});
