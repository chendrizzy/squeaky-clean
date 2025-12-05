import {
  CleanerModule,
  CacheInfo,
  ClearResult,
  CacheSelectionCriteria,
} from "../types";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import {
  pathExists,
  getCachedDirectorySize,
  safeRmrf,
  invalidateSizeCachePrefix,
} from "../utils/fs";
import execa from "execa";
import { printVerbose, symbols } from "../utils/cli";
import { checkToolAvailability } from "../utils/cache";

class YarnCleaner implements CleanerModule {
  name = "yarn";
  type = "package-manager" as const;
  description = "Yarn package manager caches and global store";

  private async getYarnVersion(): Promise<string | null> {
    try {
      const result = await execa("yarn", ["--version"]);
      return result.stdout.trim();
    } catch {
      return null;
    }
  }

  private async getYarnCachePaths(): Promise<string[]> {
    const paths: string[] = [];

    try {
      // Get yarn cache directory
      const cacheResult = await execa("yarn", ["cache", "dir"]);
      const cacheDir = cacheResult.stdout.trim();
      if (await pathExists(cacheDir)) {
        paths.push(cacheDir);
      }
    } catch {
      // Fallback to default yarn cache locations
      const homeDir = os.homedir();
      const defaultPaths = [
        path.join(homeDir, ".yarn", "cache"),
        path.join(homeDir, ".cache", "yarn"),
        path.join(homeDir, "Library", "Caches", "Yarn"), // macOS
      ];

      for (const cachePath of defaultPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    }

    // Look for project-specific yarn caches
    try {
      // Yarn v2+ .yarn/cache directories in projects
      const projectCaches = await this.findProjectYarnCaches();
      paths.push(...projectCaches);
    } catch (error) {
      printVerbose(`Error finding project yarn caches: ${error}`);
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  private async findProjectYarnCaches(): Promise<string[]> {
    const projectCaches: string[] = [];
    const homeDir = os.homedir();

    // Only search current directory and immediate common dev dirs to avoid performance issues
    const searchDirs = [
      process.cwd(), // Current directory
      path.join(homeDir, "Projects"), // Only if it exists and isn't huge
      path.join(homeDir, "Development"),
      path.join(homeDir, "dev"),
    ];

    // Add timeout to prevent hanging
    const searchTimeout = 5000; // 5 seconds max for project search
    const startTime = Date.now();

    for (const searchDir of searchDirs) {
      // Check timeout before each directory
      if (Date.now() - startTime > searchTimeout) {
        printVerbose(
          "Project cache search timed out, skipping remaining directories",
        );
        break;
      }

      if (await pathExists(searchDir)) {
        try {
          // Only search 1 level deep to avoid performance issues
          const projects = await this.findYarnProjectsRecursively(
            searchDir,
            1,
            startTime,
            searchTimeout,
          );
          projectCaches.push(...projects);

          // Limit total project caches found to prevent excessive scanning
          if (projectCaches.length > 50) {
            printVerbose(
              "Found many project caches, limiting search to prevent performance issues",
            );
            break;
          }
        } catch (error) {
          printVerbose(`Error searching ${searchDir}: ${error}`);
        }
      }
    }

    return projectCaches;
  }

  private async findYarnProjectsRecursively(
    dir: string,
    maxDepth: number,
    startTime: number = Date.now(),
    timeout: number = 5000,
  ): Promise<string[]> {
    if (maxDepth <= 0) return [];

    // Check timeout
    if (Date.now() - startTime > timeout) {
      printVerbose(`Yarn project search timed out at ${dir}`);
      return [];
    }

    const yarnCaches: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      // Limit number of entries to check to prevent excessive scanning
      const limitedEntries = entries.slice(0, 100); // Only check first 100 entries

      for (const entry of limitedEntries) {
        // Check timeout during iteration
        if (Date.now() - startTime > timeout) {
          printVerbose(`Yarn project search timed out during scan of ${dir}`);
          break;
        }

        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          const fullPath = path.join(dir, entry.name);

          // Check for .yarn/cache directory (Yarn v2+)
          const yarnCacheDir = path.join(fullPath, ".yarn", "cache");
          if (await pathExists(yarnCacheDir)) {
            yarnCaches.push(yarnCacheDir);
          }

          // Recursively search subdirectories only if we have time
          if (Date.now() - startTime < timeout) {
            const subCaches = await this.findYarnProjectsRecursively(
              fullPath,
              maxDepth - 1,
              startTime,
              timeout,
            );
            yarnCaches.push(...subCaches);
          }
        }
      }
    } catch {
      // Ignore permission errors or other issues
    }

    return yarnCaches;
  }

  async isAvailable(): Promise<boolean> {
    return checkToolAvailability("yarn", async () => {
      const version = await this.getYarnVersion();
      return version !== null;
    });
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

    const cachePaths = await this.getYarnCachePaths();
    let totalSize = 0;
    const validPaths: string[] = [];

    for (const cachePath of cachePaths) {
      try {
        const size = await getCachedDirectorySize(cachePath);
        totalSize += size;
        validPaths.push(cachePath);
        printVerbose(
          `${symbols.folder} ${cachePath}: ${(size / (1024 * 1024)).toFixed(1)} MB`,
        );
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

  async clear(
    dryRun = false,
    _criteria?: CacheSelectionCriteria,
    cacheInfo?: CacheInfo,
  ): Promise<ClearResult> {
    const info = cacheInfo || (await this.getCacheInfo());

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: "Yarn is not installed",
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
          // Invalidate size cache after clearing
          invalidateSizeCachePrefix(cachePath);
        }
      } catch (error) {
        const errorMsg = `Failed to clear ${cachePath}: ${error}`;
        errors.push(errorMsg);
        printVerbose(errorMsg);
      }
    }

    // Try to clear yarn cache using yarn command as well
    if (!dryRun && (await this.isAvailable())) {
      try {
        await execa("yarn", ["cache", "clean"]);
        printVerbose(`${symbols.soap} Executed: yarn cache clean`);
      } catch (error) {
        printVerbose(`Note: yarn cache clean failed: ${error}`);
      }
    }

    return {
      name: this.name,
      success: errors.length === 0,
      sizeBefore,
      sizeAfter: 0, // Set to 0 as we don't want to rescan
      error: errors.length > 0 ? errors.join("; ") : undefined,
      clearedPaths,
    };
  }
}

export default new YarnCleaner();
