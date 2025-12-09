import path from "path";
import * as os from "os";
import execa from "execa";
import { promises as fs } from "fs";
import {
  CacheCategory,
  CacheInfo,
  CacheSelectionCriteria,
  ClearResult,
  CleanerModule,
} from "../types";
import { getDirectorySize, pathExists, safeRmrf } from "../utils/fs";
import { printVerbose } from "../utils/cli";
import { minimatch } from "minimatch";

class SwiftPmCleaner implements CleanerModule {
  name = "swiftpm";
  type = "package-manager" as const;
  description = "Swift Package Manager caches (macOS)";

  private getCachePaths(): string[] {
    const home = os.homedir();
    return [path.join(home, "Library", "Caches", "org.swift.swiftpm")];
  }

  private async buildCategories(): Promise<CacheCategory[]> {
    const categories: CacheCategory[] = [
      {
        id: "cache",
        name: "SwiftPM cache",
        description: "Artifacts, repositories, and downloads",
        paths: this.getCachePaths(),
        priority: "normal",
        useCase: "development",
      },
    ];

    const existing: CacheCategory[] = [];
    for (const category of categories) {
      const validPaths = [];
      for (const cachePath of category.paths) {
        if (await pathExists(cachePath)) {
          validPaths.push(cachePath);
        }
      }
      if (validPaths.length > 0) {
        existing.push({ ...category, paths: validPaths });
      }
    }
    return existing;
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "darwin") return false;
    try {
      await execa("swift", ["--version"]);
      return true;
    } catch {
      const categories = await this.buildCategories();
      return categories.length > 0;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const categories = await this.buildCategories();
    let totalSize = 0;
    let lastModified: Date | undefined;

    for (const category of categories) {
      let size = 0;
      for (const cachePath of category.paths) {
        size += await getDirectorySize(cachePath, true);
        try {
          const stats = await fs.stat(cachePath);
          if (!lastModified || stats.mtime > lastModified) {
            lastModified = stats.mtime;
          }
        } catch {
          // ignore
        }
      }
      category.size = size;
      totalSize += size;
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: categories.flatMap((c) => c.paths),
      isInstalled: await this.isAvailable(),
      size: totalSize,
      lastModified,
      categories,
    };
  }

  private async clearCategories(
    categories: CacheCategory[],
    dryRun: boolean,
    protectedPaths: string[],
    cacheInfo?: CacheInfo,
  ): Promise<ClearResult> {
    const pathsToClear = Array.from(
      new Set(categories.flatMap((c) => c.paths)),
    );
    const sizeBefore =
      cacheInfo?.size ??
      categories.reduce((sum, cat) => sum + (cat.size ?? 0), 0);

    if (pathsToClear.length === 0) {
      return {
        name: this.name,
        success: true,
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    if (dryRun) {
      printVerbose(
        `[DRY RUN] Would clear SwiftPM cache: ${pathsToClear.join(", ")}`,
      );
      return {
        name: this.name,
        success: true,
        clearedPaths: pathsToClear,
        clearedCategories: categories.map((c) => c.id),
        sizeBefore,
        sizeAfter: sizeBefore,
      };
    }

    const clearedPaths: string[] = [];
    let success = true;
    let error: string | undefined;

    for (const cachePath of pathsToClear) {
      const isProtected = protectedPaths.some((pattern) =>
        minimatch(cachePath, pattern, { dot: true }),
      );
      if (isProtected) {
        printVerbose(`Skipping protected path: ${cachePath}`);
        continue;
      }
      try {
        if (await pathExists(cachePath)) {
          printVerbose(`Clearing SwiftPM cache at ${cachePath}`);
          await safeRmrf(cachePath);
          clearedPaths.push(cachePath);
        }
      } catch (err) {
        success = false;
        error = `Failed to clear ${cachePath}: ${err}`;
      }
    }

    return {
      name: this.name,
      success,
      error,
      clearedPaths,
      clearedCategories: categories.map((c) => c.id),
      sizeBefore,
      sizeAfter: success ? 0 : sizeBefore,
    };
  }

  async clear(
    dryRun = false,
    _criteria?: CacheSelectionCriteria,
    cacheInfo?: CacheInfo,
    protectedPaths: string[] = [],
  ): Promise<ClearResult> {
    const info = cacheInfo || (await this.getCacheInfo());
    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: "swiftpm is not installed or not supported on this platform",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }
    const categories = info.categories || [];
    return this.clearCategories(categories, dryRun, protectedPaths, info);
  }

  async clearByCategory(
    categoryIds: string[],
    dryRun = false,
    cacheInfo?: CacheInfo,
    protectedPaths: string[] = [],
  ): Promise<ClearResult> {
    const info = cacheInfo || (await this.getCacheInfo());
    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: "swiftpm is not installed or not supported on this platform",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }
    const categories =
      info.categories?.filter((c) => categoryIds.includes(c.id)) ?? [];
    return this.clearCategories(categories, dryRun, protectedPaths, info);
  }
}

export default new SwiftPmCleaner();
