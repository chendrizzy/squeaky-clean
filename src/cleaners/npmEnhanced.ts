import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import execa from 'execa';
import { CacheInfo, ClearResult, CacheCategory, CacheSelectionCriteria } from '../types';
import { pathExists } from '../utils/fs';
import { printVerbose } from '../utils/cli';
import { BaseCleaner } from './BaseCleaner';
import { statSync, existsSync } from 'fs';
import minimatch from 'minimatch';

export class NpmEnhancedCleaner extends BaseCleaner {
  name = 'npm';
  type = 'package-manager' as const;
  description = 'NPM package manager cache with granular control';

  private getCachePaths(): string[] {
    const paths = [];
    const homeDir = os.homedir();
    
    // Primary npm cache location
    paths.push(path.join(homeDir, '.npm'));
    
    // Alternative cache locations on different platforms
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      paths.push(path.join(appData, 'npm-cache'));
    } else if (process.platform === 'darwin') {
      paths.push(path.join(homeDir, 'Library', 'Caches', 'npm'));
    }
    
    // Node modules cache directories (common locations)
    const commonCachePaths = [
      'node_modules/.cache',
      '.npm-cache',
      'npm-cache',
    ];
    
    // Check current working directory and parent directories
    let currentDir = process.cwd();
    const rootDir = path.parse(currentDir).root;
    let depth = 0;
    const maxDepth = 5;
    
    while (currentDir !== rootDir && depth < maxDepth) {
      for (const cachePath of commonCachePaths) {
        paths.push(path.join(currentDir, cachePath));
      }
      currentDir = path.dirname(currentDir);
      depth++;
    }
    
    return paths;
  }

  async isAvailable(): Promise<boolean> {
    try {
      printVerbose('Checking if npm is installed...');
      await execa('npm', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const categories: CacheCategory[] = [];
    const allPaths = this.getCachePaths();
    
    for (const cachePath of allPaths) {
      if (await pathExists(cachePath)) {
        const stat = statSync(cachePath);
        const ageInDays = Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24));
        
        // Main npm cache
        if (cachePath.includes('.npm')) {
          // Try to categorize by package types within npm cache
          const subCategories = await this.getNpmCacheSubCategories(cachePath);
          categories.push(...subCategories);
        }
        // Project-specific caches
        else if (cachePath.includes('node_modules/.cache')) {
          const projectPath = cachePath.replace('/node_modules/.cache', '');
          const projectName = path.basename(projectPath);
          
          // Check for specific build tool caches
          const buildToolCaches = await this.getBuildToolCaches(cachePath, projectName);
          categories.push(...buildToolCaches);
        }
        // General npm cache
        else {
          categories.push({
            id: `npm-general-${path.basename(cachePath)}`,
            name: `General NPM Cache (${path.basename(cachePath)})`,
            description: `General npm cache at ${cachePath}`,
            paths: [cachePath],
            size: await this.getDirectorySize(cachePath),
            lastModified: stat.mtime,
            lastAccessed: stat.atime,
            priority: this.getCachePriority(cachePath),
            useCase: this.detectUseCase(cachePath),
            isProjectSpecific: this.isProjectSpecific(cachePath),
            projectPath: this.isProjectSpecific(cachePath) ? path.dirname(cachePath) : undefined,
            ageInDays
          });
        }
      }
    }
    
    return categories;
  }

  private async getNpmCacheSubCategories(npmCachePath: string): Promise<CacheCategory[]> {
    const categories: CacheCategory[] = [];
    
    try {
      // Check for _cacache (npm's content-addressable cache)
      const cacachePath = path.join(npmCachePath, '_cacache');
      if (existsSync(cacachePath)) {
        const stat = statSync(cacachePath);
        categories.push({
          id: 'npm-cacache',
          name: 'NPM Package Cache',
          description: 'Cached npm packages (can be safely cleared)',
          paths: [cacachePath],
          size: await this.getDirectorySize(cacachePath),
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority: 'low',
          useCase: 'development',
          ageInDays: Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24))
        });
      }

      // Check for _logs
      const logsPath = path.join(npmCachePath, '_logs');
      if (existsSync(logsPath)) {
        const stat = statSync(logsPath);
        categories.push({
          id: 'npm-logs',
          name: 'NPM Debug Logs',
          description: 'NPM debug and error logs',
          paths: [logsPath],
          size: await this.getDirectorySize(logsPath),
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority: 'low',
          useCase: 'development',
          ageInDays: Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24))
        });
      }

      // Check for anonymous-cli-metrics
      const metricsPath = path.join(npmCachePath, 'anonymous-cli-metrics.json');
      if (existsSync(metricsPath)) {
        const stat = statSync(metricsPath);
        categories.push({
          id: 'npm-metrics',
          name: 'NPM Metrics',
          description: 'Anonymous CLI usage metrics',
          paths: [metricsPath],
          size: stat.size,
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority: 'low',
          useCase: 'development',
          ageInDays: Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24))
        });
      }

    } catch (error) {
      printVerbose(`Error analyzing npm cache subcategories: ${error}`);
    }
    
    return categories;
  }

  private async getBuildToolCaches(cachePath: string, projectName: string): Promise<CacheCategory[]> {
    const categories: CacheCategory[] = [];
    
    try {
      const entries = await fs.readdir(cachePath);
      
      for (const entry of entries) {
        const fullPath = path.join(cachePath, entry);
        const stat = statSync(fullPath);
        
        let categoryName = '';
        let description = '';
        let priority: 'critical' | 'important' | 'normal' | 'low' = 'normal';
        let useCase: 'development' | 'testing' | 'production' | 'experimental' | 'archived' = 'development';
        
        // Identify specific build tool caches
        if (entry.includes('webpack')) {
          categoryName = 'Webpack Build Cache';
          description = 'Webpack module build cache';
          priority = this.isRecentlyUsed(fullPath, 3) ? 'important' : 'normal';
        } else if (entry.includes('babel')) {
          categoryName = 'Babel Transform Cache';
          description = 'Babel transpilation cache';
          priority = 'normal';
        } else if (entry.includes('eslint')) {
          categoryName = 'ESLint Cache';
          description = 'ESLint analysis cache';
          priority = 'low';
        } else if (entry.includes('jest')) {
          categoryName = 'Jest Test Cache';
          description = 'Jest test runner cache';
          useCase = 'testing';
          priority = 'normal';
        } else if (entry.includes('terser')) {
          categoryName = 'Terser Minification Cache';
          description = 'JavaScript minification cache';
          priority = 'low';
        } else if (entry.includes('next')) {
          categoryName = 'Next.js Build Cache';
          description = 'Next.js compilation and optimization cache';
          priority = this.isRecentlyUsed(fullPath, 1) ? 'critical' : 'important';
        } else if (entry.includes('vite')) {
          categoryName = 'Vite Build Cache';
          description = 'Vite dev server and build cache';
          priority = this.isRecentlyUsed(fullPath, 1) ? 'critical' : 'important';
        } else {
          categoryName = `${entry} Cache`;
          description = `Cache for ${entry}`;
        }
        
        categories.push({
          id: `npm-${projectName}-${entry}`,
          name: `${projectName}: ${categoryName}`,
          description: `${description} for project ${projectName}`,
          paths: [fullPath],
          size: await this.getDirectorySize(fullPath),
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority,
          useCase,
          isProjectSpecific: true,
          projectPath: cachePath.replace('/node_modules/.cache', ''),
          ageInDays: Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24))
        });
      }
    } catch (error) {
      printVerbose(`Error analyzing build tool caches: ${error}`);
    }
    
    return categories;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const categories = await this.getCacheCategories();
    const allPaths = [...new Set(categories.flatMap(c => c.paths))];
    
    let totalSize = 0;
    let oldestCache: Date | undefined;
    let newestCache: Date | undefined;
    
    for (const category of categories) {
      totalSize += category.size || 0;
      
      if (category.lastModified) {
        if (!oldestCache || category.lastModified < oldestCache) {
          oldestCache = category.lastModified;
        }
        if (!newestCache || category.lastModified > newestCache) {
          newestCache = category.lastModified;
        }
      }
    }
    
    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: allPaths,
      isInstalled: await this.isAvailable(),
      size: totalSize,
      totalSize,
      categories,
      oldestCache,
      newestCache,
      lastModified: newestCache
    };
  }

  async clear(dryRun = false, criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo, protectedPaths: string[] = []): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    const categories = info.categories || [];
    const filteredCategories = this.filterCategories(categories, criteria);
    
    let totalSizeBefore = 0;
    let totalSizeAfter = 0;
    const clearedPaths: string[] = [];
    const clearedCategoryIds: string[] = [];
    
    for (const category of filteredCategories) {
      totalSizeBefore += category.size || 0;
      
      // Filter paths within the category based on protectedPaths
      const pathsToClearInCategory = category.paths.filter(cachePath => {
        const isProtected = protectedPaths.some(protectedPattern => 
          minimatch(cachePath, protectedPattern, { dot: true })
        );
        if (isProtected) {
          printVerbose(`Skipping protected path in category ${category.name}: ${cachePath}`);
        }
        return !isProtected;
      });

      if (dryRun) {
        printVerbose(`[DRY RUN] Would clear ${category.name}: ${pathsToClearInCategory.join(', ')}`);
        totalSizeAfter += category.size || 0; // No change in dry run
      } else {
        try {
          for (const path of pathsToClearInCategory) { // Iterate over filtered paths
            await this.clearPath(path);
            clearedPaths.push(path);
          }
          clearedCategoryIds.push(category.id);
          printVerbose(`Cleared ${category.name}`);
        } catch (error) {
          printVerbose(`Failed to clear ${category.name}: ${error}`);
          totalSizeAfter += category.size || 0; // Add back size if failed
        }
      }
    }
    
    return {
      name: this.name,
      success: true,
      sizeBefore: totalSizeBefore,
      sizeAfter: dryRun ? totalSizeBefore : totalSizeAfter,
      clearedPaths,
      clearedCategories: clearedCategoryIds
    };
  }

  async clearByCategory(categoryIds: string[], dryRun = false, cacheInfo?: CacheInfo, protectedPaths: string[] = []): Promise<ClearResult> {
    // Use the existing clear method, but filter by categoryIds
    const criteria: CacheSelectionCriteria = {
      categories: categoryIds,
    };
    return this.clear(dryRun, criteria, cacheInfo, protectedPaths);
  }

  // Static method to create instance
  static create(): NpmEnhancedCleaner {
    return new NpmEnhancedCleaner();
  }
}

// Export default instance
export default NpmEnhancedCleaner.create();