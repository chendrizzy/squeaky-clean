import { promises as fs } from "fs";
import path from "path";
import os from "os";
import execa from "execa";
import {
  CacheInfo,
  ClearResult,
  CleanerModule,
  CacheSelectionCriteria,
} from "../types";
import {
  getDirectorySize,
  getEstimatedDirectorySize,
  pathExists,
  safeRmrf,
} from "../utils/fs";
import { printVerbose } from "../utils/cli";
import { minimatch } from "minimatch";

export class NpmCleaner implements CleanerModule {
  name = "npm";
  type = "package-manager" as const;
  description = "NPM package manager cache and temporary files";

  private getCachePaths(): string[] {
    const paths = [];
    const homeDir = os.homedir();

    // Primary npm cache location
    paths.push(path.join(homeDir, ".npm"));

    // Alternative cache locations on different platforms
    if (process.platform === "win32") {
      const appData =
        process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      paths.push(path.join(appData, "npm-cache"));
    } else if (process.platform === "darwin") {
      paths.push(path.join(homeDir, "Library", "Caches", "npm"));
    }

    // Node modules cache directories (common locations)
    const commonCachePaths = [
      "node_modules/.cache/npm",
      ".npm-cache",
      "npm-cache",
    ];

    // Check current working directory and parent directories (with limits)
    let currentDir = process.cwd();
    const rootDir = path.parse(currentDir).root;
    let depth = 0;
    const maxDepth = 5; // Limit to 5 levels up to avoid performance issues

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
      printVerbose("Checking if npm is installed...");
      await execa("npm", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const allPaths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;
    let lastModified: Date | undefined;

    printVerbose(`Checking npm cache paths: ${allPaths.join(", ")}`);

    for (const cachePath of allPaths) {
      if (await pathExists(cachePath)) {
        existingPaths.push(cachePath);

        try {
          // Use estimated size for large cache directories like .npm to prevent memory issues
          const isMainNpmCache =
            cachePath.includes(".npm") && !cachePath.includes("node_modules");
          const size = isMainNpmCache
            ? await getEstimatedDirectorySize(cachePath)
            : await getDirectorySize(cachePath, true);
          totalSize += size;

          const stats = await fs.stat(cachePath);
          if (!lastModified || stats.mtime > lastModified) {
            lastModified = stats.mtime;
          }

          printVerbose(
            `Found npm cache at ${cachePath} (${size} bytes${isMainNpmCache ? " estimated" : ""})`,
          );
        } catch (error) {
          printVerbose(`Error checking ${cachePath}: ${error}`);
        }
      }
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

  async clear(
    dryRun = false,
    _criteria?: CacheSelectionCriteria,
    cacheInfo?: CacheInfo,
    protectedPaths: string[] = [],
  ): Promise<ClearResult> {
    const info = cacheInfo || (await this.getCacheInfo());
    const clearedPaths: string[] = [];
    const sizeBefore = info.size || 0;
    let success = true;
    let error: string | undefined;

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: "npm is not installed",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    if (info.paths.length === 0) {
      printVerbose("No npm cache directories found");
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
        printVerbose(
          `[DRY RUN] Would clear npm cache paths: ${info.paths.join(", ")}`,
        );
        return {
          name: this.name,
          success: true,
          sizeBefore,
          sizeAfter: sizeBefore, // No change in dry run
          clearedPaths: info.paths,
        };
      }

      // Try using npm's built-in cache clean first
      try {
        printVerbose("Running npm cache clean --force...");
        await execa("npm", ["cache", "clean", "--force"]);
        printVerbose("npm cache clean completed successfully");
      } catch (npmError) {
        printVerbose(`npm cache clean failed: ${npmError}`);
        // Continue with manual deletion
      }

      // Manually clear cache directories
      for (const cachePath of info.paths) {
        // Check if the path is protected
        const isProtected = protectedPaths.some((protectedPattern) =>
          minimatch(cachePath, protectedPattern, { dot: true }),
        );

        if (isProtected) {
          printVerbose(`Skipping protected path: ${cachePath}`);
          continue; // Skip this path
        }

        try {
          if (await pathExists(cachePath)) {
            printVerbose(`Clearing directory: ${cachePath}`);
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
        error:
          clearError instanceof Error ? clearError.message : String(clearError),
        clearedPaths,
      };
    }
  }

  // Static method to create instance
  static create(): NpmCleaner {
    return new NpmCleaner();
  }
}

// Export default instance
export default NpmCleaner.create();
