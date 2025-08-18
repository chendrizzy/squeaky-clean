import { CleanerModule, CacheInfo, ClearResult } from '../types';
import * as path from 'path';
import * as os from 'os';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import execa from 'execa';
import { printVerbose, symbols } from '../utils/cli';

class PnpmCleaner implements CleanerModule {
  name = 'pnpm';
  type = 'package-manager' as const;
  description = 'PNPM package manager store and caches';

  private async getPnpmVersion(): Promise<string | null> {
    try {
      const result = await execa('pnpm', ['--version']);
      return result.stdout.trim();
    } catch {
      return null;
    }
  }

  private async getPnpmCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();
    
    try {
      // Get pnpm store directory
      const storeResult = await execa('pnpm', ['store', 'path']);
      const storeDir = storeResult.stdout.trim();
      if (await pathExists(storeDir)) {
        paths.push(storeDir);
      }
    } catch {
      // Fallback to default pnpm store locations
      const defaultStorePaths = [
        path.join(homeDir, '.pnpm-store'),
        path.join(homeDir, 'Library', 'pnpm'), // macOS
        path.join(homeDir, '.local', 'share', 'pnpm'), // Linux
      ];

      for (const storePath of defaultStorePaths) {
        if (await pathExists(storePath)) {
          paths.push(storePath);
        }
      }
    }

    // Get additional cache directories
    const additionalPaths = [
      path.join(homeDir, '.pnpm'),
      path.join(homeDir, '.cache', 'pnpm'), // Linux/WSL
      path.join(homeDir, 'AppData', 'Local', 'pnpm'), // Windows
    ];

    for (const cachePath of additionalPaths) {
      if (await pathExists(cachePath)) {
        // Check if it's not the same as the store path already added
        if (!paths.includes(cachePath)) {
          paths.push(cachePath);
        }
      }
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  async isAvailable(): Promise<boolean> {
    const version = await this.getPnpmVersion();
    return version !== null;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const isInstalled = await this.isAvailable();
    
    if (!isInstalled) {
      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [],
        isInstalled: false,
        size: 0,
      };
    }

    const cachePaths = await this.getPnpmCachePaths();
    let totalSize = 0;
    const validPaths: string[] = [];

    for (const cachePath of cachePaths) {
      try {
        const size = await getDirectorySize(cachePath);
        totalSize += size;
        validPaths.push(cachePath);
        printVerbose(`${symbols.folder} ${cachePath}: ${(size / (1024 * 1024)).toFixed(1)} MB`);
      } catch (error) {
        printVerbose(`Error calculating size for ${cachePath}: ${error}`);
      }
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: validPaths,
      isInstalled: true,
      size: totalSize,
    };
  }

  async clear(dryRun = false): Promise<ClearResult> {
    const cacheInfo = await this.getCacheInfo();
    
    if (!cacheInfo.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'PNPM is not installed',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = cacheInfo.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    // Use pnpm store prune command first if available
    if (!dryRun && await this.isAvailable()) {
      try {
        await execa('pnpm', ['store', 'prune']);
        printVerbose(`${symbols.soap} Executed: pnpm store prune`);
      } catch (error) {
        printVerbose(`Note: pnpm store prune failed: ${error}`);
      }
    }

    // Clear cache directories manually
    for (const cachePath of cacheInfo.paths) {
      try {
        if (dryRun) {
          printVerbose(`${symbols.soap} Would clear: ${cachePath}`);
          clearedPaths.push(cachePath);
        } else {
          printVerbose(`${symbols.soap} Clearing: ${cachePath}`);
          
          // For pnpm store, be more careful and only clear cache subdirectories
          if (cachePath.includes('pnpm-store') || cachePath.includes('.pnpm-store')) {
            // Clear specific subdirectories in the store rather than the entire store
            const storeSubdirs = ['tmp', 'metadata-cache', 'dlx'];
            for (const subdir of storeSubdirs) {
              const subdirPath = path.join(cachePath, subdir);
              if (await pathExists(subdirPath)) {
                await safeRmrf(subdirPath);
                printVerbose(`${symbols.soap} Cleared pnpm store subdirectory: ${subdir}`);
              }
            }
          } else {
            // For other cache directories, clear everything
            await safeRmrf(cachePath);
          }
          
          clearedPaths.push(cachePath);
        }
      } catch (error) {
        const errorMsg = `Failed to clear ${cachePath}: ${error}`;
        errors.push(errorMsg);
        printVerbose(errorMsg);
      }
    }

    // Calculate size after clearing
    let sizeAfter = 0;
    if (!dryRun) {
      for (const cachePath of cacheInfo.paths) {
        try {
          if (await pathExists(cachePath)) {
            sizeAfter += await getDirectorySize(cachePath);
          }
        } catch {
          // Ignore errors when calculating final size
        }
      }
    } else {
      sizeAfter = sizeBefore; // No actual clearing in dry run
    }

    return {
      name: this.name,
      success: errors.length === 0,
      sizeBefore,
      sizeAfter,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      clearedPaths,
    };
  }
}

export default new PnpmCleaner();
