import path from "path";
import os from "os";
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

class CargoCleaner implements CleanerModule {
  name = "cargo";
  type = "package-manager" as const;
  description =
    "Rust Cargo registry and git caches with optional workspace target outputs";

  private async buildCategories(): Promise<CacheCategory[]> {
    const home = os.homedir();
    const categories: CacheCategory[] = [
      {
        id: "registry",
        name: "Registry cache",
        description: "Cached crates index and downloads",
        paths: [path.join(home, ".cargo", "registry")],
        priority: "normal",
        useCase: "development",
      },
      {
        id: "git",
        name: "Git checkouts",
        description: "Cached Cargo git dependencies",
        paths: [path.join(home, ".cargo", "git")],
        priority: "normal",
        useCase: "development",
      },
    ];

    const targetPath = path.join(process.cwd(), "target");
    categories.push({
      id: "target",
      name: "Workspace targets",
      description: "Project build artifacts (opt-in)",
      paths: [targetPath],
      priority: "important",
      useCase: "development",
      isProjectSpecific: true,
      projectPath: process.cwd(),
    });

    const existing: CacheCategory[] = [];
    for (const category of categories) {
      const existingPaths = [];
      for (const cachePath of category.paths) {
        if (await pathExists(cachePath)) {
          existingPaths.push(cachePath);
        }
      }
      if (existingPaths.length > 0) {
        existing.push({ ...category, paths: existingPaths });
      }
    }

    return existing;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa("cargo", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const categories = await this.buildCategories();
    let totalSize = 0;
    let lastModified: Date | undefined;

    for (const category of categories) {
      let size = 0;
      for (const cachePath of category.paths) {
        size += await getDirectorySize(cachePath, category.id !== "registry");
        try {
          const stats = await fs.stat(cachePath);
          if (!lastModified || stats.mtime > lastModified) {
            lastModified = stats.mtime;
          }
        } catch {
          // ignore stat failures
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

  private async clearSelected(
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
        `[DRY RUN] Would clear cargo caches: ${pathsToClear.join(", ")}`,
      );
      return {
        name: this.name,
        success: true,
        clearedPaths: pathsToClear,
        sizeBefore,
        sizeAfter: sizeBefore,
        clearedCategories: categories.map((c) => c.id),
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
          printVerbose(`Clearing cargo cache at ${cachePath}`);
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
        error: "cargo is not installed",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }
    const categories = info.categories || [];
    const defaultCategories = categories.filter((c) => c.id !== "target");
    return this.clearSelected(defaultCategories, dryRun, protectedPaths, info);
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
        error: "cargo is not installed",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }
    const categories =
      info.categories?.filter((c) => categoryIds.includes(c.id)) ?? [];
    return this.clearSelected(categories, dryRun, protectedPaths, info);
  }
}

export default new CargoCleaner();
