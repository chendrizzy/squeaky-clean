import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import execa from 'execa';
import { CacheInfo, ClearResult, CleanerModule } from '../types';
import { getDirectorySize, pathExists, safeRmrf } from '../utils/fs';
import { printVerbose } from '../utils/cli';
import minimatch from 'minimatch';

export class GradleCleaner implements CleanerModule {
  name = 'gradle';
  type = 'build-tool' as const;
  description = 'Gradle build cache, daemon logs, wrapper distributions, and temporary files';

  private getCachePaths(): Array<{ path: string; description: string; category: string }> {
    const homeDir = os.homedir();
    
    return [
      // Main Gradle user home directory contents
      {
        path: path.join(homeDir, '.gradle', 'caches'),
        description: 'Gradle build caches and dependency caches',
        category: 'Build Cache'
      },
      {
        path: path.join(homeDir, '.gradle', 'daemon'),
        description: 'Gradle daemon logs and lock files',
        category: 'Daemon'
      },
      {
        path: path.join(homeDir, '.gradle', 'wrapper', 'dists'),
        description: 'Downloaded Gradle wrapper distributions',
        category: 'Wrapper'
      },
      
      // Build scan and configuration cache
      {
        path: path.join(homeDir, '.gradle', 'configuration-cache'),
        description: 'Gradle configuration cache',
        category: 'Configuration Cache'
      },
      {
        path: path.join(homeDir, '.gradle', 'buildOutputCleanup'),
        description: 'Build output cleanup cache',
        category: 'Build Cache'
      },
      
      // Temporary and worker files
      {
        path: path.join(homeDir, '.gradle', 'workers'),
        description: 'Gradle worker process files',
        category: 'Workers'
      },
      {
        path: path.join(homeDir, '.gradle', '.tmp'),
        description: 'Temporary Gradle files',
        category: 'Temporary'
      },
      
      // Kotlin daemon and caches (if using Kotlin)
      {
        path: path.join(homeDir, '.gradle', 'kotlin-profile'),
        description: 'Kotlin compilation profiling data',
        category: 'Kotlin'
      },
      
      // Android-specific Gradle caches (if doing Android development)
      {
        path: path.join(homeDir, '.gradle', 'caches', 'transforms-3'),
        description: 'Android transform cache (can be very large)',
        category: 'Android'
      },
      {
        path: path.join(homeDir, '.gradle', 'caches', 'transforms-2'),
        description: 'Legacy Android transform cache',
        category: 'Android'
      },
      
      // Project-specific build directories (in current working directory tree)
      {
        path: path.join(process.cwd(), 'build'),
        description: 'Current project build directory',
        category: 'Project Build'
      },
      {
        path: path.join(process.cwd(), '.gradle'),
        description: 'Current project Gradle cache',
        category: 'Project Build'
      }
    ];
  }

  async isAvailable(): Promise<boolean> {
    try {
      printVerbose('Checking if Gradle is available...');
      
      // Check for gradle command with timeout
      try {
        await execa('gradle', ['--version'], { timeout: 5000 }); // 5 second timeout
        printVerbose('Found gradle command in PATH');
        return true;
      } catch {
        // Try gradlew
        try {
          await execa('./gradlew', ['--version'], { timeout: 5000 }); // 5 second timeout
          printVerbose('Found gradlew in current directory');
          return true;
        } catch {
          // Check for Gradle user directory (indicates Gradle usage)
          const homeDir = os.homedir();
          const gradleHome = path.join(homeDir, '.gradle');
          
          if (await pathExists(gradleHome)) {
            printVerbose(`Found Gradle user directory: ${gradleHome}`);
            return true;
          }
        }
      }
      
      return false;
    } catch {
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const allPaths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;
    let lastModified: Date | undefined;
    const categories = new Map<string, { size: number; count: number }>();

    printVerbose(`Checking ${allPaths.length} Gradle cache locations...`);

    for (const { path: cachePath, description, category } of allPaths) {
      if (await pathExists(cachePath)) {
        existingPaths.push(cachePath);
        
        try {
          const size = await getDirectorySize(cachePath);
          totalSize += size;
          
          // Track by category
          const existing = categories.get(category) || { size: 0, count: 0 };
          categories.set(category, { 
            size: existing.size + size, 
            count: existing.count + 1 
          });
          
          const stats = await fs.stat(cachePath);
          if (!lastModified || stats.mtime > lastModified) {
            lastModified = stats.mtime;
          }
          
          const sizeInMB = (size / (1024 * 1024)).toFixed(1);
          printVerbose(`Found ${category}: ${cachePath} (${sizeInMB} MB) - ${description}`);
        } catch (error) {
          printVerbose(`Error checking ${cachePath}: ${error}`);
        }
      }
    }

    // Log category summary
    if (categories.size > 0) {
      printVerbose('=== Gradle Cache Summary by Category ===');
      categories.forEach((info, category) => {
        const sizeInMB = (info.size / (1024 * 1024)).toFixed(1);
        printVerbose(`${category}: ${info.count} locations, ${sizeInMB} MB`);
      });
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: existingPaths,
      isInstalled: await this.isAvailable(),
      size: totalSize,
      lastModified,
    };
  }

  async clear(dryRun = false, criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo, protectedPaths: string[] = []): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    const clearedPaths: string[] = [];
    const sizeBefore = info.size || 0;
    let success = true;
    let error: string | undefined;

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'Gradle is not available',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    if (info.paths.length === 0) {
      printVerbose('No Gradle cache directories found');
      return {
        name: this.name,
        success: true,
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    try {
      if (dryRun) {
        printVerbose(`[DRY RUN] Would clear ${info.paths.length} Gradle cache locations:`);
        const pathsWithInfo = this.getCachePaths();
        for (const cachePath of info.paths) {
          const pathInfo = pathsWithInfo.find(p => p.path === cachePath);
          printVerbose(`  • ${pathInfo?.category || 'Unknown'}: ${cachePath}`);
          if (pathInfo?.description) {
            printVerbose(`    ${pathInfo.description}`);
          }
        }
        printVerbose('Would also try to stop Gradle daemons gracefully');
        return {
          name: this.name,
          success: true,
          sizeBefore,
          sizeAfter: sizeBefore,
          clearedPaths: info.paths,
        };
      }

      // First, try to stop Gradle daemons gracefully
      try {
        printVerbose('Stopping Gradle daemons...');
        await execa('gradle', ['--stop'], { timeout: 10000 }); // Shorter timeout
        printVerbose('Gradle daemons stopped successfully');
      } catch (stopError) {
        printVerbose(`Could not stop Gradle daemons: ${stopError}`);
        // Continue anyway - the daemon files might still be clearable
      }

      const pathsWithInfo = this.getCachePaths();
      
      // Clear caches by category priority (safest first)
      const priorityOrder = [
        'Temporary',
        'Daemon',
        'Workers',
        'Kotlin',
        'Configuration Cache',
        'Build Cache',
        'Android',
        'Project Build',
        'Wrapper'  // Keep wrapper dists for last as they take time to re-download
      ];

      const categorizedPaths = new Map<string, string[]>();
      for (const cachePath of info.paths) {
        const pathInfo = pathsWithInfo.find(p => p.path === cachePath);
        const category = pathInfo?.category || 'Other';
        
        if (!categorizedPaths.has(category)) {
          categorizedPaths.set(category, []);
        }
        categorizedPaths.get(category)!.push(cachePath);
      }

      // Clear in priority order
      for (const category of priorityOrder) {
        const paths = categorizedPaths.get(category);
        if (!paths) continue;

        printVerbose(`Clearing ${category} caches...`);
        
        for (const cachePath of paths) {
          // Check if the path is protected
          const isProtected = protectedPaths.some(protectedPattern => 
            minimatch(cachePath, protectedPattern, { dot: true })
          );

          if (isProtected) {
            printVerbose(`Skipping protected path: ${cachePath}`);
            continue; // Skip this path
          }

          try {
            if (await pathExists(cachePath)) {
              const pathInfo = pathsWithInfo.find(p => p.path === cachePath);
              
              printVerbose(`Clearing ${category}: ${cachePath}`);
              if (pathInfo?.description) {
                printVerbose(`  Purpose: ${pathInfo.description}`);
              }
              
              await safeRmrf(cachePath);
              clearedPaths.push(cachePath);
            }
          } catch (pathError) {
            printVerbose(`Failed to clear ${cachePath}: ${pathError}`);
            success = false;
            if (!error) {
              error = `Failed to clear some Gradle cache directories: ${pathError}`;
            }
          }
        }
      }

      // Handle any remaining uncategorized paths
      const remainingPaths = info.paths.filter(p => !clearedPaths.includes(p));
      for (const cachePath of remainingPaths) {
        // Check if the path is protected
        const isProtected = protectedPaths.some(protectedPattern => 
          minimatch(cachePath, protectedPattern, { dot: true })
        );

        if (isProtected) {
          printVerbose(`Skipping protected path: ${cachePath}`);
          continue; // Skip this path
        }

        try {
          if (await pathExists(cachePath)) {
            printVerbose(`Clearing remaining cache: ${cachePath}`);
            await safeRmrf(cachePath);
            clearedPaths.push(cachePath);
          }
        } catch (pathError) {
          printVerbose(`Failed to clear ${cachePath}: ${pathError}`);
          success = false;
          if (!error) {
            error = `Failed to clear some cache directories: ${pathError}`;
          }
        }
      }

      if (sizeBefore > 0) {
        printVerbose(`Freed space from Gradle cache data`);
      }

      return {
        name: this.name,
        success,
        sizeBefore,
        sizeAfter: 0, // Set to 0 as we don't want to rescan
        error,
        clearedPaths,
      };
    } catch (clearError) {
      return {
        name: this.name,
        success: false,
        sizeBefore,
        sizeAfter: sizeBefore,
        error: clearError instanceof Error ? clearError.message : String(clearError),
        clearedPaths: [],
      };
    }
  }

  static create(): GradleCleaner {
    return new GradleCleaner();
  }
}

export default GradleCleaner.create();
