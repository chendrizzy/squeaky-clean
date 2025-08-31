import { BaseCleaner } from './BaseCleaner';
import { CacheInfo, CacheCategory, CacheType } from '../types';
import { existsSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { printVerbose } from '../utils/cli';
import { getCacheSize } from '../utils/fs';

export class HomebrewEnhancedCleaner extends BaseCleaner {
  name = 'homebrew';
  type: CacheType = 'package-manager';
  description = 'Homebrew package manager comprehensive cache cleaning';

  private getCachePaths(): string[] {
    const paths: string[] = [];
    
    try {
      // Get Homebrew cache directory
      const cacheDir = execSync('brew --cache', { encoding: 'utf8' }).trim();
      if (cacheDir) paths.push(cacheDir);
      
      // Get Homebrew prefix
      const prefix = execSync('brew --prefix', { encoding: 'utf8' }).trim();
      
      // Common Homebrew cache locations
      if (prefix) {
        paths.push(path.join(prefix, 'Homebrew', '.cache'));
        paths.push(path.join(prefix, 'var', 'homebrew', 'locks'));
        paths.push(path.join(prefix, 'var', 'log', 'homebrew'));
        paths.push(path.join(prefix, 'Cellar', '.DS_Store'));
        paths.push(path.join(prefix, 'Caskroom', '.DS_Store'));
      }
      
      // User-specific caches
      const homeDir = os.homedir();
      paths.push(path.join(homeDir, 'Library', 'Caches', 'Homebrew'));
      paths.push(path.join(homeDir, 'Library', 'Logs', 'Homebrew'));
      
      // Portable Ruby cache
      paths.push(path.join(homeDir, 'Library', 'Caches', 'Homebrew', 'portable-ruby'));
      
      // Downloads
      paths.push(path.join(homeDir, 'Library', 'Caches', 'Homebrew', 'downloads'));
      
      // Cask downloads
      paths.push(path.join(homeDir, 'Library', 'Caches', 'Homebrew', 'Cask'));
      
    } catch (error) {
      printVerbose(`Error getting Homebrew paths: ${error}`);
      
      // Fallback to common locations
      const homeDir = os.homedir();
      paths.push(path.join(homeDir, 'Library', 'Caches', 'Homebrew'));
      paths.push('/opt/homebrew/var/cache');
      paths.push('/usr/local/var/cache/homebrew');
    }
    
    return paths.filter(p => existsSync(p));
  }

  async isAvailable(): Promise<boolean> {
    // Only works on macOS and Linux
    if (os.platform() !== 'darwin' && os.platform() !== 'linux') {
      return false;
    }

    try {
      execSync('which brew', { stdio: 'ignore' });
      return true;
    } catch {
      // Check if Homebrew cache directories exist
      const homeDir = os.homedir();
      const brewCache = path.join(homeDir, 'Library', 'Caches', 'Homebrew');
      return existsSync(brewCache);
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    if (!await this.isAvailable()) {
      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [],
        isInstalled: false,
        totalSize: 0,
      };
    }

    const paths = this.getCachePaths();
    let totalSize = 0;
    let oldestCache: Date | undefined;
    let newestCache: Date | undefined;

    for (const cachePath of paths) {
      if (existsSync(cachePath)) {
        const size = await getCacheSize(cachePath);
        totalSize += size;
        
        try {
          const stat = statSync(cachePath);
          if (!oldestCache || stat.mtime < oldestCache) {
            oldestCache = stat.mtime;
          }
          if (!newestCache || stat.mtime > newestCache) {
            newestCache = stat.mtime;
          }
        } catch (error) {
          printVerbose(`Error getting stats for ${cachePath}: ${error}`);
        }
      }
    }

    // Get outdated packages size
    try {
      const cleanupDryRun = execSync('brew cleanup -s --dry-run 2>&1', { encoding: 'utf8' });
      const sizeMatch = cleanupDryRun.match(/Would remove: .* \((.+?)\)/);
      if (sizeMatch && sizeMatch[1]) {
        const sizeStr = sizeMatch[1];
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

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths,
      isInstalled: true,
      totalSize,
      oldestCache,
      newestCache,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const categories: CacheCategory[] = [];
    const paths = this.getCachePaths();
    
    // Categorize different types of Homebrew caches
    const categoryMap: { [key: string]: { name: string; priority: CacheCategory['priority']; useCase: CacheCategory['useCase'] } } = {
      'downloads': { name: 'Downloaded Packages', priority: 'low', useCase: 'development' },
      'Cask': { name: 'Cask Applications', priority: 'normal', useCase: 'production' },
      'portable-ruby': { name: 'Portable Ruby', priority: 'low', useCase: 'development' },
      'logs': { name: 'Build Logs', priority: 'low', useCase: 'development' },
      'locks': { name: 'Lock Files', priority: 'low', useCase: 'development' },
      '.cache': { name: 'Internal Cache', priority: 'normal', useCase: 'development' },
    };
    
    for (const cachePath of paths) {
      if (!existsSync(cachePath)) continue;
      
      let categoryName = 'Homebrew Cache';
            // Determine category based on path
      for (const [key, config] of Object.entries(categoryMap)) {
        if (cachePath.toLowerCase().includes(key.toLowerCase())) {
          categoryName = config.name;
          break;
        }
      }
      
      try {
        const stat = statSync(cachePath);
        const size = await getCacheSize(cachePath);
        
        categories.push({
          id: `homebrew-${path.basename(cachePath)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          name: categoryName,
          description: `Homebrew cache at ${cachePath}`,
          paths: [cachePath],
          size,
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority: this.getCachePriority(cachePath),
          useCase: this.detectUseCase(cachePath),
          isProjectSpecific: false,
          ageInDays: Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24)),
        });
      } catch (error) {
        printVerbose(`Error analyzing ${cachePath}: ${error}`);
      }
    }
    
    // Add outdated packages as a category
    try {
      const cleanupDryRun = execSync('brew cleanup -s --dry-run 2>&1', { encoding: 'utf8' });
      const packages = cleanupDryRun.match(/Would remove: (.+?) \(/);
      if (packages) {
        categories.push({
          id: 'homebrew-outdated-packages',
          name: 'Outdated Packages',
          description: 'Old versions of installed packages',
          paths: [],
          priority: 'normal',
          useCase: 'archived',
          isProjectSpecific: false,
          ageInDays: 30, // Estimate
        });
      }
    } catch {
      // Ignore
    }
    
    return categories;
  }

  /**
   * Clear cache with Homebrew's built-in commands when possible
   */
  async clear(dryRun?: boolean, criteria?: any, cacheInfo?: CacheInfo, protectedPaths?: string[]): Promise<any> {
    const result = await super.clear(dryRun, criteria, cacheInfo, protectedPaths);
    
    // Additionally use brew cleanup for thorough cleaning
    if (!dryRun) {
      try {
        // Clean up old versions and downloads
        execSync('brew cleanup -s', { stdio: 'inherit' });
        printVerbose('Executed: brew cleanup -s');
        
        // Prune dead symlinks
        execSync('brew cleanup --prune=all', { stdio: 'inherit' });
        printVerbose('Executed: brew cleanup --prune=all');
        
        // Clean up logs older than 30 days
        execSync('brew cleanup --prune-logs=30', { stdio: 'inherit' });
        printVerbose('Executed: brew cleanup --prune-logs=30');
      } catch (error) {
        printVerbose(`Note: brew cleanup commands failed: ${error}`);
      }
    }
    
    return result;
  }
}

export default new HomebrewEnhancedCleaner();