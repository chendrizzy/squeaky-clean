import {
  CleanerModule,
  CacheInfo,
  ClearResult,
  CacheSelectionCriteria,
} from "../types";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { pathExists, getDirectorySize, safeRmrf } from "../utils/fs";
import execa from "execa";
import { printVerbose, symbols } from "../utils/cli";

export class NxCleaner implements CleanerModule {
  name = "nx";
  type = "build-tool" as const;
  description = "NX monorepo build tool caches";

  private async getNxVersion(): Promise<string | null> {
    try {
      const result = await execa("nx", ["--version"]);
      return result.stdout.trim();
    } catch {
      try {
        const result = await execa("npx", ["nx", "--version"]);
        return result.stdout.trim();
      } catch {
        return null;
      }
    }
  }

  private async findNxCaches(): Promise<string[]> {
    const caches: string[] = [];
    const homeDir = os.homedir();

    // Common project directories to search
    const searchDirs = [
      path.join(homeDir, "Projects"),
      path.join(homeDir, "Development"),
      path.join(homeDir, "dev"),
      path.join(homeDir, "workspace"),
      path.join(homeDir, "Documents"),
      process.cwd(), // Current directory
    ];

    // Check for global nx cache
    const globalNxCache = path.join(homeDir, ".nx", "cache");
    if (await pathExists(globalNxCache)) {
      caches.push(globalNxCache);
    }

    // Search for project-specific nx caches
    for (const searchDir of searchDirs) {
      if (await pathExists(searchDir)) {
        try {
          const projectCaches = await this.findNxCachesRecursively(
            searchDir,
            3,
          );
          caches.push(...projectCaches);
        } catch (error) {
          printVerbose(`Error searching ${searchDir}: ${error}`);
        }
      }
    }

    return [...new Set(caches)]; // Remove duplicates
  }

  private async findNxCachesRecursively(
    dir: string,
    maxDepth: number,
  ): Promise<string[]> {
    if (maxDepth <= 0) return [];

    const nxCaches: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          const fullPath = path.join(dir, entry.name);

          // Check for nx cache directories
          const cacheLocations = [
            path.join(fullPath, "node_modules", ".cache", "nx"),
            path.join(fullPath, ".nx", "cache"),
            path.join(fullPath, "tmp", "nx"),
            path.join(fullPath, "dist"), // NX output directory for NX workspaces
          ];

          for (const cacheLocation of cacheLocations) {
            if (await pathExists(cacheLocation)) {
              // For dist folders, only include if it's actually an NX workspace
              if (cacheLocation.endsWith("dist")) {
                const nxJsonPath = path.join(fullPath, "nx.json");
                if (await pathExists(nxJsonPath)) {
                  nxCaches.push(cacheLocation);
                }
              } else {
                nxCaches.push(cacheLocation);
              }
            }
          }

          // Recursively search subdirectories
          const subCaches = await this.findNxCachesRecursively(
            fullPath,
            maxDepth - 1,
          );
          nxCaches.push(...subCaches);
        }
      }
    } catch {
      // Ignore permission errors or other issues
    }

    return nxCaches;
  }

  private async hasNxWorkspaces(): Promise<boolean> {
    const homeDir = os.homedir();

    // Check current directory first
    if (await pathExists(path.join(process.cwd(), "nx.json"))) {
      return true;
    }

    // Search common project directories
    const searchDirs = [
      path.join(homeDir, "Projects"),
      path.join(homeDir, "Development"),
      path.join(homeDir, "dev"),
      path.join(homeDir, "workspace"),
    ];

    for (const searchDir of searchDirs) {
      if (await pathExists(searchDir)) {
        try {
          const hasNx = await this.searchForNxWorkspaces(searchDir, 2);
          if (hasNx) return true;
        } catch {
          // Continue searching
        }
      }
    }

    return false;
  }

  private async searchForNxWorkspaces(
    dir: string,
    maxDepth: number,
  ): Promise<boolean> {
    if (maxDepth <= 0) return false;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const fullPath = path.join(dir, entry.name);

          // Check for nx.json (NX workspace indicator)
          const nxJsonPath = path.join(fullPath, "nx.json");
          if (await pathExists(nxJsonPath)) {
            return true;
          }

          // Check for package.json with nx dependency
          const packageJsonPath = path.join(fullPath, "package.json");
          if (await this.isNxProject(packageJsonPath)) {
            return true;
          }

          // Recursively search
          if (await this.searchForNxWorkspaces(fullPath, maxDepth - 1)) {
            return true;
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return false;
  }

  private async isNxProject(packageJsonPath: string): Promise<boolean> {
    try {
      if (!(await pathExists(packageJsonPath))) return false;

      const content = await fs.readFile(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);

      // Check for nx in dependencies or devDependencies
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      return "nx" in deps || "@nrwl/nx" in deps || "@nx/nx" in deps;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check if NX is installed globally or there are NX caches/workspaces
    const version = await this.getNxVersion();
    const caches = await this.findNxCaches();
    const hasWorkspaces = await this.hasNxWorkspaces();

    return version !== null || caches.length > 0 || hasWorkspaces;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const cachePaths = await this.findNxCaches();
    let totalSize = 0;
    const validPaths: string[] = [];

    for (const cachePath of cachePaths) {
      try {
        const size = await getDirectorySize(cachePath);
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
      isInstalled: await this.isAvailable(),
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
        error: "No NX caches found",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    // Try to use nx reset command if available
    if (!dryRun && (await this.getNxVersion())) {
      try {
        await execa("nx", ["reset"]);
        printVerbose(`${symbols.soap} Executed: nx reset`);
      } catch {
        try {
          await execa("npx", ["nx", "reset"]);
          printVerbose(`${symbols.soap} Executed: npx nx reset`);
        } catch (error) {
          printVerbose(`Note: nx reset failed: ${error}`);
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
      error: errors.length > 0 ? errors.join("; ") : undefined,
      clearedPaths,
    };
  }
}

export default new NxCleaner();
