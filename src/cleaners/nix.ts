import { CleanerModule, CacheInfo, ClearResult, CacheType } from '../types';
import { getCacheSize } from '../utils/fs';
import { execSync } from 'child_process';
import { printVerbose, symbols } from '../utils/cli';
import os from 'os';
import path from 'path';
import fs from 'fs';
import minimatch from 'minimatch';

const cleaner: CleanerModule = {
  name: 'nix',
  type: 'package-manager' as CacheType,
  description: 'Nix package manager store and garbage collection',

  async isAvailable(): Promise<boolean> {
    // Check if nix is installed
    try {
      execSync('which nix-collect-garbage', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },

  async getCacheInfo(): Promise<CacheInfo> {
    // Check if nix is installed
    let isInstalled = false;
    try {
      execSync('which nix-collect-garbage', { stdio: 'ignore' });
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
      // Check /nix/store size
      const nixStore = '/nix/store';
      if (fs.existsSync(nixStore)) {
        paths.push(nixStore);
        
        // Get garbage collectible size using dry-run
        try {
          const gcDryRun = execSync('nix-collect-garbage --dry-run 2>&1', { encoding: 'utf8' });
          // Parse output for size info
          const lines = gcDryRun.split('\n');
          for (const line of lines) {
            // Look for lines mentioning freed space
            const sizeMatch = line.match(/(\d+(?:\.\d+)?)\s*(MiB|GiB|KiB)/);
            if (sizeMatch) {
              const size = parseFloat(sizeMatch[1]);
              const unit = sizeMatch[2];
              if (unit === 'GiB') {
                totalSize += size * 1024 * 1024 * 1024;
              } else if (unit === 'MiB') {
                totalSize += size * 1024 * 1024;
              } else if (unit === 'KiB') {
                totalSize += size * 1024;
              }
            }
          }
        } catch {
          // If dry-run fails, estimate based on store size
          // This is a rough estimate - actual gc size will be less
          try {
            const storeSize = await getCacheSize(nixStore);
            // Estimate ~30% can be garbage collected
            totalSize = Math.floor(storeSize * 0.3);
          } catch {
            // Ignore size calculation errors
          }
        }
      }

      // Check user profile generations
      const userProfile = path.join(os.homedir(), '.nix-profile');
      if (fs.existsSync(userProfile)) {
        paths.push(userProfile);
      }

      // Check nix cache
      const nixCache = path.join(os.homedir(), '.cache', 'nix');
      if (fs.existsSync(nixCache)) {
        paths.push(nixCache);
        totalSize += await getCacheSize(nixCache);
      }
    } catch (error) {
      printVerbose(`Error getting Nix cache info: ${error}`);
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

  async clear(dryRun?: boolean, criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo, protectedPaths: string[] = []): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'Nix is not installed',
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
      printVerbose('All Nix cache paths are protected. Nothing to clear.');
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
        printVerbose(`${symbols.info} [DRY RUN] Would run: nix-collect-garbage -d`);
        printVerbose(`${symbols.info} [DRY RUN] Would delete old generations and collect garbage`);
        
        // Show what would be cleaned
        try {
          const gcDryRun = execSync('nix-collect-garbage --dry-run 2>&1', { encoding: 'utf8' });
          const lines = gcDryRun.split('\n').slice(0, 10); // Show first 10 lines
          for (const line of lines) {
            if (line.trim()) {
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

      // Run actual garbage collection
      printVerbose(`${symbols.soap} Running Nix garbage collection...`);
      
      try {
        // Delete old generations and collect garbage
        execSync('nix-collect-garbage -d', { stdio: 'inherit' });
        if (pathsToClear.includes('/nix/store')) { // Only push if it was not protected
          clearedPaths.push('/nix/store');
        }
        
        // Also clean build cache if using nix 2.0+
        try {
          execSync('nix store gc', { stdio: 'ignore' });
        } catch {
          // Ignore if using older nix version
        }
        
        // Clean user cache
        const nixCache = path.join(os.homedir(), '.cache', 'nix');
        if (fs.existsSync(nixCache) && pathsToClear.includes(nixCache)) { // Only clear if not protected
          try {
            fs.rmSync(nixCache, { recursive: true, force: true });
            clearedPaths.push(nixCache);
          } catch {
            // Ignore cache clear errors
          }
        }
        
        printVerbose(`${symbols.bubbles} Nix garbage collection completed`);
      } catch (error) {
        printVerbose(`${symbols.warning} Partial Nix cleanup: ${error}`);
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