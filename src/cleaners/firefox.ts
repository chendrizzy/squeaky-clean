import { CleanerModule, CacheInfo, ClearResult } from '../types';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import { printVerbose, symbols } from '../utils/cli';
import minimatch from 'minimatch';

class FirefoxCleaner implements CleanerModule {
  name = 'firefox';
  type = 'browser' as const;
  description = 'Firefox cache, temporary files, and developer profile data';

  private async findFirefoxInstallation(): Promise<string | null> {
    const platform = os.platform();
    
    if (platform === 'darwin') {
      // macOS
      const macPaths = [
        '/Applications/Firefox.app',
        '/Applications/Firefox Developer Edition.app',
      ];
      
      for (const firefoxPath of macPaths) {
        if (await pathExists(firefoxPath)) {
          return firefoxPath;
        }
      }
    } else if (platform === 'win32') {
      // Windows
      const windowsPaths = [
        'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
        'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
        path.join(os.homedir(), 'AppData', 'Local', 'Mozilla Firefox', 'firefox.exe'),
      ];
      
      for (const firefoxPath of windowsPaths) {
        if (await pathExists(firefoxPath)) {
          return firefoxPath;
        }
      }
    } else {
      // Linux
      const linuxPaths = [
        '/usr/bin/firefox',
        '/usr/local/bin/firefox',
        '/snap/bin/firefox',
        '/opt/firefox/firefox',
      ];
      
      for (const firefoxPath of linuxPaths) {
        if (await pathExists(firefoxPath)) {
          return firefoxPath;
        }
      }
    }
    
    return null;
  }

  private async getFirefoxCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();
    const platform = os.platform();
    
    // Platform-specific Firefox cache paths
    if (platform === 'darwin') {
      // macOS Firefox paths
      const macBasePaths = [
        path.join(homeDir, 'Library', 'Caches', 'Firefox'),
        path.join(homeDir, 'Library', 'Application Support', 'Firefox'),
      ];
      
      for (const basePath of macBasePaths) {
        if (await pathExists(basePath)) {
          // Look for profile directories
          const profilePaths = await this.findFirefoxProfileCaches(basePath);
          paths.push(...profilePaths);
        }
      }
    } else if (platform === 'win32') {
      // Windows Firefox paths
      const windowsBasePaths = [
        path.join(homeDir, 'AppData', 'Local', 'Mozilla', 'Firefox'),
        path.join(homeDir, 'AppData', 'Roaming', 'Mozilla', 'Firefox'),
      ];
      
      for (const basePath of windowsBasePaths) {
        if (await pathExists(basePath)) {
          const profilePaths = await this.findFirefoxProfileCaches(basePath);
          paths.push(...profilePaths);
        }
      }
    } else {
      // Linux Firefox paths
      const linuxBasePaths = [
        path.join(homeDir, '.cache', 'mozilla', 'firefox'),
        path.join(homeDir, '.mozilla', 'firefox'),
      ];
      
      for (const basePath of linuxBasePaths) {
        if (await pathExists(basePath)) {
          const profilePaths = await this.findFirefoxProfileCaches(basePath);
          paths.push(...profilePaths);
        }
      }
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  private async findFirefoxProfileCaches(basePath: string): Promise<string[]> {
    const cachePaths: string[] = [];
    
    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const profilePath = path.join(basePath, entry.name);
          
          // Common Firefox cache subdirectories
          const cacheSubdirs = [
            'cache2',
            'OfflineCache',
            'startupCache',
            'thumbnails',
            'safebrowsing',
            'shader-cache',
            'crashes',
            'minidumps',
            'saved-telemetry-pings',
            'datareporting',
          ];
          
          for (const subdir of cacheSubdirs) {
            const subdirPath = path.join(profilePath, subdir);
            if (await pathExists(subdirPath)) {
              cachePaths.push(subdirPath);
            }
          }
          
          // Also check for specific profile directories (they usually have random names)
          if (entry.name.includes('.') && entry.name !== 'Profiles') {
            const profileCachePath = path.join(profilePath, 'cache');
            if (await pathExists(profileCachePath)) {
              cachePaths.push(profileCachePath);
            }
          }
        }
      }
    } catch (error) {
      printVerbose(`Error reading Firefox profile directory ${basePath}: ${error}`);
    }

    return cachePaths;
  }

  async isAvailable(): Promise<boolean> {
    // Check if Firefox is installed
    const firefoxInstallation = await this.findFirefoxInstallation();
    if (firefoxInstallation) {
      printVerbose(`Found Firefox at ${firefoxInstallation}`);
      return true;
    }

    // Check if Firefox cache directories exist
    const cachePaths = await this.getFirefoxCachePaths();
    if (cachePaths.length > 0) {
      printVerbose(`Found ${cachePaths.length} Firefox cache directories`);
      return true;
    }

    return false;
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

    const cachePaths = await this.getFirefoxCachePaths();
    let totalSize = 0;
    const validPaths: string[] = [];

    for (const cachePath of cachePaths) {
      try {
        const size = await getDirectorySize(cachePath, true); // Use estimated size for large dirs
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
        error: 'Firefox is not available',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    // Warning: Firefox should be closed before clearing cache
    printVerbose(`${symbols.warning} Note: Firefox should be closed before clearing cache for best results`);

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

export default new FirefoxCleaner();
