import { promises as fs } from "fs";
import path from "path";
import os from "os";
import execa from "execa";
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

export class PlaywrightCleaner implements CleanerModule {
  name = "playwright";
  type = "build-tool" as const;
  description =
    "Playwright browser binaries, test artifacts, and cache files";

  private getCachePaths(): Array<{
    path: string;
    description: string;
    category: string;
    priority: "critical" | "important" | "normal" | "low";
  }> {
    const homeDir = os.homedir();
    const platform = process.platform;

    const paths: Array<{
      path: string;
      description: string;
      category: string;
      priority: "critical" | "important" | "normal" | "low";
    }> = [];

    if (platform === "darwin") {
      // macOS Playwright cache locations
      paths.push(
        {
          path: path.join(homeDir, "Library", "Caches", "ms-playwright"),
          description: "Playwright browser binaries (Chromium, Firefox, WebKit)",
          category: "browsers",
          priority: "normal",
        },
        {
          path: path.join(homeDir, "Library", "Caches", "ms-playwright-go"),
          description: "Playwright Go bindings cache",
          category: "browsers",
          priority: "normal",
        },
        {
          path: path.join(homeDir, "Library", "Caches", "org.webkit.Playwright"),
          description: "WebKit Playwright cache",
          category: "browsers",
          priority: "low",
        },
      );
    } else if (platform === "win32") {
      // Windows Playwright cache locations
      const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
      paths.push(
        {
          path: path.join(localAppData, "ms-playwright"),
          description: "Playwright browser binaries",
          category: "browsers",
          priority: "normal",
        },
      );
    } else {
      // Linux Playwright cache locations
      paths.push(
        {
          path: path.join(homeDir, ".cache", "ms-playwright"),
          description: "Playwright browser binaries",
          category: "browsers",
          priority: "normal",
        },
        {
          path: path.join(homeDir, ".cache", "ms-playwright-go"),
          description: "Playwright Go bindings cache",
          category: "browsers",
          priority: "normal",
        },
      );
    }

    return paths;
  }

  async isAvailable(): Promise<boolean> {
    const cachePaths = this.getCachePaths();
    for (const { path: cachePath } of cachePaths) {
      if (await pathExists(cachePath)) {
        return true;
      }
    }

    // Also check if playwright is installed via npm
    try {
      await execa("npx", ["playwright", "--version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const cachePaths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;

    for (const { path: cachePath } of cachePaths) {
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
      isInstalled: existingPaths.length > 0,
      size: totalSize,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const cachePaths = this.getCachePaths();
    const categories: CacheCategory[] = [];

    for (const { path: cachePath, description, category, priority } of cachePaths) {
      if (await pathExists(cachePath)) {
        const size = await getDirectorySize(cachePath);
        let stats;
        try {
          stats = await fs.stat(cachePath);
        } catch {
          stats = null;
        }

        categories.push({
          id: `playwright-${category}`,
          name: `Playwright ${category}`,
          description,
          paths: [cachePath],
          size,
          lastModified: stats?.mtime,
          priority,
          useCase: "testing",
        });
      }
    }

    return categories;
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

    for (const { path: cachePath, description } of cachePaths) {
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
      for (const { path: cachePath } of cachePaths) {
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

export default new PlaywrightCleaner();
