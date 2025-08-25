import { CleanerModule, CacheInfo, ClearResult } from '../types';
import * as path from 'path';
import * as os from 'os';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import execa from 'execa';
import { printVerbose, symbols } from '../utils/cli';

class PipCleaner implements CleanerModule {
  name = 'pip';
  type = 'package-manager' as const;
  description = 'Python pip package manager caches and temporary files';

  private async getPythonVersion(): Promise<string | null> {
    // Try python3 first, then python
    const pythonCommands = ['python3', 'python'];
    
    for (const cmd of pythonCommands) {
      try {
        const result = await execa(cmd, ['--version']);
        return result.stdout.trim() || result.stderr.trim();
      } catch {
        // Continue to next command
      }
    }
    
    return null;
  }

  private async getPipVersion(): Promise<string | null> {
    // Try pip3 first, then pip
    const pipCommands = ['pip3', 'pip'];
    
    for (const cmd of pipCommands) {
      try {
        const result = await execa(cmd, ['--version']);
        return result.stdout.trim();
      } catch {
        // Continue to next command
      }
    }
    
    return null;
  }

  private async getPipCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();
    const platform = os.platform();
    
    // Platform-specific pip cache paths
    if (platform === 'darwin') {
      // macOS
      const macPaths = [
        path.join(homeDir, 'Library', 'Caches', 'pip'),
        path.join(homeDir, '.cache', 'pip'),
      ];
      
      for (const cachePath of macPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else if (platform === 'win32') {
      // Windows
      const windowsPaths = [
        path.join(homeDir, 'AppData', 'Local', 'pip', 'cache'),
        path.join(homeDir, 'AppData', 'Local', 'pip', 'Cache'),
        path.join(homeDir, 'pip', 'cache'),
      ];
      
      for (const cachePath of windowsPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else {
      // Linux/Unix
      const linuxPaths = [
        path.join(homeDir, '.cache', 'pip'),
        path.join(homeDir, '.pip', 'cache'),
        '/tmp/pip-cache',
      ];
      
      for (const cachePath of linuxPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    }

    // Try to get pip cache directory from pip itself
    try {
      const pipCacheDir = await this.getPipCacheDir();
      if (pipCacheDir && !paths.includes(pipCacheDir)) {
        paths.push(pipCacheDir);
      }
    } catch (error) {
      printVerbose(`Could not get pip cache directory: ${error}`);
    }

    // Look for virtual environment caches
    try {
      const venvCaches = await this.findVirtualEnvCaches();
      paths.push(...venvCaches);
    } catch (error) {
      printVerbose(`Error finding virtual environment caches: ${error}`);
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  private async getPipCacheDir(): Promise<string | null> {
    const pipCommands = ['pip3', 'pip'];
    
    for (const cmd of pipCommands) {
      try {
        const result = await execa(cmd, ['cache', 'dir']);
        const cacheDir = result.stdout.trim();
        if (cacheDir && await pathExists(cacheDir)) {
          return cacheDir;
        }
      } catch {
        // Command failed, try next
      }
    }
    
    return null;
  }

  private async findVirtualEnvCaches(): Promise<string[]> {
    const caches: string[] = [];
    const homeDir = os.homedir();
    
    // Common virtual environment directories
    const venvDirs = [
      path.join(homeDir, '.virtualenvs'),
      path.join(homeDir, 'envs'),
      path.join(homeDir, 'venv'),
      path.join(homeDir, '.venv'),
      path.join(homeDir, 'anaconda3', 'envs'),
      path.join(homeDir, 'miniconda3', 'envs'),
      path.join(homeDir, '.conda', 'envs'),
    ];

    for (const venvDir of venvDirs) {
      if (await pathExists(venvDir)) {
        try {
          const envCaches = await this.findPipCachesInDir(venvDir);
          caches.push(...envCaches);
        } catch (error) {
          printVerbose(`Error searching virtual envs in ${venvDir}: ${error}`);
        }
      }
    }

    return caches;
  }

  private async findPipCachesInDir(dir: string): Promise<string[]> {
    const caches: string[] = [];
    
    try {
      const platform = os.platform();
      
      // Look for pip cache subdirectories in virtual environments
      const possibleCachePaths = [];
      
      if (platform === 'win32') {
        possibleCachePaths.push(
          path.join(dir, 'Lib', 'site-packages', 'pip', '_internal', 'cache'),
          path.join(dir, 'pip', 'cache')
        );
      } else {
        possibleCachePaths.push(
          path.join(dir, 'lib', 'python*', 'site-packages', 'pip', '_internal', 'cache'),
          path.join(dir, 'pip', 'cache')
        );
      }

      for (const cachePath of possibleCachePaths) {
        if (await pathExists(cachePath)) {
          caches.push(cachePath);
        }
      }
    } catch {
      // Ignore errors
    }

    return caches;
  }

  async isAvailable(): Promise<boolean> {
    // Check if Python is installed
    const pythonVersion = await this.getPythonVersion();
    if (pythonVersion) {
      printVerbose(`Found Python: ${pythonVersion}`);
      return true;
    }

    // Check if pip is installed
    const pipVersion = await this.getPipVersion();
    if (pipVersion) {
      printVerbose(`Found pip: ${pipVersion}`);
      return true;
    }

    // Check if pip cache exists
    const homeDir = os.homedir();
    const platform = os.platform();
    
    let defaultCachePath: string;
    if (platform === 'darwin') {
      defaultCachePath = path.join(homeDir, 'Library', 'Caches', 'pip');
    } else if (platform === 'win32') {
      defaultCachePath = path.join(homeDir, 'AppData', 'Local', 'pip', 'cache');
    } else {
      defaultCachePath = path.join(homeDir, '.cache', 'pip');
    }

    if (await pathExists(defaultCachePath)) {
      printVerbose(`Found pip cache at ${defaultCachePath}`);
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

    const cachePaths = await this.getPipCachePaths();
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

  async clear(dryRun = false, criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    
    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'Python/pip is not available',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    // Try pip cache purge command first
    if (!dryRun) {
      await this.runPipCachePurge();
    }

    for (const cachePath of info.paths) {
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

  private async runPipCachePurge(): Promise<void> {
    const pipCommands = ['pip3', 'pip'];
    
    for (const cmd of pipCommands) {
      try {
        await execa(cmd, ['cache', 'purge']);
        printVerbose(`${symbols.soap} Executed: ${cmd} cache purge`);
        return; // Success, don't try other commands
      } catch (error) {
        printVerbose(`Note: ${cmd} cache purge failed: ${error}`);
      }
    }
  }
}

export default new PipCleaner();
