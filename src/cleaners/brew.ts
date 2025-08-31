import { CleanerModule, CacheInfo, ClearResult, CacheType, CacheSelectionCriteria } from '../types';
import { getCacheSize } from '../utils/fs';
import { execSync } from 'child_process';
import { printVerbose, symbols } from '../utils/cli';
import os from 'os';
import { minimatch } from 'minimatch';

const cleaner: CleanerModule = {
  name: 'brew',
  type: 'package-manager' as CacheType,
  description: 'Homebrew package manager caches and old versions',

  async isAvailable(): Promise<boolean> {
    // Only works on macOS and Linux
    if (os.platform() !== 'darwin' && os.platform() !== 'linux') {
      return false;
    }

    // Check if brew is installed
    try {
      execSync('which brew', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },

  async getCacheInfo(): Promise<CacheInfo> {
    // Only works on macOS and Linux
    if (os.platform() !== 'darwin' && os.platform() !== 'linux') {
      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [],
        isInstalled: false,
        size: 0,
      };
    }

    // Check if brew is installed
    let isInstalled = false;
    try {
      execSync('which brew', { stdio: 'ignore' });
      isInstalled = true;
    } catch {
      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [],
        isInstalled: false,
        size: 0,
      };
    }

    const paths = [];
    let totalSize = 0;

    try {
      // Get Homebrew cache location
      const cacheDir = execSync('brew --cache', { encoding: 'utf8' }).trim();
      if (cacheDir) {
        paths.push(cacheDir);
        totalSize += await getCacheSize(cacheDir);
      }

      // Get old versions size (this is a dry-run to get size)
      try {
        const cleanupDryRun = execSync('brew cleanup -s --dry-run 2>&1', { encoding: 'utf8' });
        const sizeMatch = cleanupDryRun.match(/Would remove: .* \((.+?)\)/);
        if (sizeMatch && sizeMatch[1]) {
          const sizeStr = sizeMatch[1];
          // Parse size (e.g., "1.2GB", "500MB", "100KB")
          const sizeNum = parseFloat(sizeStr);
          if (sizeStr.includes('GB')) {
            totalSize += sizeNum * 1024 * 1024 * 1024;
          } else if (sizeStr.includes('MB')) {
            totalSize += sizeNum * 1024 * 1024;
          } else if (sizeStr.includes('KB')) {
            totalSize += sizeNum * 1024;
          }
        }
      } catch {
        // Ignore if cleanup dry-run fails
      }
    } catch (error) {
      printVerbose(`Error getting Homebrew cache info: ${error}`);
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths,
      isInstalled,
      size: totalSize,
    };
  },

  async clear(dryRun?: boolean, _criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo, protectedPaths: string[] = []): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'Homebrew is not installed',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    // Check if any of the paths are protected
    const pathsToClear = info.paths.filter(cachePath => {
      const isProtected = protectedPaths.some(protectedPattern => 
        minimatch(cachePath, protectedPattern, { dot: true })
      );
      if (isProtected) {
        printVerbose(`Skipping protected path: ${cachePath}`);
      }
      return !isProtected;
    });

    if (pathsToClear.length === 0 && !dryRun) { // If all paths are protected and not a dry run
      printVerbose('All Homebrew cache paths are protected. Nothing to clear.');
      return {
        name: this.name,
        success: true,
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    try {
      if (dryRun) {
        printVerbose(`${symbols.info} [DRY RUN] Would run: brew cleanup -s`);
        printVerbose(`${symbols.info} [DRY RUN] Would clear Homebrew cache and old versions`);
        
        // Get what would be cleaned
        try {
          const cleanupDryRun = execSync('brew cleanup -s --dry-run 2>&1', { encoding: 'utf8' });
          const lines = cleanupDryRun.split('\n');
          for (const line of lines) {
            if (line.includes('Would remove:') || line.includes('==>')) {
              printVerbose(`  ${line.trim()}`);
            }
          }
        } catch {
          // Ignore dry-run errors
        }
        
        return {
          name: this.name,
          success: true,
          clearedPaths: pathsToClear, // Only report paths that would be cleared
          sizeBefore,
          sizeAfter: sizeBefore,
        };
      }

      // Run actual cleanup
      printVerbose(`${symbols.soap} Running Homebrew cleanup...`);
      
      try {
        // Clean up old versions and cache
        execSync('brew cleanup -s', { stdio: 'inherit' });
        clearedPaths.push(...pathsToClear); // Only push paths that were actually cleared
        
        // Also prune old downloads
        execSync('brew cleanup --prune=all', { stdio: 'ignore' });
        
        printVerbose(`${symbols.bubbles} Homebrew cleanup completed`);
      } catch (error) {
        printVerbose(`${symbols.warning} Partial Homebrew cleanup: ${error}`);
      }

      return {
        name: this.name,
        success: true,
        clearedPaths,
        sizeBefore,
        sizeAfter: 0, // Set to 0 as we don't want to rescan
      };
    } catch (error) {
      return {
        name: this.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        clearedPaths: [],
        sizeBefore,
        sizeAfter: sizeBefore,
      };
    }
  },
};

export default cleaner;