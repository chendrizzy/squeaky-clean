import { BaseCleaner } from './BaseCleaner';
import { CacheInfo, CacheCategory, CacheType } from '../types';
import { existsSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { printVerbose } from '../utils/cli';

const execAsync = promisify(exec);

export class NodeGypCleaner extends BaseCleaner {
  name = 'node-gyp';
  type: CacheType = 'build-tool';
  description = 'Node.js native addon build tool cache';

  private getCachePaths(): string[] {
    const paths: string[] = [];
    const homeDir = os.homedir();
    
    // Main node-gyp cache location
    paths.push(path.join(homeDir, '.node-gyp'));
    
    // Platform-specific locations
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
      paths.push(path.join(localAppData, 'node-gyp', 'Cache'));
    } else if (process.platform === 'darwin') {
      paths.push(path.join(homeDir, 'Library', 'Caches', 'node-gyp'));
    } else {
      // Linux
      const xdgCache = process.env.XDG_CACHE_HOME || path.join(homeDir, '.cache');
      paths.push(path.join(xdgCache, 'node-gyp'));
    }
    
    // Node.js headers cache
    paths.push(path.join(homeDir, '.npm', '_cacache'));
    
    // Build directories in current projects
    const projectBuildDirs = [
      'build',
      'Release',
      'Debug',
      'build/Release',
      'build/Debug',
    ];
    
    const cwd = process.cwd();
    for (const buildDir of projectBuildDirs) {
      const buildPath = path.join(cwd, buildDir);
      // Only include if it contains node-gyp artifacts
      if (existsSync(path.join(buildPath, 'build.ninja')) || 
          existsSync(path.join(buildPath, 'Makefile')) ||
          existsSync(path.join(buildPath, '.node'))) {
        paths.push(buildPath);
      }
    }
    
    return paths;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if node-gyp is installed
      await execAsync('node-gyp --version');
      return true;
    } catch {
      // Check if node-gyp cache directory exists
      const homeDir = os.homedir();
      const nodeGypDir = path.join(homeDir, '.node-gyp');
      return existsSync(nodeGypDir);
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const paths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;
    let oldestCache: Date | undefined;
    let newestCache: Date | undefined;

    for (const cachePath of paths) {
      if (existsSync(cachePath)) {
        existingPaths.push(cachePath);
        const size = await this.getDirectorySize(cachePath);
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

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: existingPaths,
      isInstalled: await this.isAvailable(),
      totalSize: totalSize,
      oldestCache,
      newestCache,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const categories: CacheCategory[] = [];
    const paths = this.getCachePaths();
    
    for (const cachePath of paths) {
      if (!existsSync(cachePath)) continue;
      
      const baseName = path.basename(cachePath);
      let categoryName = 'Build Cache';
      let priority: CacheCategory['priority'] = 'normal';
      let useCase: CacheCategory['useCase'] = 'development';
      
      // Categorize by type
      if (cachePath.includes('.node-gyp')) {
        categoryName = 'Node.js Headers Cache';
        priority = 'low'; // These can be redownloaded
      } else if (cachePath.includes('build') || cachePath.includes('Release') || cachePath.includes('Debug')) {
        categoryName = 'Build Artifacts';
        priority = this.isRecentlyUsed(cachePath, 3) ? 'important' : 'normal';
        useCase = cachePath.includes('Debug') ? 'development' : 'production';
      } else if (cachePath.includes('_cacache')) {
        categoryName = 'NPM Binary Cache';
        priority = 'low';
      }
      
      try {
        const stat = statSync(cachePath);
        const size = await this.getDirectorySize(cachePath);
        
        categories.push({
          id: `node-gyp-${baseName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          name: categoryName,
          description: `Node-gyp cache at ${cachePath}`,
          paths: [cachePath],
          size,
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority: this.getCachePriority(cachePath),
          useCase: this.detectUseCase(cachePath),
          isProjectSpecific: this.isProjectSpecific(cachePath),
          ageInDays: Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24)),
        });
      } catch (error) {
        printVerbose(`Error analyzing ${cachePath}: ${error}`);
      }
    }
    
    return categories;
  }
}

export default new NodeGypCleaner();