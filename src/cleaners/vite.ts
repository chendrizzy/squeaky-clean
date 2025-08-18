import { CleanerModule, CacheInfo, ClearResult } from '../types';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import { printVerbose, symbols } from '../utils/cli';

export class ViteCleaner implements CleanerModule {
  name = 'vite';
  type = 'build-tool' as const;
  description = 'Vite build tool caches and temporary files';

  private async findViteCaches(): Promise<string[]> {
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

    // Search for project-specific vite caches
    for (const searchDir of searchDirs) {
      if (await pathExists(searchDir)) {
        try {
          const projectCaches = await this.findViteCachesRecursively(searchDir, 3);
          caches.push(...projectCaches);
        } catch (error) {
          printVerbose(`Error searching ${searchDir}: ${error}`);
        }
      }
    }

    return [...new Set(caches)]; // Remove duplicates
  }

  private async findViteCachesRecursively(dir: string, maxDepth: number): Promise<string[]> {
    if (maxDepth <= 0) return [];

    const viteCaches: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const fullPath = path.join(dir, entry.name);
          
          // Check for vite cache directories
          const cacheLocations = [
            path.join(fullPath, 'node_modules', '.vite'),
            path.join(fullPath, '.vite'),
            path.join(fullPath, 'dist'), // Vite output directory
          ];

          for (const cacheLocation of cacheLocations) {
            if (await pathExists(cacheLocation)) {
              // For dist folders, only include if it's actually a vite project
              if (cacheLocation.endsWith('dist')) {
                const packageJsonPath = path.join(fullPath, 'package.json');
                if (await this.isViteProject(packageJsonPath)) {
                  viteCaches.push(cacheLocation);
                }
              } else {
                viteCaches.push(cacheLocation);
              }
            }
          }
          
          // Recursively search subdirectories
          const subCaches = await this.findViteCachesRecursively(fullPath, maxDepth - 1);
          viteCaches.push(...subCaches);
        }
      }
    } catch {
      // Ignore permission errors or other issues
    }

    return viteCaches;
  }

  private async hasViteProjects(): Promise<boolean> {
    const homeDir = os.homedir();
    
    // Check current directory first
    const currentDirPackageJson = path.join(process.cwd(), 'package.json');
    if (await this.isViteProject(currentDirPackageJson)) {
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
          const hasVite = await this.searchForViteProjects(searchDir, 2);
          if (hasVite) return true;
        } catch {
          // Continue searching
        }
      }
    }

    return false;
  }

  private async searchForViteProjects(dir: string, maxDepth: number): Promise<boolean> {
    if (maxDepth <= 0) return false;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const fullPath = path.join(dir, entry.name);
          const packageJsonPath = path.join(fullPath, 'package.json');
          
          if (await this.isViteProject(packageJsonPath)) {
            return true;
          }
          
          // Check for vite config files
          const viteConfigFiles = [
            'vite.config.js',
            'vite.config.ts',
            'vite.config.mjs',
            'vite.config.cjs',
          ];

          for (const configFile of viteConfigFiles) {
            if (await pathExists(path.join(fullPath, configFile))) {
              return true;
            }
          }
          
          // Recursively search
          if (await this.searchForViteProjects(fullPath, maxDepth - 1)) {
            return true;
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return false;
  }

  private async isViteProject(packageJsonPath: string): Promise<boolean> {
    try {
      if (!(await pathExists(packageJsonPath))) return false;
      
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      
      // Check for vite in dependencies or devDependencies
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      return 'vite' in deps || '@vitejs/plugin-react' in deps || '@vitejs/plugin-vue' in deps;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check if vite caches exist or if there are vite projects
    const caches = await this.findViteCaches();
    const hasProjects = await this.hasViteProjects();
    
    return caches.length > 0 || hasProjects;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const cachePaths = await this.findViteCaches();
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

  async clear(dryRun = false): Promise<ClearResult> {
    const cacheInfo = await this.getCacheInfo();
    
    if (!cacheInfo.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'No Vite caches found',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = cacheInfo.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    for (const cachePath of cacheInfo.paths) {
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

export default new ViteCleaner();
