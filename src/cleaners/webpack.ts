import { CleanerModule, CacheInfo, ClearResult } from '../types';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import { printVerbose, symbols } from '../utils/cli';

export class WebpackCleaner implements CleanerModule {
  name = 'webpack';
  type = 'build-tool' as const;
  description = 'Webpack build caches and temporary files';

  private async findWebpackCaches(): Promise<string[]> {
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

    // Also check for global webpack caches
    const globalCachePaths = [
      path.join(homeDir, '.webpack'),
      path.join(homeDir, '.cache', 'webpack'),
      path.join(homeDir, 'node_modules', '.cache', 'webpack'),
    ];

    for (const globalPath of globalCachePaths) {
      if (await pathExists(globalPath)) {
        caches.push(globalPath);
      }
    }

    // Search for project-specific webpack caches
    for (const searchDir of searchDirs) {
      if (await pathExists(searchDir)) {
        try {
          const projectCaches = await this.findWebpackCachesRecursively(searchDir, 3);
          caches.push(...projectCaches);
        } catch (error) {
          printVerbose(`Error searching ${searchDir}: ${error}`);
        }
      }
    }

    return [...new Set(caches)]; // Remove duplicates
  }

  private async findWebpackCachesRecursively(dir: string, maxDepth: number): Promise<string[]> {
    if (maxDepth <= 0) return [];

    const webpackCaches: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const fullPath = path.join(dir, entry.name);
          
          // Check for webpack cache directories
          const cacheLocations = [
            path.join(fullPath, 'node_modules', '.cache', 'webpack'),
            path.join(fullPath, '.webpack-cache'),
            path.join(fullPath, 'webpack-cache'),
            path.join(fullPath, '.cache', 'webpack'),
          ];

          for (const cacheLocation of cacheLocations) {
            if (await pathExists(cacheLocation)) {
              webpackCaches.push(cacheLocation);
            }
          }
          
          // Recursively search subdirectories
          const subCaches = await this.findWebpackCachesRecursively(fullPath, maxDepth - 1);
          webpackCaches.push(...subCaches);
        }
      }
    } catch {
      // Ignore permission errors or other issues
    }

    return webpackCaches;
  }

  private async hasWebpackProjects(): Promise<boolean> {
    const homeDir = os.homedir();
    
    // Check current directory first
    const currentDirPackageJson = path.join(process.cwd(), 'package.json');
    if (await this.isWebpackProject(currentDirPackageJson)) {
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
          const hasWebpack = await this.searchForWebpackProjects(searchDir, 2);
          if (hasWebpack) return true;
        } catch {
          // Continue searching
        }
      }
    }

    return false;
  }

  private async searchForWebpackProjects(dir: string, maxDepth: number): Promise<boolean> {
    if (maxDepth <= 0) return false;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const fullPath = path.join(dir, entry.name);
          const packageJsonPath = path.join(fullPath, 'package.json');
          
          if (await this.isWebpackProject(packageJsonPath)) {
            return true;
          }
          
          // Recursively search
          if (await this.searchForWebpackProjects(fullPath, maxDepth - 1)) {
            return true;
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return false;
  }

  private async isWebpackProject(packageJsonPath: string): Promise<boolean> {
    try {
      if (!(await pathExists(packageJsonPath))) return false;
      
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      
      // Check for webpack in dependencies or devDependencies
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      return 'webpack' in deps || 'webpack-cli' in deps;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check if webpack caches exist or if there are webpack projects
    const caches = await this.findWebpackCaches();
    const hasProjects = await this.hasWebpackProjects();
    
    return caches.length > 0 || hasProjects;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const cachePaths = await this.findWebpackCaches();
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

  async clear(dryRun = false, criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    
    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'No webpack caches found',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

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

export default new WebpackCleaner();
