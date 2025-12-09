import { promises as fs } from "fs";
import path from "path";
import * as os from "os";
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

/**
 * Google Antigravity IDE Cleaner
 *
 * Google Antigravity is an agentic AI IDE from Google, similar to Cursor/Windsurf.
 * This cleaner manages caches for extensions, workspace storage, logs, and AI model caches.
 */
export class AntigravityCleaner implements CleanerModule {
  name = "antigravity";
  type = "ide" as const;
  description =
    "Google Antigravity IDE extensions cache, workspace storage, logs, and AI model caches";

  private getCachePaths(): Array<{
    path: string;
    description: string;
    category: string;
    priority: "critical" | "important" | "normal" | "low";
    safeToDelete: boolean;
  }> {
    const homeDir = os.homedir();
    const platform = os.platform();

    const paths: Array<{
      path: string;
      description: string;
      category: string;
      priority: "critical" | "important" | "normal" | "low";
      safeToDelete: boolean;
    }> = [];

    if (platform === "darwin") {
      // macOS Antigravity paths
      const antigravityDir = path.join(homeDir, ".antigravity");
      const antigravityAppSupport = path.join(
        homeDir,
        "Library",
        "Application Support",
        "Antigravity",
      );
      const antigravityCache = path.join(
        homeDir,
        "Library",
        "Caches",
        "com.google.antigravity",
      );
      const antigravityShipItCache = path.join(
        homeDir,
        "Library",
        "Caches",
        "com.google.antigravity.ShipIt",
      );

      paths.push(
        // Main application cache
        {
          path: antigravityCache,
          description: "Antigravity application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        // ShipIt update cache
        {
          path: antigravityShipItCache,
          description: "Antigravity update cache (ShipIt)",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        // Logs
        {
          path: path.join(antigravityAppSupport, "logs"),
          description: "Antigravity application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        // Extension caches
        {
          path: path.join(antigravityDir, "extensions", ".obsolete"),
          description: "Obsolete extension files",
          category: "extensions",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(antigravityAppSupport, "CachedExtensions"),
          description: "Cached extension metadata",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(antigravityAppSupport, "CachedExtensionVSIXs"),
          description: "Cached extension VSIX files",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        // Workspace storage
        {
          path: path.join(antigravityAppSupport, "User", "workspaceStorage"),
          description: "Workspace-specific cache and state",
          category: "workspaces",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(antigravityAppSupport, "User", "History"),
          description: "File history and timeline cache",
          category: "history",
          priority: "normal",
          safeToDelete: true,
        },
        // Crash dumps
        {
          path: path.join(antigravityAppSupport, "CrashDumps"),
          description: "Application crash dumps",
          category: "diagnostics",
          priority: "low",
          safeToDelete: true,
        },
        // General cache directory
        {
          path: path.join(antigravityAppSupport, "Cache"),
          description: "Antigravity cache directory",
          category: "cache",
          priority: "normal",
          safeToDelete: true,
        },
        // GPU cache
        {
          path: path.join(antigravityAppSupport, "GPUCache"),
          description: "GPU shader cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        // Code cache
        {
          path: path.join(antigravityAppSupport, "Code Cache"),
          description: "V8 code cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
      );
    } else if (platform === "win32") {
      // Windows Antigravity paths
      const appData =
        process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      const localAppData =
        process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
      const antigravityDir = path.join(homeDir, ".antigravity");

      paths.push(
        {
          path: path.join(localAppData, "Antigravity", "Cache"),
          description: "Antigravity application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Antigravity", "logs"),
          description: "Antigravity application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(antigravityDir, "extensions", ".obsolete"),
          description: "Obsolete extension files",
          category: "extensions",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Antigravity", "CachedExtensions"),
          description: "Cached extension metadata",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Antigravity", "CachedExtensionVSIXs"),
          description: "Cached extension VSIX files",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Antigravity", "User", "workspaceStorage"),
          description: "Workspace-specific cache and state",
          category: "workspaces",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Antigravity", "User", "History"),
          description: "File history and timeline cache",
          category: "history",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Antigravity", "CrashDumps"),
          description: "Application crash dumps",
          category: "diagnostics",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(localAppData, "Antigravity", "GPUCache"),
          description: "GPU shader cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(localAppData, "Antigravity", "Code Cache"),
          description: "V8 code cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
      );
    } else {
      // Linux Antigravity paths
      const configDir =
        process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
      const cacheDir =
        process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache");
      const antigravityDir = path.join(homeDir, ".antigravity");

      paths.push(
        {
          path: path.join(cacheDir, "antigravity"),
          description: "Antigravity application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(cacheDir, "Antigravity"),
          description: "Antigravity application cache (alternate)",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Antigravity", "logs"),
          description: "Antigravity application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(antigravityDir, "extensions", ".obsolete"),
          description: "Obsolete extension files",
          category: "extensions",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Antigravity", "CachedExtensions"),
          description: "Cached extension metadata",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Antigravity", "CachedExtensionVSIXs"),
          description: "Cached extension VSIX files",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(
            configDir,
            "Antigravity",
            "User",
            "workspaceStorage",
          ),
          description: "Workspace-specific cache and state",
          category: "workspaces",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Antigravity", "User", "History"),
          description: "File history and timeline cache",
          category: "history",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Antigravity", "CrashDumps"),
          description: "Application crash dumps",
          category: "diagnostics",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Antigravity", "GPUCache"),
          description: "GPU shader cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(configDir, "Antigravity", "Code Cache"),
          description: "V8 code cache",
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
    const platform = os.platform();

    // Check for .antigravity directory
    const antigravityDir = path.join(homeDir, ".antigravity");
    if (await pathExists(antigravityDir)) {
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
      const appPath = "/Applications/Antigravity.app";
      if (await pathExists(appPath)) {
        return true;
      }
    } else if (platform === "win32") {
      const localAppData =
        process.env.LOCALAPPDATA ||
        path.join(homeDir, "AppData", "Local");
      const appPath = path.join(localAppData, "Programs", "Antigravity");
      if (await pathExists(appPath)) {
        return true;
      }
    } else {
      // Linux - check common install locations
      const linuxPaths = [
        "/usr/share/antigravity",
        "/opt/Antigravity",
        path.join(homeDir, ".local", "share", "antigravity"),
      ];
      for (const linuxPath of linuxPaths) {
        if (await pathExists(linuxPath)) {
          return true;
        }
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
        printVerbose(
          `📁 ${cachePath}: ${(size / (1024 * 1024)).toFixed(1)} MB`,
        );
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

    for (const {
      path: cachePath,
      description,
      category,
      priority,
      safeToDelete,
    } of cachePaths) {
      if (!safeToDelete) continue;
      if (!(await pathExists(cachePath))) continue;

      const size = await getDirectorySize(cachePath);
      let stats;
      try {
        stats = await fs.stat(cachePath);
      } catch {
        stats = null;
      }

      const categoryId = `antigravity-${category}`;
      const existing = categoryMap.get(categoryId);

      if (existing) {
        existing.paths.push(cachePath);
        existing.size = (existing.size || 0) + size;
      } else {
        categoryMap.set(categoryId, {
          id: categoryId,
          name: `Antigravity ${category}`,
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
        printVerbose(
          `[DRY RUN] Would clear: ${description} (${(pathSize / (1024 * 1024)).toFixed(1)} MB)`,
        );
        clearedPaths.push(cachePath);
      } else {
        try {
          await safeRmrf(cachePath);
          clearedPaths.push(cachePath);
          printVerbose(`✓ Cleared: ${description}`);
        } catch (error) {
          printVerbose(`✗ Failed to clear ${description}: ${error}`);
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
    const targetCategories = categories.filter((c) =>
      categoryIds.includes(c.id),
    );
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
          printVerbose(
            `[DRY RUN] Would clear: ${category.name} (${(pathSize / (1024 * 1024)).toFixed(1)} MB)`,
          );
          clearedPaths.push(cachePath);
        } else {
          try {
            await safeRmrf(cachePath);
            clearedPaths.push(cachePath);
            printVerbose(`✓ Cleared: ${category.name}`);
          } catch (error) {
            printVerbose(`✗ Failed to clear ${category.name}: ${error}`);
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

export default new AntigravityCleaner();
