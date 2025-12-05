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

export class ZedCleaner implements CleanerModule {
  name = "zed";
  type = "ide" as const;
  description =
    "Zed editor caches, logs, language servers, and AI conversation history";

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
      // macOS Zed paths
      const zedAppSupport = path.join(homeDir, "Library", "Application Support", "Zed");
      const zedCache = path.join(homeDir, "Library", "Caches", "dev.zed.Zed");
      const zedLogs = path.join(homeDir, "Library", "Logs", "Zed");

      paths.push(
        // Cache directories
        {
          path: zedCache,
          description: "Zed application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        // Logs
        {
          path: zedLogs,
          description: "Zed application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(zedAppSupport, "logs"),
          description: "Zed runtime logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        // Language servers (can be large)
        {
          path: path.join(zedAppSupport, "languages"),
          description: "Zed language server binaries",
          category: "language-servers",
          priority: "normal",
          safeToDelete: true,
        },
        // Extension cache
        {
          path: path.join(zedAppSupport, "extensions"),
          description: "Zed extension cache",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        // Copilot/AI cache
        {
          path: path.join(zedAppSupport, "copilot"),
          description: "GitHub Copilot cache",
          category: "ai-cache",
          priority: "normal",
          safeToDelete: true,
        },
        // Node modules for extensions
        {
          path: path.join(zedAppSupport, "node"),
          description: "Node.js runtime for extensions",
          category: "runtime",
          priority: "normal",
          safeToDelete: true,
        },
        // Database/index files
        {
          path: path.join(zedAppSupport, "db"),
          description: "Zed database and indexes",
          category: "database",
          priority: "important",
          safeToDelete: false, // Contains workspace state
        },
        // AI conversations (user may want to keep)
        {
          path: path.join(zedAppSupport, "conversations"),
          description: "AI conversation history",
          category: "ai-history",
          priority: "important",
          safeToDelete: false, // User data
        },
        // Prettier cache
        {
          path: path.join(zedAppSupport, "prettier"),
          description: "Prettier formatter cache",
          category: "formatters",
          priority: "low",
          safeToDelete: true,
        },
        // Eslint cache
        {
          path: path.join(zedAppSupport, "eslint"),
          description: "ESLint linter cache",
          category: "linters",
          priority: "low",
          safeToDelete: true,
        },
      );
    } else if (platform === "win32") {
      // Windows Zed paths (hypothetical - Zed is primarily macOS/Linux)
      const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");

      paths.push(
        {
          path: path.join(localAppData, "Zed", "cache"),
          description: "Zed application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Zed", "logs"),
          description: "Zed application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Zed", "languages"),
          description: "Zed language server binaries",
          category: "language-servers",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(appData, "Zed", "extensions"),
          description: "Zed extension cache",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
      );
    } else {
      // Linux Zed paths
      const cacheDir = process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache");
      const dataDir = process.env.XDG_DATA_HOME || path.join(homeDir, ".local", "share");

      paths.push(
        {
          path: path.join(cacheDir, "zed"),
          description: "Zed application cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(dataDir, "zed", "logs"),
          description: "Zed application logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(dataDir, "zed", "languages"),
          description: "Zed language server binaries",
          category: "language-servers",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(dataDir, "zed", "extensions"),
          description: "Zed extension cache",
          category: "extensions",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(dataDir, "zed", "copilot"),
          description: "GitHub Copilot cache",
          category: "ai-cache",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(dataDir, "zed", "node"),
          description: "Node.js runtime for extensions",
          category: "runtime",
          priority: "normal",
          safeToDelete: true,
        },
        {
          path: path.join(dataDir, "zed", "prettier"),
          description: "Prettier formatter cache",
          category: "formatters",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(dataDir, "zed", "eslint"),
          description: "ESLint linter cache",
          category: "linters",
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

    // Check for Zed config/data directories
    if (platform === "darwin") {
      const zedAppSupport = path.join(homeDir, "Library", "Application Support", "Zed");
      if (await pathExists(zedAppSupport)) {
        return true;
      }
      const appPath = "/Applications/Zed.app";
      if (await pathExists(appPath)) {
        return true;
      }
    } else if (platform === "linux") {
      const dataDir = process.env.XDG_DATA_HOME || path.join(homeDir, ".local", "share");
      const zedDataDir = path.join(dataDir, "zed");
      if (await pathExists(zedDataDir)) {
        return true;
      }
    }

    // Check cache paths
    const cachePaths = this.getCachePaths();
    for (const { path: cachePath } of cachePaths) {
      if (await pathExists(cachePath)) {
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

      const categoryId = `zed-${category}`;
      const existing = categoryMap.get(categoryId);

      if (existing) {
        existing.paths.push(cachePath);
        existing.size = (existing.size || 0) + size;
      } else {
        categoryMap.set(categoryId, {
          id: categoryId,
          name: `Zed ${category}`,
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

export default new ZedCleaner();
