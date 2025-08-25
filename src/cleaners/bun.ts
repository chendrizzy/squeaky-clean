import { CleanerModule, CacheInfo, ClearResult } from '../types';
import * as path from 'path';
import * as os from 'os';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import execa from 'execa';
import { printVerbose, symbols } from '../utils/cli';
import minimatch from 'minimatch';

class BunCleaner implements CleanerModule {
  name = 'bun';
  type = 'package-manager' as const;
  description = 'Bun runtime and package manager caches';

  private async getBunVersion(): Promise<string | null> {
    try {
      const result = await execa('bun', ['--version']);
      return result.stdout.trim();
    } catch {
      return null;
    }
  }

  private async getBunCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();
    
    // Bun cache directories by platform
    const platform = os.platform();
    
    if (platform === 'darwin') {
      // macOS
      const macOSPaths = [
        path.join(homeDir, '.bun', 'install', 'cache'),
        path.join(homeDir, 'Library', 'Caches', 'bun'),
        path.join(homeDir, '.bun', 'tmp'),
      ];
      for (const cachePath of macOSPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else if (platform === 'win32') {
      // Windows
      const windowsPaths = [
        path.join(homeDir, '.bun', 'install', 'cache'),
        path.join(homeDir, 'AppData', 'Local', 'bun'),
        path.join(homeDir, '.bun', 'tmp'),
      ];
      for (const cachePath of windowsPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else {
      // Linux/Unix
      const linuxPaths = [
        path.join(homeDir, '.bun', 'install', 'cache'),
        path.join(homeDir, '.cache', 'bun'),
        path.join(homeDir, '.bun', 'tmp'),
      ];
      for (const cachePath of linuxPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  async isAvailable(): Promise<boolean> {
    const version = await this.getBunVersion();
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

    const cachePaths = await this.getBunCachePaths();
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

  async clear(dryRun = false, criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo, protectedPaths: string[] = []): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    
    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'Bun is not installed',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    // Clear cache directories
    for (const cachePath of info.paths) {
      // Check if the path is protected
      const isProtected = protectedPaths.some(protectedPattern => 
        minimatch(cachePath, protectedPattern, { dot: true })
      );

      if (isProtected) {
        printVerbose(`Skipping protected path: ${cachePath}`);
        continue; // Skip this path
      }

      try {
        if (dryRun) {
          printVerbose(`${symbols.soap} Would clear: ${cachePath}`);
          clearedPaths.push(cachePath);
        } else {
          printVerbose(`${symbols.soap} Clearing: ${cachePath}`);
          await safeRmrf(cachePath);
          clearedPaths.push(cachePath);
        }
      } catch (error) {
        const errorMsg = `Failed to clear ${cachePath}: ${error}`;
        errors.push(errorMsg);
        printVerbose(errorMsg);
      }
    }

    // Try using bun's built-in cache clearing if available
    if (!dryRun && await this.isAvailable()) {
      try {
        // Note: Bun doesn't have a dedicated cache clear command yet,
        // but we can try clearing install cache via reinstall with --force
        printVerbose(`${symbols.info} Note: Bun doesn't have a dedicated cache clear command`);
      } catch (error) {
        printVerbose(`Note: Bun cache clearing failed: ${error}`);
      }
    }

    return {
      name: this.name,
      success: errors.length === 0,
      sizeBefore,
      sizeAfter: 0, // Set to 0 as we don't want to rescan
      error: errors.length > 0 ? errors.join('; ') : undefined,
      clearedPaths,
    };
  }
}

export default new BunCleaner();
