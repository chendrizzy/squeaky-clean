import { describe, it, expect, beforeAll } from "vitest";
import { CacheManager } from "../cleaners/index.js";
import {
  MockCacheManager,
  shouldRunFullTests,
  mockSummary,
} from "./mocks/mockCleaners.js";

/**
 * Integration Tests
 *
 * By default, uses MockCacheManager for fast testing (~1-2 seconds total).
 * Set FULL_INTEGRATION_TESTS=true to run with real CacheManager (~10-15 minutes).
 *
 * Example: FULL_INTEGRATION_TESTS=true npm test -- --run src/test/integration.test.ts
 */

const isFullTest = shouldRunFullTests();
type AnyManager = CacheManager | MockCacheManager;

describe("Integration Tests", () => {
  let cacheManager: AnyManager;

  // Use beforeAll instead of beforeEach to share state and avoid rescanning
  beforeAll(() => {
    if (isFullTest) {
      console.log("🔬 Running FULL integration tests with real filesystem...");
      cacheManager = new CacheManager();
    } else {
      console.log("⚡ Running FAST integration tests with mocks...");
      cacheManager = new MockCacheManager();
    }
  });

  describe("Basic CacheManager Integration", () => {
    it("should create a CacheManager with registered cleaners", () => {
      const allCleaners = cacheManager.getAllCleaners();
      expect(allCleaners.length).toBeGreaterThan(0);

      const types = allCleaners.map((c) => c.type);
      if (isFullTest) {
        expect(types).toContain("package-manager");
        expect(types).toContain("system");
      } else {
        // Mock has specific types
        expect(types).toContain("package-manager");
        expect(types).toContain("system");
        expect(types).toContain("build-tool");
      }
    });

    it(
      "should get cache info for all enabled cleaners",
      async () => {
        const cacheInfo = await cacheManager.getAllCacheInfo();
        expect(Array.isArray(cacheInfo)).toBe(true);
        expect(cacheInfo.length).toBeGreaterThan(0);

        cacheInfo.forEach((info) => {
          expect(info).toHaveProperty("name");
          expect(info).toHaveProperty("type");
          expect(info).toHaveProperty("description");
          expect(info).toHaveProperty("paths");
          expect(info).toHaveProperty("isInstalled");
          if (info.size !== undefined) {
            expect(typeof info.size).toBe("number");
          }
        });
      },
      isFullTest ? 60000 : 1000,
    );

    it(
      "should get cache sizes by type",
      async () => {
        const sizesByType = await cacheManager.getCacheSizesByType();

        expect(typeof sizesByType).toBe("object");
        expect(sizesByType).toHaveProperty("package-manager");
        expect(sizesByType).toHaveProperty("build-tool");
        expect(sizesByType).toHaveProperty("browser");
        expect(sizesByType).toHaveProperty("ide");
        expect(sizesByType).toHaveProperty("system");
        expect(sizesByType).toHaveProperty("other");

        Object.values(sizesByType).forEach((size) => {
          expect(typeof size).toBe("number");
          expect(size).toBeGreaterThanOrEqual(0);
        });
      },
      isFullTest ? 120000 : 1000,
    );

    it(
      "should get summary statistics",
      async () => {
        const summary = await cacheManager.getSummary();

        expect(summary).toHaveProperty("totalSize");
        expect(summary).toHaveProperty("totalCleaners");
        expect(summary).toHaveProperty("installedCleaners");
        expect(summary).toHaveProperty("enabledCleaners");
        expect(summary).toHaveProperty("sizesByType");

        expect(typeof summary.totalSize).toBe("number");
        expect(typeof summary.totalCleaners).toBe("number");
        expect(typeof summary.installedCleaners).toBe("number");
        expect(typeof summary.enabledCleaners).toBe("number");
        expect(typeof summary.sizesByType).toBe("object");

        expect(summary.totalCleaners).toBeGreaterThan(0);
        expect(summary.enabledCleaners).toBeGreaterThan(0);
      },
      isFullTest ? 60000 : 1000,
    );

    it(
      "should perform dry run cleaning",
      async () => {
        const results = await cacheManager.cleanAllCaches({ dryRun: true });

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        results.forEach((result) => {
          expect(result).toHaveProperty("name");
          expect(result).toHaveProperty("success");
          expect(typeof result.name).toBe("string");
          expect(typeof result.success).toBe("boolean");
        });
      },
      isFullTest ? 60000 : 1000,
    );

    it(
      "should filter cleaning by types",
      async () => {
        const packageManagerResults = await cacheManager.cleanAllCaches({
          dryRun: true,
          types: ["package-manager"],
        });

        expect(Array.isArray(packageManagerResults)).toBe(true);

        const packageManagerCleaners =
          cacheManager.getCleanersByType("package-manager");
        if (packageManagerResults.length > 0) {
          expect(packageManagerResults.length).toBeLessThanOrEqual(
            packageManagerCleaners.length,
          );
        }
      },
      isFullTest ? 120000 : 1000,
    );

    it(
      "should exclude specific tools from cleaning",
      async () => {
        const allResults = await cacheManager.cleanAllCaches({ dryRun: true });
        const excludeDockerResults = await cacheManager.cleanAllCaches({
          dryRun: true,
          exclude: ["docker"],
        });

        expect(Array.isArray(allResults)).toBe(true);
        expect(Array.isArray(excludeDockerResults)).toBe(true);

        const hasDockerInExcluded = excludeDockerResults.some(
          (r) => r.name === "docker",
        );
        expect(hasDockerInExcluded).toBe(false);

        expect(excludeDockerResults.length).toBeLessThanOrEqual(
          allResults.length,
        );
      },
      isFullTest ? 180000 : 1000,
    );

    it("should handle cleaner filtering by name", () => {
      const docker = cacheManager.getCleaner("docker");
      expect(docker).toBeDefined();
      expect(docker?.name).toBe("docker");

      const nonExistent = cacheManager.getCleaner("nonexistent");
      expect(nonExistent).toBeUndefined();
    });

    it("should handle cleaner filtering by type", () => {
      const packageManagers = cacheManager.getCleanersByType("package-manager");
      expect(packageManagers.length).toBeGreaterThan(0);
      expect(packageManagers.every((c) => c.type === "package-manager")).toBe(
        true,
      );

      if (isFullTest) {
        // Real manager has system tools
        const systemTools = cacheManager.getCleanersByType("system");
        expect(systemTools.length).toBeGreaterThan(0);
        expect(systemTools.every((c) => c.type === "system")).toBe(true);
      }
    });

    it("should handle enabled cleaners correctly", () => {
      const enabledCleaners = cacheManager.getEnabledCleaners();
      expect(Array.isArray(enabledCleaners)).toBe(true);
      expect(enabledCleaners.length).toBeGreaterThan(0);

      const allCleaners = cacheManager.getAllCleaners();
      enabledCleaners.forEach((enabled) => {
        expect(allCleaners.some((all) => all.name === enabled.name)).toBe(true);
      });
    });
  });

  describe("Cross-platform Compatibility", () => {
    it(
      "should handle different cache types on different platforms",
      async () => {
        const summary = await cacheManager.getSummary();

        expect(summary.totalCleaners).toBeGreaterThan(0);
        expect(summary.sizesByType).toHaveProperty("package-manager");
        expect(summary.sizesByType).toHaveProperty("system");
      },
      isFullTest ? 60000 : 1000,
    );

    it(
      "should handle concurrent operations safely",
      async () => {
        const promises = [
          cacheManager.getAllCacheInfo(),
          cacheManager.getCacheSizesByType(),
          cacheManager.getSummary(),
          cacheManager.cleanAllCaches({ dryRun: true }),
        ];

        const results = await Promise.all(promises);

        expect(Array.isArray(results[0])).toBe(true);
        expect(typeof results[1]).toBe("object");
        expect(results[2]).toHaveProperty("totalSize");
        expect(Array.isArray(results[3])).toBe(true);
      },
      isFullTest ? 180000 : 1000,
    );
  });

  describe("Error Handling", () => {
    it(
      "should handle errors gracefully during cache info gathering",
      async () => {
        const cacheInfo = await cacheManager.getAllCacheInfo();
        expect(Array.isArray(cacheInfo)).toBe(true);
      },
      isFullTest ? 60000 : 1000,
    );

    it(
      "should handle errors gracefully during cleaning",
      async () => {
        const results = await cacheManager.cleanAllCaches({ dryRun: true });
        expect(Array.isArray(results)).toBe(true);
      },
      isFullTest ? 120000 : 1000,
    );

    it(
      "should handle empty results gracefully",
      async () => {
        const summary = await cacheManager.getSummary();
        expect(summary.totalSize).toBeGreaterThanOrEqual(0);
        expect(summary.totalCleaners).toBeGreaterThan(0);
        expect(summary.installedCleaners).toBeGreaterThanOrEqual(0);
        expect(summary.enabledCleaners).toBeGreaterThan(0);
      },
      isFullTest ? 60000 : 1000,
    );
  });

  describe("Performance", () => {
    it(
      "should complete operations in reasonable time",
      async () => {
        const start = Date.now();

        await cacheManager.getAllCacheInfo();
        await cacheManager.getCacheSizesByType();
        await cacheManager.getSummary();
        await cacheManager.cleanAllCaches({ dryRun: true });

        const duration = Date.now() - start;

        if (isFullTest) {
          expect(duration).toBeLessThan(180000);
        } else {
          // Mock should be nearly instant
          expect(duration).toBeLessThan(1000);
        }
      },
      isFullTest ? 180000 : 2000,
    );

    it(
      "should handle repeated operations without memory leaks",
      async () => {
        const memoryBefore = process.memoryUsage().heapUsed;

        const iterations = isFullTest ? 2 : 10;
        for (let i = 0; i < iterations; i++) {
          await cacheManager.getAllCacheInfo();
          await cacheManager.cleanAllCaches({ dryRun: true });
        }

        const memoryAfter = process.memoryUsage().heapUsed;
        const memoryIncrease = memoryAfter - memoryBefore;

        expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
      },
      isFullTest ? 360000 : 2000,
    );
  });
});
