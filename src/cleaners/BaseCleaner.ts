import { CleanerModule, CacheInfo, CacheCategory, ClearResult, CacheType, CacheSelectionCriteria } from '../types';
import { existsSync, statSync } from 'fs';
import { basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export abstract class BaseCleaner implements CleanerModule {
  abstract name: string;
  abstract type: CacheType;
  abstract description: string;

  abstract isAvailable(): Promise<boolean>;
  abstract getCacheInfo(): Promise<CacheInfo>;

  /**
   * Get detailed cache categories with metadata
   */
  async getCacheCategories(): Promise<CacheCategory[]> {
    // Default implementation - override in specific cleaners
    const info = await this.getCacheInfo();
    const categories: CacheCategory[] = [];

    for (const path of info.paths) {
      if (existsSync(path)) {
        const stat = statSync(path);
        const category: CacheCategory = {
          id: `${this.name}-${basename(path)}`,
          name: basename(path),
          description: `Cache directory: ${path}`,
          paths: [path],
          size: await this.getDirectorySize(path),
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority: 'normal',
          useCase: 'development',
          ageInDays: Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24))
        };
        categories.push(category);
      }
    }

    return categories;
  }

  /**
   * Clear cache with selection criteria
   */
  async clear(dryRun?: boolean, criteria?: CacheSelectionCriteria): Promise<ClearResult> {
    const categories = await this.getCacheCategories();
    const filteredCategories = this.filterCategories(categories, criteria);
    
    let totalSizeBefore = 0;
    let clearedPaths: string[] = [];
    let clearedCategories: string[] = [];

    for (const category of filteredCategories) {
      totalSizeBefore += category.size || 0;
      clearedPaths.push(...category.paths);
      clearedCategories.push(category.id);
    }

    if (!dryRun) {
      // Actual clearing logic would go here
      for (const path of clearedPaths) {
        await this.clearPath(path);
      }
    }

    return {
      name: this.name,
      success: true,
      sizeBefore: totalSizeBefore,
      sizeAfter: dryRun ? totalSizeBefore : 0,
      clearedPaths,
      clearedCategories
    };
  }

  /**
   * Clear specific categories
   */
  async clearByCategory(categoryIds: string[], dryRun?: boolean): Promise<ClearResult> {
    const categories = await this.getCacheCategories();
    const selectedCategories = categories.filter(c => categoryIds.includes(c.id));
    
    let totalSizeBefore = 0;
    let clearedPaths: string[] = [];
    let clearedCategories: string[] = [];

    for (const category of selectedCategories) {
      totalSizeBefore += category.size || 0;
      clearedPaths.push(...category.paths);
      clearedCategories.push(category.id);
    }

    if (!dryRun) {
      for (const path of clearedPaths) {
        await this.clearPath(path);
      }
    }

    return {
      name: this.name,
      success: true,
      sizeBefore: totalSizeBefore,
      sizeAfter: dryRun ? totalSizeBefore : 0,
      clearedPaths,
      clearedCategories
    };
  }

  /**
   * Filter categories based on criteria
   */
  protected filterCategories(categories: CacheCategory[], criteria?: CacheSelectionCriteria): CacheCategory[] {
    if (!criteria) return categories;

    return categories.filter(category => {
      // Age filtering
      if (criteria.olderThanDays !== undefined && category.ageInDays !== undefined) {
        if (category.ageInDays < criteria.olderThanDays) return false;
      }
      if (criteria.newerThanDays !== undefined && category.ageInDays !== undefined) {
        if (category.ageInDays > criteria.newerThanDays) return false;
      }

      // Size filtering
      if (criteria.largerThanMB !== undefined && category.size !== undefined) {
        if (category.size < criteria.largerThanMB * 1024 * 1024) return false;
      }
      if (criteria.smallerThanMB !== undefined && category.size !== undefined) {
        if (category.size > criteria.smallerThanMB * 1024 * 1024) return false;
      }

      // Use case filtering
      if (criteria.useCases && criteria.useCases.length > 0) {
        if (!criteria.useCases.includes(category.useCase)) return false;
      }

      // Priority filtering
      if (criteria.priorities && criteria.priorities.length > 0) {
        if (!criteria.priorities.includes(category.priority)) return false;
      }

      // Project-specific filtering
      if (criteria.projectSpecific !== undefined) {
        if (category.isProjectSpecific !== criteria.projectSpecific) return false;
      }

      // Category ID filtering
      if (criteria.categories && criteria.categories.length > 0) {
        if (!criteria.categories.includes(category.id)) return false;
      }

      return true;
    });
  }

  /**
   * Get directory size in bytes
   */
  protected async getDirectorySize(path: string): Promise<number> {
    if (!existsSync(path)) return 0;

    try {
      // Use du command for accurate size calculation
      const { stdout } = await execAsync(`du -sk "${path}" 2>/dev/null || echo "0"`);
      const sizeKB = parseInt(stdout.split('\t')[0]) || 0;
      return sizeKB * 1024;
    } catch {
      return 0;
    }
  }

  /**
   * Clear a specific path
   */
  protected async clearPath(path: string): Promise<void> {
    if (!existsSync(path)) return;

    try {
      const stat = statSync(path);
      if (stat.isDirectory()) {
        await execAsync(`rm -rf "${path}"`);
      } else {
        await execAsync(`rm -f "${path}"`);
      }
    } catch (error) {
      console.error(`Failed to clear ${path}:`, error);
    }
  }

  /**
   * Detect if a path has been recently used
   */
  protected isRecentlyUsed(path: string, days: number = 7): boolean {
    if (!existsSync(path)) return false;

    try {
      const stat = statSync(path);
      const daysSinceAccess = (Date.now() - stat.atime.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceAccess < days;
    } catch {
      return false;
    }
  }

  /**
   * Detect if a path is project-specific
   */
  protected isProjectSpecific(path: string): boolean {
    // Check if path contains common project indicators
    const projectIndicators = [
      'node_modules/.cache',
      'target/debug',
      'target/release',
      'build/cache',
      '.next/cache',
      '.nuxt/cache',
      'dist/cache'
    ];

    return projectIndicators.some(indicator => path.includes(indicator));
  }

  /**
   * Get cache priority based on path and usage
   */
  protected getCachePriority(path: string): 'critical' | 'important' | 'normal' | 'low' {
    // Critical: Currently active project caches
    if (this.isRecentlyUsed(path, 1)) return 'critical';
    
    // Important: Recently used (within a week)
    if (this.isRecentlyUsed(path, 7)) return 'important';
    
    // Low: Very old caches
    if (!this.isRecentlyUsed(path, 30)) return 'low';
    
    // Normal: Everything else
    return 'normal';
  }

  /**
   * Detect use case based on path patterns
   */
  protected detectUseCase(path: string): 'development' | 'testing' | 'production' | 'experimental' | 'archived' {
    if (path.includes('test') || path.includes('spec')) return 'testing';
    if (path.includes('prod') || path.includes('release')) return 'production';
    if (path.includes('exp') || path.includes('beta')) return 'experimental';
    if (!this.isRecentlyUsed(path, 90)) return 'archived';
    return 'development';
  }
}