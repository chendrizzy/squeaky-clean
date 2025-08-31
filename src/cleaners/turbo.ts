import { CleanerModule, CacheInfo, ClearResult, CacheSelectionCriteria } from '../types';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import execa from 'execa';
import { printVerbose, symbols } from '../utils/cli';

export class TurboCleaner implements CleanerModule {
  name = 'turbo';
  type = 'build-tool' as const;
  description = 'Turborepo build system caches';

  private async getTurboVersion(): Promise<string | null> {
    try {
      const result = await execa('turbo', ['--version']);
      return result.stdout.trim();
    } catch {
      try {
        const result = await execa('npx', ['turbo', '--version']);
        return result.stdout.trim();
      } catch {
        return null;
      }
    }
  }

  private async findTurboCaches(): Promise<string[]> {
    const caches: string[] = [];
    const homeDir = os.homedir();
    
    // Common project directories to search
    const searchDirs = [
      path.join(homeDir, 'Projects'),
      path.join(homeDir, 'Development'),
      path.join(homeDir, 'dev'),
      path.join(homeDir, 'workspace'),
      path.join(homeDir, 'Documents'),
      process.cwd(), // Current directory
    ];

    // Check for global turbo cache
    const globalTurboCache = path.join(homeDir, 'Library', 'Caches', 'turborepo'); // macOS
    if (await pathExists(globalTurboCache)) {
      caches.push(globalTurboCache);
    }

    // Platform-specific global cache paths
    const platform = os.platform();
    if (platform === 'win32') {
      const windowsCache = path.join(homeDir, 'AppData', 'Local', 'turborepo');
      if (await pathExists(windowsCache)) {
        caches.push(windowsCache);
      }
    } else if (platform === 'linux') {
      const linuxCache = path.join(homeDir, '.cache', 'turborepo');
      if (await pathExists(linuxCache)) {
        caches.push(linuxCache);
      }
    }

    // Search for project-specific turbo caches
    for (const searchDir of searchDirs) {
      if (await pathExists(searchDir)) {
        try {
          const projectCaches = await this.findTurboCachesRecursively(searchDir, 3);
          caches.push(...projectCaches);
        } catch (error) {
          printVerbose(`Error searching ${searchDir}: ${error}`);
        }
      }
    }

    return [...new Set(caches)]; // Remove duplicates
  }

  private async findTurboCachesRecursively(dir: string, maxDepth: number): Promise<string[]> {
    if (maxDepth <= 0) return [];

    const turboCaches: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const fullPath = path.join(dir, entry.name);
          
          // Check for turbo cache directories
          const cacheLocations = [
            path.join(fullPath, 'node_modules', '.cache', 'turbo'),
            path.join(fullPath, '.turbo'),
            path.join(fullPath, '.next', 'cache'), // Next.js projects often use turbo
            path.join(fullPath, 'dist'), // Turbo output directory for Turbo repos
          ];

          for (const cacheLocation of cacheLocations) {
            if (await pathExists(cacheLocation)) {
              // For dist folders, only include if it's actually a turbo repo
              if (cacheLocation.endsWith('dist')) {
                const turboJsonPath = path.join(fullPath, 'turbo.json');
                if (await pathExists(turboJsonPath)) {
                  turboCaches.push(cacheLocation);
                }
              } else {
                turboCaches.push(cacheLocation);
              }
            }
          }
          
          // Recursively search subdirectories
          const subCaches = await this.findTurboCachesRecursively(fullPath, maxDepth - 1);
          turboCaches.push(...subCaches);
        }
      }
    } catch {
      // Ignore permission errors or other issues
    }

    return turboCaches;
  }

  private async hasTurboRepos(): Promise<boolean> {
    const homeDir = os.homedir();
    
    // Check current directory first
    if (await pathExists(path.join(process.cwd(), 'turbo.json'))) {
      return true;
    }

    // Search common project directories
    const searchDirs = [
      path.join(homeDir, 'Projects'),
      path.join(homeDir, 'Development'),
      path.join(homeDir, 'dev'),
      path.join(homeDir, 'workspace'),
    ];

    for (const searchDir of searchDirs) {
      if (await pathExists(searchDir)) {
        try {
          const hasTurbo = await this.searchForTurboRepos(searchDir, 2);
          if (hasTurbo) return true;
        } catch {
          // Continue searching
        }
      }
    }

    return false;
  }

  private async searchForTurboRepos(dir: string, maxDepth: number): Promise<boolean> {
    if (maxDepth <= 0) return false;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const fullPath = path.join(dir, entry.name);
          
          // Check for turbo.json (Turbo repo indicator)
          const turboJsonPath = path.join(fullPath, 'turbo.json');
          if (await pathExists(turboJsonPath)) {
            return true;
          }

          // Check for package.json with turbo dependency
          const packageJsonPath = path.join(fullPath, 'package.json');
          if (await this.isTurboProject(packageJsonPath)) {
            return true;
          }
          
          // Recursively search
          if (await this.searchForTurboRepos(fullPath, maxDepth - 1)) {
            return true;
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return false;
  }

  private async isTurboProject(packageJsonPath: string): Promise<boolean> {
    try {
      if (!(await pathExists(packageJsonPath))) return false;
      
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      
      // Check for turbo in dependencies or devDependencies
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      return 'turbo' in deps || 'turborepo' in deps;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check if Turbo is installed globally or there are Turbo caches/repos
    const version = await this.getTurboVersion();
    const caches = await this.findTurboCaches();
    const hasRepos = await this.hasTurboRepos();
    
    return version !== null || caches.length > 0 || hasRepos;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const cachePaths = await this.findTurboCaches();
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
      isInstalled: await this.isAvailable(),
      size: totalSize,
    };
  }

  async clear(dryRun = false, _criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    
    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'No Turbo caches found',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    // Try to use turbo prune command if in a turbo repo
    if (!dryRun && await this.getTurboVersion()) {
      const currentDir = process.cwd();
      if (await pathExists(path.join(currentDir, 'turbo.json'))) {
        try {
          await execa('turbo', ['prune', '--scope=*']);
          printVerbose(`${symbols.soap} Executed: turbo prune --scope=*`);
        } catch {
          try {
            await execa('npx', ['turbo', 'prune', '--scope=*']);
            printVerbose(`${symbols.soap} Executed: npx turbo prune --scope=*`);
          } catch (error) {
            printVerbose(`Note: turbo prune failed: ${error}`);
          }
        }
      }
    }

    // Clear cache directories manually
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
}

export default new TurboCleaner();
