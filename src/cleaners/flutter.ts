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
import { minimatch } from "minimatch";

class FlutterCleaner implements CleanerModule {
  name = "flutter";
  type = "build-tool" as const;
  description = "Flutter SDK caches, pub cache, and project build artifacts";

  private async getFlutterVersion(): Promise<string | null> {
    try {
      const result = await execa("flutter", ["--version"]);
      return result.stdout.split("\n")[0].trim();
    } catch {
      return null;
    }
  }

  private async getFlutterCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();

    // Pub cache directory (Dart/Flutter packages)
    const pubCachePaths = [
      path.join(homeDir, ".pub-cache"),
      path.join(homeDir, "AppData", "Local", "Pub", "Cache"), // Windows
    ];

    for (const pubCachePath of pubCachePaths) {
      if (await pathExists(pubCachePath)) {
        paths.push(pubCachePath);
      }
    }

    // Flutter SDK cache (if Flutter is installed)
    try {
      const flutterCache = await this.getFlutterSdkCachePath();
      if (flutterCache) {
        paths.push(flutterCache);
      }
    } catch (error) {
      printVerbose(`Could not locate Flutter SDK cache: ${error}`);
    }

    // Flutter project build artifacts
    try {
      const projectBuildDirs = await this.findFlutterProjectBuildDirs();
      paths.push(...projectBuildDirs);
    } catch (error) {
      printVerbose(`Error finding Flutter project build dirs: ${error}`);
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  private async getFlutterSdkCachePath(): Promise<string | null> {
    try {
      // Try to get Flutter SDK path
      const result = await execa("flutter", ["--version", "--machine"]);
      const versionInfo = JSON.parse(result.stdout);

      if (versionInfo.flutterRoot) {
        const cacheDir = path.join(versionInfo.flutterRoot, "bin", "cache");
        if (await pathExists(cacheDir)) {
          return cacheDir;
        }
      }
    } catch {
      // Fallback to common locations
      const commonSdkPaths = [
        path.join(os.homedir(), "flutter", "bin", "cache"),
        path.join(os.homedir(), "development", "flutter", "bin", "cache"),
        path.join("/opt", "flutter", "bin", "cache"), // Linux
        path.join("C:", "flutter", "bin", "cache"), // Windows
      ];

      for (const sdkPath of commonSdkPaths) {
        if (await pathExists(sdkPath)) {
          return sdkPath;
        }
      }
    }

    return null;
  }

  private async findFlutterProjectBuildDirs(): Promise<string[]> {
    const buildDirs: string[] = [];
    const homeDir = os.homedir();

    // Common project directories
    const searchDirs = [
      path.join(homeDir, "FlutterProjects"),
      path.join(homeDir, "Projects"),
      path.join(homeDir, "Development"),
      path.join(homeDir, "dev"),
      path.join(homeDir, "Documents"),
      process.cwd(),
    ];

    for (const searchDir of searchDirs) {
      if (await pathExists(searchDir)) {
        try {
          const projects = await this.findFlutterProjectsRecursively(
            searchDir,
            3,
          );
          buildDirs.push(...projects);
        } catch (error) {
          printVerbose(`Error searching ${searchDir}: ${error}`);
        }
      }
    }

    return buildDirs;
  }

  private async findFlutterProjectsRecursively(
    dir: string,
    maxDepth: number,
  ): Promise<string[]> {
    if (maxDepth <= 0) return [];

    const buildDirs: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "build"
        ) {
          const fullPath = path.join(dir, entry.name);

          // Check if this is a Flutter project
          const pubspecFile = path.join(fullPath, "pubspec.yaml");
          const flutterDir = path.join(
            fullPath,
            ".flutter-plugins-dependencies",
          );

          if (await pathExists(pubspecFile)) {
            // Check if pubspec.yaml contains flutter dependency
            try {
              const pubspecContent = await fs.readFile(pubspecFile, "utf-8");
              if (
                pubspecContent.includes("flutter:") ||
                pubspecContent.includes("flutter_")
              ) {
                // This is a Flutter project, add build directories
                const buildLocations = [
                  path.join(fullPath, "build"),
                  path.join(fullPath, ".dart_tool"),
                  path.join(fullPath, "android", "build"),
                  path.join(fullPath, "ios", "build"),
                  path.join(fullPath, "windows", "build"),
                  path.join(fullPath, "linux", "build"),
                  path.join(fullPath, "macos", "build"),
                  path.join(fullPath, "web", "build"),
                ];

                for (const buildDir of buildLocations) {
                  if (await pathExists(buildDir)) {
                    buildDirs.push(buildDir);
                  }
                }
              }
            } catch {
              // If we can't read pubspec.yaml, still check for Flutter indicators
              if (await pathExists(flutterDir)) {
                const buildDir = path.join(fullPath, "build");
                const dartTool = path.join(fullPath, ".dart_tool");

                if (await pathExists(buildDir)) {
                  buildDirs.push(buildDir);
                }
                if (await pathExists(dartTool)) {
                  buildDirs.push(dartTool);
                }
              }
            }
          }

          // Recursively search subdirectories
          const subBuildDirs = await this.findFlutterProjectsRecursively(
            fullPath,
            maxDepth - 1,
          );
          buildDirs.push(...subBuildDirs);
        }
      }
    } catch {
      // Ignore permission errors
    }

    return buildDirs;
  }

  async isAvailable(): Promise<boolean> {
    // Check if Flutter is installed
    const version = await this.getFlutterVersion();
    if (version) {
      printVerbose(`Found Flutter: ${version}`);
      return true;
    }

    // Check if pub-cache exists (Dart projects)
    const homeDir = os.homedir();
    const pubCachePath = path.join(homeDir, ".pub-cache");
    if (await pathExists(pubCachePath)) {
      printVerbose(`Found Pub cache at ${pubCachePath}`);
      return true;
    }

    return false;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const isInstalled = await this.isAvailable();

    if (!isInstalled) {
      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [],
        isInstalled: false,
        size: 0,
      };
    }

    const cachePaths = await this.getFlutterCachePaths();
    let totalSize = 0;
    const validPaths: string[] = [];

    for (const cachePath of cachePaths) {
      try {
        const size = await getDirectorySize(cachePath, true); // Use estimated size for large dirs
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
      isInstalled: true,
      size: totalSize,
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
        error: "Flutter is not available",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    // Try flutter clean command in projects first
    if (!dryRun && (await this.getFlutterVersion())) {
      await this.runFlutterCleanInProjects();
    }

    for (const cachePath of info.paths) {
      // Check if the path is protected
      const isProtected = protectedPaths.some((protectedPattern) =>
        minimatch(cachePath, protectedPattern, { dot: true }),
      );

      if (isProtected) {
        printVerbose(`Skipping protected path: ${cachePath}`);
        continue; // Skip this path
      }

      try {
        if (dryRun) {
          printVerbose(`${symbols.soap} Would clear: ${cachePath}`);
          clearedPaths.push(cachePath);
        } else {
          printVerbose(`${symbols.soap} Clearing: ${cachePath}`);

          // Be selective about what we clear in the pub-cache
          if (cachePath.includes(".pub-cache")) {
            // Only clear specific subdirectories in pub-cache, not the entire cache
            const selectiveDirs = ["hosted", "_temp", "log"];
            for (const subdir of selectiveDirs) {
              const subdirPath = path.join(cachePath, subdir);
              if (await pathExists(subdirPath)) {
                await safeRmrf(subdirPath);
                printVerbose(
                  `${symbols.soap} Cleared pub-cache subdirectory: ${subdir}`,
                );
              }
            }
          } else {
            // For other cache directories, clear everything
            await safeRmrf(cachePath);
          }

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

  private async runFlutterCleanInProjects(): Promise<void> {
    const projectDirs = await this.findFlutterProjectBuildDirs();

    // Get unique project root directories (parent of build dirs)
    const projectRoots = new Set<string>();

    for (const buildDir of projectDirs) {
      if (buildDir.endsWith("/build") || buildDir.endsWith("\\build")) {
        projectRoots.add(path.dirname(buildDir));
      } else if (
        buildDir.endsWith("/.dart_tool") ||
        buildDir.endsWith("\\.dart_tool")
      ) {
        projectRoots.add(path.dirname(buildDir));
      }
    }

    // Run flutter clean in each project
    for (const projectRoot of projectRoots) {
      try {
        await execa("flutter", ["clean"], { cwd: projectRoot });
        printVerbose(
          `${symbols.soap} Executed 'flutter clean' in ${projectRoot}`,
        );
      } catch (error) {
        printVerbose(`Note: flutter clean failed in ${projectRoot}: ${error}`);
      }
    }
  }
}

export default new FlutterCleaner();
