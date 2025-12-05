import { beforeEach, describe, expect, it } from 'vitest';
import { VSCodeCleaner } from '../../cleaners/vscode.js';
import { XcodeCleaner } from '../../cleaners/xcode.js';
import AndroidStudioCleaner from '../../cleaners/androidstudio.js';
import JetBrainsCleaner from '../../cleaners/jetbrains.js';
import WindsurfCleaner from '../../cleaners/windsurf.js';
import CursorCleaner from '../../cleaners/cursor.js';
import ZedCleaner from '../../cleaners/zed.js';

describe('IDE Cleaners', () => {
  describe('VSCodeCleaner', () => {
    let cleaner: VSCodeCleaner;

    beforeEach(() => {
      cleaner = new VSCodeCleaner();
    });

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('vscode');
      expect(cleaner.type).toBe('ide');
      expect(cleaner.description).toContain('VS Code');
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
      expect(cacheInfo.name).toBe('vscode');
      expect(cacheInfo.type).toBe('ide');
      expect(Array.isArray(cacheInfo.paths)).toBe(true);
      
      const result = await cleaner.clear(true);
      expect(result.name).toBe('vscode');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('XcodeCleaner', () => {
    let cleaner: XcodeCleaner;

    beforeEach(() => {
      cleaner = new XcodeCleaner();
    });

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('xcode');
      expect(cleaner.type).toBe('ide');
      expect(cleaner.description).toContain('Xcode');
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
      expect(cacheInfo.name).toBe('xcode');
      expect(cacheInfo.type).toBe('ide');
      expect(Array.isArray(cacheInfo.paths)).toBe(true);
      
      const result = await cleaner.clear(true);
      expect(result.name).toBe('xcode');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('AndroidStudioCleaner', () => {
    let cleaner: typeof AndroidStudioCleaner;

    beforeEach(() => {
      cleaner = AndroidStudioCleaner;
    });

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('androidstudio');
      expect(cleaner.type).toBe('ide');
      expect(cleaner.description).toContain('Android Studio');
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
      expect(cacheInfo.name).toBe('androidstudio');
      expect(cacheInfo.type).toBe('ide');
      expect(Array.isArray(cacheInfo.paths)).toBe(true);
      
      const result = await cleaner.clear(true);
      expect(result.name).toBe('androidstudio');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('JetBrainsCleaner', () => {
    let cleaner: typeof JetBrainsCleaner;

    beforeEach(() => {
      cleaner = JetBrainsCleaner;
    });

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('jetbrains');
      expect(cleaner.type).toBe('ide');
      expect(cleaner.description).toContain('JetBrains');
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
      expect(cacheInfo.name).toBe('jetbrains');
      expect(cacheInfo.type).toBe('ide');
      expect(Array.isArray(cacheInfo.paths)).toBe(true);

      const result = await cleaner.clear(true);
      expect(result.name).toBe('jetbrains');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('WindsurfCleaner', () => {
    let cleaner: typeof WindsurfCleaner;

    beforeEach(() => {
      cleaner = WindsurfCleaner;
    });

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('windsurf');
      expect(cleaner.type).toBe('ide');
      expect(cleaner.description).toContain('Windsurf');
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
      expect(cacheInfo.name).toBe('windsurf');
      expect(cacheInfo.type).toBe('ide');
      expect(Array.isArray(cacheInfo.paths)).toBe(true);

      const result = await cleaner.clear(true);
      expect(result.name).toBe('windsurf');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('CursorCleaner', () => {
    let cleaner: typeof CursorCleaner;

    beforeEach(() => {
      cleaner = CursorCleaner;
    });

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('cursor');
      expect(cleaner.type).toBe('ide');
      expect(cleaner.description).toContain('Cursor');
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
      expect(cacheInfo.name).toBe('cursor');
      expect(cacheInfo.type).toBe('ide');
      expect(Array.isArray(cacheInfo.paths)).toBe(true);

      const result = await cleaner.clear(true);
      expect(result.name).toBe('cursor');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('ZedCleaner', () => {
    let cleaner: typeof ZedCleaner;

    beforeEach(() => {
      cleaner = ZedCleaner;
    });

    it('should have correct properties', () => {
      expect(cleaner.name).toBe('zed');
      expect(cleaner.type).toBe('ide');
      expect(cleaner.description).toContain('Zed');
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
      expect(cacheInfo.name).toBe('zed');
      expect(cacheInfo.type).toBe('ide');
      expect(Array.isArray(cacheInfo.paths)).toBe(true);

      const result = await cleaner.clear(true);
      expect(result.name).toBe('zed');
      expect(typeof result.success).toBe('boolean');
    });
  });
});
