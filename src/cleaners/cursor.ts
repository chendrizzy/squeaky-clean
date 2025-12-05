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

export class CursorCleaner implements CleanerModule {
  name = "cursor";
  type = "ide" as const;
  description =
    "Cursor AI IDE extensions cache, workspace storage, logs, and AI model caches";

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
      // macOS Cursor paths (similar to VS Code structure)
      const cursorDir = path.join(homeDir, ".cursor");
      const cursorAppSupport = path.join(homeDir, "Library", "Application Support", "Cursor");
      const cursorCache = path.join(homeDir, "Library", "Caches", "com.todesktop.230313mzl4w4u92");

      paths.push(
        // Cache directories
        {
          path: cursorCache,
          description: "Cursor application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        // Logs
        {
          path: path.join(cursorAppSupport, "logs"),
          description: "Cursor application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        // Extension caches
        {
          path: path.join(cursorDir, "extensions", ".obsolete"),
          description: "Obsolete extension files",
          category: "extensions",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(cursorAppSupport, "CachedExtensions"),
          description: "Cached extension metadata",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(cursorAppSupport, "CachedExtensionVSIXs"),
          description: "Cached extension VSIX files",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        // Workspace storage
        {
          path: path.join(cursorAppSupport, "User", "workspaceStorage"),
          description: "Workspace-specific cache and state",
          category: "workspaces",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(cursorAppSupport, "User", "History"),
          description: "File history and timeline cache",
          category: "history",
          priority: "normal",
          safeToDelete: true,
        },
        // Crash dumps
        {
          path: path.join(cursorAppSupport, "CrashDumps"),
          description: "Application crash dumps",
          category: "diagnostics",
          priority: "low",
          safeToDelete: true,
        },
        // AI/Model caches (Cursor-specific)
        {
          path: path.join(cursorAppSupport, "Cache"),
          description: "Cursor cache directory",
          category: "cache",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(cursorAppSupport, "GPUCache"),
          description: "GPU shader cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
      );
    } else if (platform === "win32") {
      // Windows Cursor paths
      const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
      const cursorDir = path.join(homeDir, ".cursor");

      paths.push(
        {
          path: path.join(localAppData, "Cursor", "Cache"),
          description: "Cursor application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Cursor", "logs"),
          description: "Cursor application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(cursorDir, "extensions", ".obsolete"),
          description: "Obsolete extension files",
          category: "extensions",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Cursor", "CachedExtensions"),
          description: "Cached extension metadata",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Cursor", "User", "workspaceStorage"),
          description: "Workspace-specific cache and state",
          category: "workspaces",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Cursor", "CrashDumps"),
          description: "Application crash dumps",
          category: "diagnostics",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(localAppData, "Cursor", "GPUCache"),
          description: "GPU shader cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
      );
    } else {
      // Linux Cursor paths
      const configDir = process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
      const cacheDir = process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache");
      const cursorDir = path.join(homeDir, ".cursor");

      paths.push(
        {
          path: path.join(cacheDir, "cursor"),
          description: "Cursor application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Cursor", "logs"),
          description: "Cursor application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(cursorDir, "extensions", ".obsolete"),
          description: "Obsolete extension files",
          category: "extensions",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Cursor", "CachedExtensions"),
          description: "Cached extension metadata",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Cursor", "User", "workspaceStorage"),
          description: "Workspace-specific cache and state",
          category: "workspaces",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Cursor", "CrashDumps"),
          description: "Application crash dumps",
          category: "diagnostics",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Cursor", "GPUCache"),
          description: "GPU shader cache",
          category: "cache",
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

    // Check for .cursor directory
    const cursorDir = path.join(homeDir, ".cursor");
    if (await pathExists(cursorDir)) {
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
      const appPath = "/Applications/Cursor.app";
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
      if (!safeToDelete) continue;

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

      const categoryId = `cursor-${category}`;
      const existing = categoryMap.get(categoryId);

      if (existing) {
        existing.paths.push(cachePath);
        existing.size = (existing.size || 0) + size;
      } else {
        categoryMap.set(categoryId, {
          id: categoryId,
          name: `Cursor ${category}`,
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
      if (!safeToDelete) continue;
      if (!(await pathExists(cachePath))) continue;

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

export default new CursorCleaner();
