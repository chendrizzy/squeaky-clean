import { BaseCleaner } from "./BaseCleaner";
import { CacheInfo, CacheCategory, CacheType } from "../types";
import { existsSync, statSync } from "fs";
import path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { printVerbose } from "../utils/cli";

const execAsync = promisify(exec);

export class GoBuildCleaner extends BaseCleaner {
  name = "go-build";
  type: CacheType = "build-tool";
  description = "Go language build cache and module cache";

  private getCachePaths(): string[] {
    const paths: string[] = [];
    const homeDir = os.homedir();

    // Get GOPATH if set
    const goPath = process.env.GOPATH || path.join(homeDir, "go");

    // Go module cache (go mod download cache)
    paths.push(path.join(goPath, "pkg", "mod"));

    // Go build cache
    if (process.platform === "win32") {
      const localAppData =
        process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
      paths.push(path.join(localAppData, "go-build"));
    } else if (process.platform === "darwin") {
      paths.push(path.join(homeDir, "Library", "Caches", "go-build"));
    } else {
      // Linux
      const xdgCache =
        process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache");
      paths.push(path.join(xdgCache, "go-build"));
    }

    // GOCACHE environment variable
    if (process.env.GOCACHE) {
      paths.push(process.env.GOCACHE);
    }

    // Test cache
    paths.push(path.join(goPath, "pkg", "sumdb"));

    // Temporary build directories
    const tempDirs = ["/tmp/go-build*", path.join(os.tmpdir(), "go-build*")];

    for (const tempPattern of tempDirs) {
      // Note: This would need glob expansion in actual implementation
      const tempPath = tempPattern.replace("*", "");
      if (existsSync(tempPath)) {
        paths.push(tempPath);
      }
    }

    return paths;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Go is installed
      const result = await execAsync("go version");
      printVerbose(`Found Go: ${result.stdout.trim()}`);
      return true;
    } catch {
      // Check if Go cache directories exist
      const homeDir = os.homedir();
      const goCacheDir =
        process.platform === "darwin"
          ? path.join(homeDir, "Library", "Caches", "go-build")
          : process.platform === "win32"
            ? path.join(homeDir, "AppData", "Local", "go-build")
            : path.join(homeDir, ".cache", "go-build");

      return existsSync(goCacheDir);
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const paths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;
    let oldestCache: Date | undefined;
    let newestCache: Date | undefined;

    // Try to get cache info from go command
    try {
      const result = await execAsync("go env GOCACHE");
      const goCachePath = result.stdout.trim();
      if (goCachePath && !paths.includes(goCachePath)) {
        paths.push(goCachePath);
      }
    } catch {
      // Ignore if go command fails
    }

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
      let categoryName = "Go Cache";
      // Categorize by type
      if (cachePath.includes("pkg/mod")) {
        categoryName = "Go Module Cache";
      } else if (cachePath.includes("go-build")) {
        categoryName = "Go Build Cache";
      } else if (cachePath.includes("sumdb")) {
        categoryName = "Go Checksum Database";
      } else if (
        cachePath.includes("/tmp/") ||
        cachePath.includes(os.tmpdir())
      ) {
        categoryName = "Temporary Build Files";
      }

      try {
        const stat = statSync(cachePath);
        const size = await this.getDirectorySize(cachePath);

        categories.push({
          id: `go-build-${baseName}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          name: categoryName,
          description: `Go cache at ${cachePath}`,
          paths: [cachePath],
          size,
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority: this.getCachePriority(cachePath),
          useCase: this.detectUseCase(cachePath),
          isProjectSpecific: false, // Go caches are global
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

  /**
   * Clear cache with Go's built-in command when possible
   */
  async clear(
    dryRun?: boolean,
    criteria?: any,
    cacheInfo?: CacheInfo,
    protectedPaths?: string[],
  ): Promise<any> {
    // Try to use go clean command for proper cleanup
    if (!dryRun) {
      try {
        await execAsync("go clean -cache");
        printVerbose("Executed: go clean -cache");
      } catch (error) {
        printVerbose(`Note: go clean command failed: ${error}`);
      }

      try {
        await execAsync("go clean -modcache");
        printVerbose("Executed: go clean -modcache");
      } catch (error) {
        printVerbose(`Note: go clean -modcache failed: ${error}`);
      }
    }

    // Then use the base implementation for remaining paths
    return super.clear(dryRun, criteria, cacheInfo, protectedPaths);
  }
}

export default new GoBuildCleaner();
