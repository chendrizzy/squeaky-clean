import { BaseCleaner } from "./BaseCleaner";
import { CacheInfo, CacheCategory, CacheType } from "../types";
import { existsSync, statSync } from "fs";
import path from "path";
import * as os from "os";
import { printVerbose } from "../utils/cli";
import { commandExists } from "../utils/which";
import { pathExists } from "../utils/fs";

export class NodeGypCleaner extends BaseCleaner {
  name = "node-gyp";
  type: CacheType = "build-tool";
  description = "Node.js native addon build tool cache";

  /**
   * node-gyp's own home-scoped cache directories: legacy ~/.node-gyp plus the
   * platform devdir (~/Library/Caches/node-gyp on macOS, XDG cache on Linux,
   * LOCALAPPDATA on Windows). Shared by detection and cleaning so the two can
   * never disagree about where node-gyp keeps its headers.
   */
  private getHomeCachePaths(): string[] {
    const paths: string[] = [];
    const homeDir = os.homedir();

    // Main node-gyp cache location
    paths.push(path.join(homeDir, ".node-gyp"));

    // Platform-specific locations
    if (process.platform === "win32") {
      const localAppData =
        process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
      paths.push(path.join(localAppData, "node-gyp", "Cache"));
    } else if (process.platform === "darwin") {
      paths.push(path.join(homeDir, "Library", "Caches", "node-gyp"));
    } else {
      // Linux
      const xdgCache =
        process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache");
      paths.push(path.join(xdgCache, "node-gyp"));
    }

    return paths;
  }

  private getCachePaths(): string[] {
    const paths: string[] = this.getHomeCachePaths();
    const homeDir = os.homedir();

    // Node.js headers cache
    paths.push(path.join(homeDir, ".npm", "_cacache"));

    // Build directories in current projects
    const projectBuildDirs = [
      "build",
      "Release",
      "Debug",
      "build/Release",
      "build/Debug",
    ];

    const cwd = process.cwd();
    for (const buildDir of projectBuildDirs) {
      const buildPath = path.join(cwd, buildDir);
      // Only include if it contains node-gyp artifacts
      if (
        existsSync(path.join(buildPath, "build.ninja")) ||
        existsSync(path.join(buildPath, "Makefile")) ||
        existsSync(path.join(buildPath, ".node"))
      ) {
        paths.push(buildPath);
      }
    }

    return paths;
  }

  async isAvailable(): Promise<boolean> {
    if (await commandExists("node-gyp")) {
      return true;
    }

    // node-gyp is usually invoked through npm rather than installed on PATH,
    // so a header cache in any of its home directories counts as detected.
    // (~/.npm/_cacache and project build dirs are deliberately excluded here:
    // they exist on machines that never ran node-gyp.)
    for (const cachePath of this.getHomeCachePaths()) {
      if (await pathExists(cachePath)) return true;
    }
    return false;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const paths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;
    let oldestCache: Date | undefined;
    let newestCache: Date | undefined;

    for (const cachePath of paths) {
      if (existsSync(cachePath)) {
        existingPaths.push(cachePath);
        const size = await this.getDirectorySize(cachePath);
        totalSize += size;

        try {
          const stat = statSync(cachePath);
          if (!oldestCache || stat.mtime < oldestCache) {
            oldestCache = stat.mtime;
          }
          if (!newestCache || stat.mtime > newestCache) {
            newestCache = stat.mtime;
          }
        } catch (error) {
          printVerbose(`Error getting stats for ${cachePath}: ${error}`);
        }
      }
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: existingPaths,
      isInstalled: await this.isAvailable(),
      totalSize: totalSize,
      oldestCache,
      newestCache,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const categories: CacheCategory[] = [];
    const paths = this.getCachePaths();

    for (const cachePath of paths) {
      if (!existsSync(cachePath)) continue;

      const baseName = path.basename(cachePath);
      let categoryName = "Build Cache";
      // Categorize by type
      if (cachePath.includes(".node-gyp")) {
        categoryName = "Node.js Headers Cache";
      } else if (
        cachePath.includes("build") ||
        cachePath.includes("Release") ||
        cachePath.includes("Debug")
      ) {
        categoryName = "Build Artifacts";
      } else if (cachePath.includes("_cacache")) {
        categoryName = "NPM Binary Cache";
      }

      try {
        const stat = statSync(cachePath);
        const size = await this.getDirectorySize(cachePath);

        categories.push({
          id: `node-gyp-${baseName}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          name: categoryName,
          description: `Node-gyp cache at ${cachePath}`,
          paths: [cachePath],
          size,
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority: this.getCachePriority(cachePath),
          useCase: this.detectUseCase(cachePath),
          isProjectSpecific: this.isProjectSpecific(cachePath),
          ageInDays: Math.floor(
            (Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24),
          ),
        });
      } catch (error) {
        printVerbose(`Error analyzing ${cachePath}: ${error}`);
      }
    }

    return categories;
  }
}

export default new NodeGypCleaner();
