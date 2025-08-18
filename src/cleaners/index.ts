import { CleanerModule, CacheInfo, ClearResult, CacheType } from '../types';
import { config } from '../config';
import { printVerbose, symbols } from '../utils/cli';

// Import all cleaner modules
// Package managers
import npmCleaner from './npm';
import yarnCleaner from './yarn';
import pnpmCleaner from './pnpm';
import bunCleaner from './bun';
import pipCleaner from './pip';
import brewCleaner from './brew';
import nixCleaner from './nix';

// Build tools
import webpackCleaner from './webpack';
import viteCleaner from './vite';
import nxCleaner from './nx';
import turboCleaner from './turbo';
import flutterCleaner from './flutter';

// IDEs
import xcodeCleaner from './xcode';
import vscodeCleaner from './vscode';
import androidStudioCleaner from './androidstudio';
import jetBrainsCleaner from './jetbrains';

// Browsers
import chromeCleaner from './chrome';
import firefoxCleaner from './firefox';

// System tools
import dockerCleaner from './docker';
import gradleCleaner from './gradle';

export class CacheManager {
  private cleaners: Map<string, CleanerModule>;

  constructor() {
    this.cleaners = new Map<string, CleanerModule>();
    
    // Register all cleaner modules
    // Package managers
    this.cleaners.set('npm', npmCleaner);
    this.cleaners.set('yarn', yarnCleaner);
    this.cleaners.set('pnpm', pnpmCleaner);
    this.cleaners.set('bun', bunCleaner);
    this.cleaners.set('pip', pipCleaner);
    this.cleaners.set('brew', brewCleaner);
    this.cleaners.set('nix', nixCleaner);
    
    // Build tools
    this.cleaners.set('webpack', webpackCleaner);
    this.cleaners.set('vite', viteCleaner);
    this.cleaners.set('nx', nxCleaner);
    this.cleaners.set('turbo', turboCleaner);
    this.cleaners.set('flutter', flutterCleaner);
    
    // IDEs and development tools
    this.cleaners.set('xcode', xcodeCleaner);
    this.cleaners.set('vscode', vscodeCleaner);
    this.cleaners.set('androidstudio', androidStudioCleaner);
    this.cleaners.set('jetbrains', jetBrainsCleaner);
    
    // Browsers
    this.cleaners.set('chrome', chromeCleaner);
    this.cleaners.set('firefox', firefoxCleaner);
    
    // System tools
    this.cleaners.set('docker', dockerCleaner);
    this.cleaners.set('gradle', gradleCleaner);
  }

  /**
   * Get all available cleaners
   */
  getAllCleaners(): CleanerModule[] {
    return Array.from(this.cleaners.values());
  }

  /**
   * Get cleaners filtered by type
   */
  getCleanersByType(type: CacheType): CleanerModule[] {
    return this.getAllCleaners().filter(cleaner => cleaner.type === type);
  }

  /**
   * Get enabled cleaners based on configuration
   */
  getEnabledCleaners(): CleanerModule[] {
    return this.getAllCleaners().filter(cleaner => 
      config.isToolEnabled(cleaner.name as any)
    );
  }

  /**
   * Get cleaner by name
   */
  getCleaner(name: string): CleanerModule | undefined {
    return this.cleaners.get(name);
  }

  /**
   * Get cache info for all enabled cleaners
   */
  async getAllCacheInfo(): Promise<CacheInfo[]> {
    const enabledCleaners = this.getEnabledCleaners();
    const results: CacheInfo[] = [];

    printVerbose(`${symbols.soap} Scanning ${enabledCleaners.length} enabled cache types...`);

    for (const cleaner of enabledCleaners) {
      try {
        printVerbose(`Checking ${cleaner.name} caches...`);
        const info = await cleaner.getCacheInfo();
        results.push(info);
      } catch (error) {
        printVerbose(`Error getting cache info for ${cleaner.name}: ${error}`);
        // Add empty result for failed cleaners
        results.push({
          name: cleaner.name,
          type: cleaner.type,
          description: cleaner.description,
          paths: [],
          isInstalled: false,
          size: 0,
        });
      }
    }

    return results;
  }

  /**
   * Clean caches for enabled cleaners
   */
  async cleanAllCaches(options: {
    dryRun?: boolean;
    types?: CacheType[];
    exclude?: string[];
  } = {}): Promise<ClearResult[]> {
    let cleaners = this.getEnabledCleaners();

    // Filter by types if specified
    if (options.types && options.types.length > 0) {
      cleaners = cleaners.filter(cleaner => 
        options.types!.includes(cleaner.type)
      );
    }

    // Exclude specific tools if specified
    if (options.exclude && options.exclude.length > 0) {
      cleaners = cleaners.filter(cleaner => 
        !options.exclude!.includes(cleaner.name)
      );
    }

    const results: ClearResult[] = [];
    
    printVerbose(`${symbols.soap} Cleaning ${cleaners.length} cache types...`);

    for (const cleaner of cleaners) {
      try {
        printVerbose(`${symbols.soap} Processing ${cleaner.name}...`);
        const result = await cleaner.clear(options.dryRun);
        results.push(result);
        
        if (result.success && !options.dryRun) {
          const savedMB = ((result.sizeBefore || 0) - (result.sizeAfter || 0)) / (1024 * 1024);
          if (savedMB > 0) {
            printVerbose(`${symbols.bubbles} ${cleaner.name}: Freed ${savedMB.toFixed(1)} MB`);
          }
        }
      } catch (error) {
        printVerbose(`Error cleaning ${cleaner.name}: ${error}`);
        results.push({
          name: cleaner.name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          clearedPaths: [],
          sizeBefore: 0,
          sizeAfter: 0,
        });
      }
    }

    return results;
  }

  /**
   * Get total cache sizes by type
   */
  async getCacheSizesByType(): Promise<Record<CacheType, number>> {
    const allCacheInfo = await this.getAllCacheInfo();
    const sizesByType: Record<CacheType, number> = {
      'package-manager': 0,
      'build-tool': 0,
      'browser': 0,
      'ide': 0,
      'system': 0,
      'other': 0,
    };

    for (const info of allCacheInfo) {
      sizesByType[info.type] += info.size || 0;
    }

    return sizesByType;
  }

  /**
   * Get summary statistics
   */
  async getSummary(): Promise<{
    totalSize: number;
    totalCleaners: number;
    installedCleaners: number;
    enabledCleaners: number;
    sizesByType: Record<CacheType, number>;
  }> {
    const allCacheInfo = await this.getAllCacheInfo();
    
    // Calculate sizes by type from the same data to avoid double scanning
    const sizesByType: Record<CacheType, number> = {
      'package-manager': 0,
      'build-tool': 0,
      'browser': 0,
      'ide': 0,
      'system': 0,
      'other': 0,
    };
    
    for (const info of allCacheInfo) {
      sizesByType[info.type] += info.size || 0;
    }
    
    const totalSize = allCacheInfo.reduce((sum, info) => sum + (info.size || 0), 0);
    const installedCleaners = allCacheInfo.filter(info => info.isInstalled).length;
    const enabledCleaners = this.getEnabledCleaners().length;

    return {
      totalSize,
      totalCleaners: this.getAllCleaners().length,
      installedCleaners,
      enabledCleaners,
      sizesByType,
    };
  }
}

// Export singleton instance
export const cacheManager = new CacheManager();
