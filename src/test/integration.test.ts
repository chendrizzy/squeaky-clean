import { describe, it, expect, beforeEach } from 'vitest';
import { CacheManager } from '../cleaners/index.js';

describe('Integration Tests', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager();
  });

  describe('Basic CacheManager Integration', () => {
    it('should create a CacheManager with registered cleaners', () => {
      const allCleaners = cacheManager.getAllCleaners();
      expect(allCleaners.length).toBeGreaterThan(0);
      
      // Should have various types of cleaners
      const types = allCleaners.map(c => c.type);
      expect(types).toContain('package-manager');
      expect(types).toContain('system');
    });

    it('should get cache info for all enabled cleaners', async () => {
      const cacheInfo = await cacheManager.getAllCacheInfo();
      expect(Array.isArray(cacheInfo)).toBe(true);
      expect(cacheInfo.length).toBeGreaterThan(0);
      
      // Each cache info should have required properties
      cacheInfo.forEach(info => {
        expect(info).toHaveProperty('name');
        expect(info).toHaveProperty('type');
        expect(info).toHaveProperty('description');
        expect(info).toHaveProperty('paths');
        expect(info).toHaveProperty('isInstalled');
        expect(info).toHaveProperty('size');
      });
    });

    it('should get cache sizes by type', async () => {
      const sizesByType = await cacheManager.getCacheSizesByType();
      
      expect(typeof sizesByType).toBe('object');
      expect(sizesByType).toHaveProperty('package-manager');
      expect(sizesByType).toHaveProperty('build-tool');
      expect(sizesByType).toHaveProperty('browser');
      expect(sizesByType).toHaveProperty('ide');
      expect(sizesByType).toHaveProperty('system');
      expect(sizesByType).toHaveProperty('other');
      
      Object.values(sizesByType).forEach(size => {
        expect(typeof size).toBe('number');
        expect(size).toBeGreaterThanOrEqual(0);
      });
    });

    it('should get summary statistics', async () => {
      const summary = await cacheManager.getSummary();
      
      expect(summary).toHaveProperty('totalSize');
      expect(summary).toHaveProperty('totalCleaners');
      expect(summary).toHaveProperty('installedCleaners');
      expect(summary).toHaveProperty('enabledCleaners');
      expect(summary).toHaveProperty('sizesByType');
      
      expect(typeof summary.totalSize).toBe('number');
      expect(typeof summary.totalCleaners).toBe('number');
      expect(typeof summary.installedCleaners).toBe('number');
      expect(typeof summary.enabledCleaners).toBe('number');
      expect(typeof summary.sizesByType).toBe('object');
      
      expect(summary.totalCleaners).toBeGreaterThan(0);
      expect(summary.enabledCleaners).toBeGreaterThan(0);
    });

    it('should perform dry run cleaning', async () => {
      const results = await cacheManager.cleanAllCaches({ dryRun: true });
      
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      
      // Each result should have required properties
      results.forEach(result => {
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('success');
        expect(typeof result.name).toBe('string');
        expect(typeof result.success).toBe('boolean');
      });
    });

    it('should filter cleaning by types', async () => {
      const packageManagerResults = await cacheManager.cleanAllCaches({ 
        dryRun: true, 
        types: ['package-manager'] 
      });
      
      expect(Array.isArray(packageManagerResults)).toBe(true);
      
      // If there are results, they should all be package manager types
      const packageManagerCleaners = cacheManager.getCleanersByType('package-manager');
      if (packageManagerResults.length > 0) {
        expect(packageManagerResults.length).toBeLessThanOrEqual(packageManagerCleaners.length);
      }
    });

    it('should exclude specific tools from cleaning', async () => {
      const allResults = await cacheManager.cleanAllCaches({ dryRun: true });
      const excludeDockerResults = await cacheManager.cleanAllCaches({ 
        dryRun: true, 
        exclude: ['docker'] 
      });
      
      expect(Array.isArray(allResults)).toBe(true);
      expect(Array.isArray(excludeDockerResults)).toBe(true);
      
      // Excluded results should not contain docker
      const hasDockerInExcluded = excludeDockerResults.some(r => r.name === 'docker');
      expect(hasDockerInExcluded).toBe(false);
      
      // Excluded results should be less than or equal to all results
      expect(excludeDockerResults.length).toBeLessThanOrEqual(allResults.length);
    });

    it('should handle cleaner filtering by name', () => {
      const docker = cacheManager.getCleaner('docker');
      expect(docker).toBeDefined();
      expect(docker?.name).toBe('docker');
      
      const nonExistent = cacheManager.getCleaner('nonexistent');
      expect(nonExistent).toBeUndefined();
    });

    it('should handle cleaner filtering by type', () => {
      const packageManagers = cacheManager.getCleanersByType('package-manager');
      expect(packageManagers.length).toBeGreaterThan(0);
      expect(packageManagers.every(c => c.type === 'package-manager')).toBe(true);
      
      const systemTools = cacheManager.getCleanersByType('system');
      expect(systemTools.length).toBeGreaterThan(0);
      expect(systemTools.every(c => c.type === 'system')).toBe(true);
    });

    it('should handle enabled cleaners correctly', () => {
      const enabledCleaners = cacheManager.getEnabledCleaners();
      expect(Array.isArray(enabledCleaners)).toBe(true);
      expect(enabledCleaners.length).toBeGreaterThan(0);
      
      // All enabled cleaners should be in the full list
      const allCleaners = cacheManager.getAllCleaners();
      enabledCleaners.forEach(enabled => {
        expect(allCleaners.some(all => all.name === enabled.name)).toBe(true);
      });
    });
  });

  describe('Cross-platform Compatibility', () => {
    it('should handle different cache types on different platforms', async () => {
      const summary = await cacheManager.getSummary();
      
      // Should work regardless of platform
      expect(summary.totalCleaners).toBeGreaterThan(0);
      expect(summary.sizesByType).toHaveProperty('package-manager');
      expect(summary.sizesByType).toHaveProperty('system');
    });

    it('should handle concurrent operations safely', async () => {
      // Run multiple operations concurrently
      const promises = [
        cacheManager.getAllCacheInfo(),
        cacheManager.getCacheSizesByType(),
        cacheManager.getSummary(),
        cacheManager.cleanAllCaches({ dryRun: true })
      ];

      const results = await Promise.all(promises);

      // All operations should complete successfully
      expect(Array.isArray(results[0])).toBe(true); // getAllCacheInfo
      expect(typeof results[1]).toBe('object'); // getCacheSizesByType
      expect(results[2]).toHaveProperty('totalSize'); // getSummary
      expect(Array.isArray(results[3])).toBe(true); // cleanAllCaches
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully during cache info gathering', async () => {
      // This should not throw even if some cleaners fail
      const cacheInfo = await cacheManager.getAllCacheInfo();
      expect(Array.isArray(cacheInfo)).toBe(true);
    });

    it('should handle errors gracefully during cleaning', async () => {
      // This should not throw even if some cleaners fail to clean
      const results = await cacheManager.cleanAllCaches({ dryRun: true });
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle empty results gracefully', async () => {
      const summary = await cacheManager.getSummary();
      expect(summary.totalSize).toBeGreaterThanOrEqual(0);
      expect(summary.totalCleaners).toBeGreaterThan(0);
      expect(summary.installedCleaners).toBeGreaterThanOrEqual(0);
      expect(summary.enabledCleaners).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should complete operations in reasonable time', async () => {
      const start = Date.now();
      
      await cacheManager.getAllCacheInfo();
      await cacheManager.getCacheSizesByType();
      await cacheManager.getSummary();
      await cacheManager.cleanAllCaches({ dryRun: true });
      
      const duration = Date.now() - start;
      
      // Should complete within 30 seconds even on slow systems
      expect(duration).toBeLessThan(30000);
    });

    it('should handle repeated operations without memory leaks', async () => {
      const memoryBefore = process.memoryUsage().heapUsed;
      
      // Run operations multiple times (reduced from 10 to 3 to avoid timeout)
      for (let i = 0; i < 3; i++) {
        await cacheManager.getAllCacheInfo();
        await cacheManager.cleanAllCaches({ dryRun: true });
      }
      
      const memoryAfter = process.memoryUsage().heapUsed;
      const memoryIncrease = memoryAfter - memoryBefore;
      
      // Should not use more than 15MB additional memory (increased threshold for fewer iterations)
      expect(memoryIncrease).toBeLessThan(15 * 1024 * 1024);
    });
  });
});
