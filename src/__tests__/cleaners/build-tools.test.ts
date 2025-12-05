import { beforeEach, describe, expect, it } from 'vitest';
import WebpackCleaner from '../../cleaners/webpack.js';
import ViteCleaner from '../../cleaners/vite.js';
import NxCleaner from '../../cleaners/nx.js';
import TurboCleaner from '../../cleaners/turbo.js';
import GradleCleaner from '../../cleaners/gradle.js';
import FlutterCleaner from '../../cleaners/flutter.js';
import PlaywrightCleaner from '../../cleaners/playwright.js';

describe('Build Tool Cleaners', () => {
  describe('WebpackCleaner', () => {
    const cleaner = WebpackCleaner;

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('webpack');
      expect(cleaner.type).toBe('build-tool');
      expect(cleaner.description).toContain('Webpack');
    });

    it('should implement CleanerModule interface', () => {
      expect(typeof cleaner.isAvailable).toBe('function');
      expect(typeof cleaner.getCacheInfo).toBe('function');
      expect(typeof cleaner.clear).toBe('function');
    });

    it('should handle operations gracefully', async () => {
      const isAvailable = await cleaner.isAvailable();
      expect(typeof isAvailable).toBe('boolean');
      
      const cacheInfo = await cleaner.getCacheInfo();
      expect(cacheInfo.name).toBe('webpack');
      expect(cacheInfo.type).toBe('build-tool');
      expect(Array.isArray(cacheInfo.paths)).toBe(true);
      
      const result = await cleaner.clear(true);
      expect(result.name).toBe('webpack');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('ViteCleaner', () => {
    const cleaner = ViteCleaner;

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('vite');
      expect(cleaner.type).toBe('build-tool');
      expect(cleaner.description).toContain('Vite');
    });

    it('should implement CleanerModule interface', () => {
      expect(typeof cleaner.isAvailable).toBe('function');
      expect(typeof cleaner.getCacheInfo).toBe('function');
      expect(typeof cleaner.clear).toBe('function');
    });

    it('should handle operations gracefully', async () => {
      const isAvailable = await cleaner.isAvailable();
      expect(typeof isAvailable).toBe('boolean');
      
      const cacheInfo = await cleaner.getCacheInfo();
      expect(cacheInfo.name).toBe('vite');
      expect(cacheInfo.type).toBe('build-tool');
      
      const result = await cleaner.clear(true);
      expect(result.name).toBe('vite');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('NxCleaner', () => {
    const cleaner = NxCleaner;

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('nx');
      expect(cleaner.type).toBe('build-tool');
      expect(cleaner.description).toContain('NX');
    });

    it('should implement CleanerModule interface', () => {
      expect(typeof cleaner.isAvailable).toBe('function');
      expect(typeof cleaner.getCacheInfo).toBe('function');
      expect(typeof cleaner.clear).toBe('function');
    });

    it('should handle operations gracefully', async () => {
      const isAvailable = await cleaner.isAvailable();
      expect(typeof isAvailable).toBe('boolean');
      
      const cacheInfo = await cleaner.getCacheInfo();
      expect(cacheInfo.name).toBe('nx');
      expect(cacheInfo.type).toBe('build-tool');
      
      const result = await cleaner.clear(true);
      expect(result.name).toBe('nx');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('TurboCleaner', () => {
    const cleaner = TurboCleaner;

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('turbo');
      expect(cleaner.type).toBe('build-tool');
      expect(cleaner.description).toContain('Turbo');
    });

    it('should implement CleanerModule interface', () => {
      expect(typeof cleaner.isAvailable).toBe('function');
      expect(typeof cleaner.getCacheInfo).toBe('function');
      expect(typeof cleaner.clear).toBe('function');
    });

    it('should handle operations gracefully', async () => {
      const isAvailable = await cleaner.isAvailable();
      expect(typeof isAvailable).toBe('boolean');
      
      const cacheInfo = await cleaner.getCacheInfo();
      expect(cacheInfo.name).toBe('turbo');
      expect(cacheInfo.type).toBe('build-tool');
      
      const result = await cleaner.clear(true);
      expect(result.name).toBe('turbo');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('GradleCleaner', () => {
    const cleaner = GradleCleaner;

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('gradle');
      expect(cleaner.type).toBe('build-tool');
      expect(cleaner.description).toContain('Gradle');
    });

    it('should implement CleanerModule interface', () => {
      expect(typeof cleaner.isAvailable).toBe('function');
      expect(typeof cleaner.getCacheInfo).toBe('function');
      expect(typeof cleaner.clear).toBe('function');
    });

    it('should handle operations gracefully', async () => {
      const isAvailable = await cleaner.isAvailable();
      expect(typeof isAvailable).toBe('boolean');
      
      const cacheInfo = await cleaner.getCacheInfo();
      expect(cacheInfo.name).toBe('gradle');
      expect(cacheInfo.type).toBe('build-tool');
      
      const result = await cleaner.clear(true);
      expect(result.name).toBe('gradle');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('FlutterCleaner', () => {
    const cleaner = FlutterCleaner;

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('flutter');
      expect(cleaner.type).toBe('build-tool');
      expect(cleaner.description).toContain('Flutter');
    });

    it('should implement CleanerModule interface', () => {
      expect(typeof cleaner.isAvailable).toBe('function');
      expect(typeof cleaner.getCacheInfo).toBe('function');
      expect(typeof cleaner.clear).toBe('function');
    });

    it('should handle operations gracefully', async () => {
      const isAvailable = await cleaner.isAvailable();
      expect(typeof isAvailable).toBe('boolean');

      const cacheInfo = await cleaner.getCacheInfo();
      expect(cacheInfo.name).toBe('flutter');
      expect(cacheInfo.type).toBe('build-tool');

      const result = await cleaner.clear(true);
      expect(result.name).toBe('flutter');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('PlaywrightCleaner', () => {
    const cleaner = PlaywrightCleaner;

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('playwright');
      expect(cleaner.type).toBe('build-tool');
      expect(cleaner.description).toContain('Playwright');
    });

    it('should implement CleanerModule interface', () => {
      expect(typeof cleaner.isAvailable).toBe('function');
      expect(typeof cleaner.getCacheInfo).toBe('function');
      expect(typeof cleaner.clear).toBe('function');
    });

    it('should handle operations gracefully', async () => {
      const isAvailable = await cleaner.isAvailable();
      expect(typeof isAvailable).toBe('boolean');

      const cacheInfo = await cleaner.getCacheInfo();
      expect(cacheInfo.name).toBe('playwright');
      expect(cacheInfo.type).toBe('build-tool');
      expect(Array.isArray(cacheInfo.paths)).toBe(true);

      const result = await cleaner.clear(true);
      expect(result.name).toBe('playwright');
      expect(typeof result.success).toBe('boolean');
    });
  });
});
