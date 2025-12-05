import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  CacheInfo,
  ClearResult,
  CleanerModule,
  CacheCategory,
  CacheSelectionCriteria,
} from "../types";
import {
  getDirectorySize,
  getEstimatedDirectorySize,
  pathExists,
  safeRmrf,
} from "../utils/fs";
import { printVerbose } from "../utils/cli";

export class WindsurfCleaner implements CleanerModule {
  name = "windsurf";
  type = "ide" as const;
  description =
    "Windsurf IDE (Codeium) extensions cache, workspace storage, logs, and temporary files";

  private getCachePaths(): Array<{
    path: string;
    description: string;
    category: string;
    priority: "critical" | "important" | "normal" | "low";
    safeToDelete: boolean;
  }> {
    const homeDir = os.homedir();
    const platform = process.platform;

    const paths: Array<{
      path: string;
      description: string;
      category: string;
      priority: "critical" | "important" | "normal" | "low";
      safeToDelete: boolean;
    }> = [];

    if (platform === "darwin") {
      // macOS Windsurf paths
      const windsurfDir = path.join(homeDir, ".windsurf");
      const windsurfCacheDir = path.join(homeDir, "Library", "Caches", "com.exafunction.windsurf");
      const windsurfAppSupport = path.join(homeDir, "Library", "Application Support", "Windsurf");

      paths.push(
        // Cache directories (safe to clear)
        {
          path: windsurfCacheDir,
          description: "Windsurf application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(homeDir, "Library", "Caches", "com.exafunction.windsurf.ShipIt"),
          description: "Windsurf update cache",
          category: "updates",
          priority: "low",
          safeToDelete: true,
        },
        // Logs (safe to clear)
        {
          path: path.join(windsurfAppSupport, "logs"),
          description: "Windsurf application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        // Extension caches
        {
          path: path.join(windsurfDir, "extensions", ".obsolete"),
          description: "Obsolete extension files",
          category: "extensions",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(windsurfAppSupport, "CachedExtensions"),
          description: "Cached extension metadata",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(windsurfAppSupport, "CachedExtensionVSIXs"),
          description: "Cached extension VSIX files",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        // Workspace storage (generally safe but may lose some state)
        {
          path: path.join(windsurfAppSupport, "User", "workspaceStorage"),
          description: "Workspace-specific cache and state",
          category: "workspaces",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(windsurfAppSupport, "User", "History"),
          description: "File history and timeline cache",
          category: "history",
          priority: "normal",
          safeToDelete: true,
        },
        // Crash dumps
        {
          path: path.join(windsurfAppSupport, "CrashDumps"),
          description: "Application crash dumps",
          category: "diagnostics",
          priority: "low",
          safeToDelete: true,
        },
        // Extension global storage (be careful - may contain important data)
        {
          path: path.join(windsurfAppSupport, "User", "globalStorage"),
          description: "Extension global storage (some safe to clear)",
          category: "storage",
          priority: "important",
          safeToDelete: false,
        },
      );
    } else if (platform === "win32") {
      // Windows Windsurf paths
      const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
      const windsurfDir = path.join(homeDir, ".windsurf");

      paths.push(
        {
          path: path.join(localAppData, "Windsurf", "Cache"),
          description: "Windsurf application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Windsurf", "logs"),
          description: "Windsurf application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(windsurfDir, "extensions", ".obsolete"),
          description: "Obsolete extension files",
          category: "extensions",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Windsurf", "CachedExtensions"),
          description: "Cached extension metadata",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Windsurf", "User", "workspaceStorage"),
          description: "Workspace-specific cache and state",
          category: "workspaces",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Windsurf", "CrashDumps"),
          description: "Application crash dumps",
          category: "diagnostics",
          priority: "low",
          safeToDelete: true,
        },
      );
    } else {
      // Linux Windsurf paths
      const configDir = process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
      const cacheDir = process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache");
      const windsurfDir = path.join(homeDir, ".windsurf");

      paths.push(
        {
          path: path.join(cacheDir, "windsurf"),
          description: "Windsurf application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Windsurf", "logs"),
          description: "Windsurf application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(windsurfDir, "extensions", ".obsolete"),
          description: "Obsolete extension files",
          category: "extensions",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Windsurf", "CachedExtensions"),
          description: "Cached extension metadata",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Windsurf", "User", "workspaceStorage"),
          description: "Workspace-specific cache and state",
          category: "workspaces",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Windsurf", "CrashDumps"),
          description: "Application crash dumps",
          category: "diagnostics",
          priority: "low",
          safeToDelete: true,
        },
      );
    }

    return paths;
  }

  async isAvailable(): Promise<boolean> {
    const homeDir = os.homedir();
    const platform = process.platform;

    // Check for .windsurf directory (extensions)
    const windsurfDir = path.join(homeDir, ".windsurf");
    if (await pathExists(windsurfDir)) {
      return true;
    }

    // Check for cache directories
    const cachePaths = this.getCachePaths();
    for (const { path: cachePath } of cachePaths) {
      if (await pathExists(cachePath)) {
        return true;
      }
    }

    // Check for application
    if (platform === "darwin") {
      const appPath = "/Applications/Windsurf.app";
      if (await pathExists(appPath)) {
        return true;
      }
    }

    return false;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const cachePaths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;

    for (const { path: cachePath, safeToDelete } of cachePaths) {
      if (!safeToDelete) continue; // Only count safe-to-delete paths

      if (await pathExists(cachePath)) {
        existingPaths.push(cachePath);
        const size = await getEstimatedDirectorySize(cachePath);
        totalSize += size;
        printVerbose(`  🔍 📁 ${cachePath}: ${(size / (1024 * 1024)).toFixed(1)} MB`);
      }
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: existingPaths,
      isInstalled: await this.isAvailable(),
      size: totalSize,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const cachePaths = this.getCachePaths();
    const categoryMap = new Map<string, CacheCategory>();

    for (const { path: cachePath, description, category, priority, safeToDelete } of cachePaths) {
      if (!safeToDelete) continue;
      if (!(await pathExists(cachePath))) continue;

      const size = await getDirectorySize(cachePath);
      let stats;
      try {
        stats = await fs.stat(cachePath);
      } catch {
        stats = null;
      }

      const categoryId = `windsurf-${category}`;
      const existing = categoryMap.get(categoryId);

      if (existing) {
        existing.paths.push(cachePath);
        existing.size = (existing.size || 0) + size;
      } else {
        categoryMap.set(categoryId, {
          id: categoryId,
          name: `Windsurf ${category}`,
          description,
          paths: [cachePath],
          size,
          lastModified: stats?.mtime,
          priority,
          useCase: "development",
        });
      }
    }

    return Array.from(categoryMap.values());
  }

  async clear(
    dryRun = false,
    _criteria?: CacheSelectionCriteria,
    _cacheInfo?: CacheInfo,
    protectedPaths?: string[],
  ): Promise<ClearResult> {
    const cachePaths = this.getCachePaths();
    const clearedPaths: string[] = [];
    let sizeBefore = 0;
    let sizeAfter = 0;

    for (const { path: cachePath, description, safeToDelete } of cachePaths) {
      if (!safeToDelete) continue; // Only clear safe paths by default
      if (!(await pathExists(cachePath))) continue;

      // Check if path is protected
      if (protectedPaths?.some((p) => cachePath.startsWith(p))) {
        printVerbose(`  Skipping protected path: ${cachePath}`);
        continue;
      }

      const pathSize = await getDirectorySize(cachePath);
      sizeBefore += pathSize;

      if (dryRun) {
        printVerbose(`  [DRY RUN] Would clear: ${description} (${(pathSize / (1024 * 1024)).toFixed(1)} MB)`);
        clearedPaths.push(cachePath);
      } else {
        try {
          await safeRmrf(cachePath);
          clearedPaths.push(cachePath);
          printVerbose(`  ✓ Cleared: ${description}`);
        } catch (error) {
          printVerbose(`  ✗ Failed to clear ${description}: ${error}`);
        }
      }
    }

    if (!dryRun) {
      for (const { path: cachePath, safeToDelete } of cachePaths) {
        if (!safeToDelete) continue;
        if (await pathExists(cachePath)) {
          sizeAfter += await getDirectorySize(cachePath);
        }
      }
    }

    return {
      name: this.name,
      success: true,
      sizeBefore,
      sizeAfter: dryRun ? sizeBefore : sizeAfter,
      clearedPaths,
    };
  }

  async clearByCategory(
    categoryIds: string[],
    dryRun = false,
    _cacheInfo?: CacheInfo,
    protectedPaths?: string[],
  ): Promise<ClearResult> {
    const categories = await this.getCacheCategories();
    const targetCategories = categories.filter((c) => categoryIds.includes(c.id));
    const clearedPaths: string[] = [];
    let sizeBefore = 0;
    let sizeAfter = 0;

    for (const category of targetCategories) {
      for (const cachePath of category.paths) {
        if (!(await pathExists(cachePath))) continue;

        if (protectedPaths?.some((p) => cachePath.startsWith(p))) {
          printVerbose(`  Skipping protected path: ${cachePath}`);
          continue;
        }

        const pathSize = await getDirectorySize(cachePath);
        sizeBefore += pathSize;

        if (dryRun) {
          printVerbose(`  [DRY RUN] Would clear: ${category.name} (${(pathSize / (1024 * 1024)).toFixed(1)} MB)`);
          clearedPaths.push(cachePath);
        } else {
          try {
            await safeRmrf(cachePath);
            clearedPaths.push(cachePath);
            printVerbose(`  ✓ Cleared: ${category.name}`);
          } catch (error) {
            printVerbose(`  ✗ Failed to clear ${category.name}: ${error}`);
          }
        }
      }
    }

    return {
      name: this.name,
      success: true,
      sizeBefore,
      sizeAfter: dryRun ? sizeBefore : sizeAfter,
      clearedPaths,
      clearedCategories: categoryIds,
    };
  }
}

export default new WindsurfCleaner();
