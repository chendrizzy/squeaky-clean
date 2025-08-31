import { CleanerModule, CacheInfo, ClearResult, CacheSelectionCriteria } from '../types';
import * as path from 'path';
import * as os from 'os';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import { printVerbose, symbols } from '../utils/cli';
import { minimatch } from 'minimatch';

class ChromeCleaner implements CleanerModule {
  name = 'chrome';
  type = 'browser' as const;
  description = 'Chrome DevTools cache, service worker cache, and development storage';

  private async findChromeInstallation(): Promise<string | null> {
    const platform = os.platform();
    
    if (platform === 'darwin') {
      // macOS
      const macPaths = [
        '/Applications/Google Chrome.app',
        '/Applications/Chrome.app',
      ];
      
      for (const chromePath of macPaths) {
        if (await pathExists(chromePath)) {
          return chromePath;
        }
      }
    } else if (platform === 'win32') {
      // Windows
      const windowsPaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ];
      
      for (const chromePath of windowsPaths) {
        if (await pathExists(chromePath)) {
          return chromePath;
        }
      }
    } else {
      // Linux
      const linuxPaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chrome',
        '/snap/bin/chromium',
      ];
      
      for (const chromePath of linuxPaths) {
        if (await pathExists(chromePath)) {
          return chromePath;
        }
      }
    }
    
    return null;
  }

  private async getChromeCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();
    const platform = os.platform();
    
    // Platform-specific Chrome cache paths
    if (platform === 'darwin') {
      // macOS Chrome paths
      const macPaths = [
        path.join(homeDir, 'Library', 'Caches', 'Google', 'Chrome'),
        path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Service Worker'),
        path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cache'),
        path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Code Cache'),
        path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'GPUCache'),
        path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome', 'ShaderCache'),
      ];
      
      for (const cachePath of macPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else if (platform === 'win32') {
      // Windows Chrome paths
      const windowsPaths = [
        path.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
        path.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
        path.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Service Worker'),
        path.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'GPUCache'),
        path.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'ShaderCache'),
      ];
      
      for (const cachePath of windowsPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else {
      // Linux Chrome paths
      const linuxPaths = [
        path.join(homeDir, '.cache', 'google-chrome'),
        path.join(homeDir, '.config', 'google-chrome', 'Default', 'Service Worker'),
        path.join(homeDir, '.config', 'google-chrome', 'Default', 'Cache'),
        path.join(homeDir, '.config', 'google-chrome', 'Default', 'Code Cache'),
        path.join(homeDir, '.config', 'google-chrome', 'Default', 'GPUCache'),
        path.join(homeDir, '.config', 'google-chrome', 'ShaderCache'),
        // Also check for Chromium
        path.join(homeDir, '.cache', 'chromium'),
        path.join(homeDir, '.config', 'chromium', 'Default', 'Service Worker'),
        path.join(homeDir, '.config', 'chromium', 'Default', 'Cache'),
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
    // Check if Chrome is installed
    const chromeInstallation = await this.findChromeInstallation();
    if (chromeInstallation) {
      printVerbose(`Found Chrome at ${chromeInstallation}`);
      return true;
    }

    // Check if Chrome cache directories exist
    const cachePaths = await this.getChromeCachePaths();
    if (cachePaths.length > 0) {
      printVerbose(`Found ${cachePaths.length} Chrome cache directories`);
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

    const cachePaths = await this.getChromeCachePaths();
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

  async clear(dryRun = false, _criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo, protectedPaths: string[] = []): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    
    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'Chrome is not available',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    // Warning: Chrome should be closed before clearing cache
    printVerbose(`${symbols.warning} Note: Chrome should be closed before clearing cache for best results`);

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

export default new ChromeCleaner();
