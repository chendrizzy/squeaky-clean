import { BaseCleaner } from "./BaseCleaner";
import {
  CacheInfo,
  ClearResult,
  CacheType,
  CacheSelectionCriteria,
} from "../types";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { pathExists, getDirectorySize, safeRmrf } from "../utils/fs";
import { printVerbose, symbols } from "../utils/cli";
import { minimatch } from "minimatch";

export class JetBrainsCleaner extends BaseCleaner {
  name = "jetbrains";
  type: CacheType = "ide";
  description =
    "JetBrains IDEs (WebStorm, IntelliJ, PhpStorm, etc.) comprehensive cache cleaning";

  private jetbrainsProducts = [
    "WebStorm",
    "IntelliJIdea",
    "PhpStorm",
    "PyCharm",
    "RubyMine",
    "CLion",
    "DataGrip",
    "Rider",
    "GoLand",
    "AndroidStudio",
    "AppCode",
    "DataSpell",
    "RustRover",
    "Aqua",
    "Fleet",
    "Space",
    "Toolbox", // JetBrains Toolbox App
  ];

  // Cache categories for different JetBrains cache types

  private async findJetBrainsInstallations(): Promise<
    { product: string; path: string }[]
  > {
    const installations: { product: string; path: string }[] = [];
    const platform = os.platform();

    if (platform === "darwin") {
      // macOS Applications
      const applicationsDir = "/Applications";

      for (const product of this.jetbrainsProducts) {
        const patterns = [`${product}.app`, `${product}*.app`];

        for (const pattern of patterns) {
          try {
            if (
              await pathExists(
                path.join(applicationsDir, pattern.replace("*", "")),
              )
            ) {
              installations.push({
                product,
                path: path.join(applicationsDir, pattern.replace("*", "")),
              });
            } else {
              // Try to find versioned applications
              const entries = await fs.readdir(applicationsDir);
              for (const entry of entries) {
                if (entry.startsWith(product) && entry.endsWith(".app")) {
                  installations.push({
                    product,
                    path: path.join(applicationsDir, entry),
                  });
                }
              }
            }
          } catch {
            // Continue
          }
        }
      }
    } else if (platform === "win32") {
      // Windows Program Files
      const programFilesDirs = [
        "C:\\Program Files\\JetBrains",
        "C:\\Program Files (x86)\\JetBrains",
      ];

      for (const programDir of programFilesDirs) {
        if (await pathExists(programDir)) {
          try {
            const entries = await fs.readdir(programDir);
            for (const entry of entries) {
              for (const product of this.jetbrainsProducts) {
                if (entry.includes(product)) {
                  installations.push({
                    product,
                    path: path.join(programDir, entry),
                  });
                }
              }
            }
          } catch {
            // Continue
          }
        }
      }
    } else {
      // Linux
      const linuxDirs = [
        "/opt",
        "/usr/local",
        path.join(os.homedir(), ".local", "share", "JetBrains"),
      ];

      for (const baseDir of linuxDirs) {
        if (await pathExists(baseDir)) {
          try {
            const entries = await fs.readdir(baseDir);
            for (const entry of entries) {
              for (const product of this.jetbrainsProducts) {
                if (entry.toLowerCase().includes(product.toLowerCase())) {
                  installations.push({
                    product,
                    path: path.join(baseDir, entry),
                  });
                }
              }
            }
          } catch {
            // Continue
          }
        }
      }
    }

    return installations;
  }

  private async getJetBrainsCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();
    const platform = os.platform();

    // Platform-specific JetBrains cache paths
    if (platform === "darwin") {
      // macOS
      const macBasePaths = [
        path.join(homeDir, "Library", "Caches"),
        path.join(homeDir, "Library", "Logs"),
        path.join(homeDir, "Library", "Application Support"),
      ];

      for (const basePath of macBasePaths) {
        for (const product of this.jetbrainsProducts) {
          const productPaths = [
            path.join(basePath, product),
            path.join(basePath, `JetBrains${product}`),
          ];

          for (const productPath of productPaths) {
            // Look for versioned directories
            try {
              if (await pathExists(path.dirname(productPath))) {
                const entries = await fs.readdir(path.dirname(productPath));
                for (const entry of entries) {
                  if (
                    entry.includes(product) &&
                    (await pathExists(
                      path.join(path.dirname(productPath), entry),
                    ))
                  ) {
                    paths.push(path.join(path.dirname(productPath), entry));
                  }
                }
              }
            } catch {
              // Continue
            }
          }
        }
      }
    } else if (platform === "win32") {
      // Windows
      const windowsBasePaths = [
        path.join(homeDir, "AppData", "Local", "JetBrains"),
        path.join(homeDir, "AppData", "Roaming", "JetBrains"),
      ];

      for (const basePath of windowsBasePaths) {
        if (await pathExists(basePath)) {
          try {
            const entries = await fs.readdir(basePath);
            for (const entry of entries) {
              paths.push(path.join(basePath, entry));
            }
          } catch {
            // Continue
          }
        }
      }
    } else {
      // Linux
      const linuxBasePaths = [
        path.join(homeDir, ".cache", "JetBrains"),
        path.join(homeDir, ".config", "JetBrains"),
        path.join(homeDir, ".local", "share", "JetBrains"),
      ];

      for (const basePath of linuxBasePaths) {
        if (await pathExists(basePath)) {
          try {
            const entries = await fs.readdir(basePath);
            for (const entry of entries) {
              paths.push(path.join(basePath, entry));
            }
          } catch {
            // Continue
          }
        }
      }
    }

    // Look for .idea directories in projects
    try {
      const ideaFolders = await this.findIdeaFolders();
      paths.push(...ideaFolders);
    } catch (error) {
      printVerbose(`Error finding .idea folders: ${error}`);
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  private async findIdeaFolders(): Promise<string[]> {
    const ideaFolders: string[] = [];
    const homeDir = os.homedir();

    // Common project directories
    const searchDirs = [
      path.join(homeDir, "Projects"),
      path.join(homeDir, "Development"),
      path.join(homeDir, "dev"),
      path.join(homeDir, "workspace"),
      path.join(homeDir, "IdeaProjects"),
      path.join(homeDir, "WebstormProjects"),
      path.join(homeDir, "Documents"),
      process.cwd(),
    ];

    for (const searchDir of searchDirs) {
      if (await pathExists(searchDir)) {
        try {
          const ideas = await this.findIdeaFoldersRecursively(searchDir, 3);
          ideaFolders.push(...ideas);
        } catch (error) {
          printVerbose(`Error searching ${searchDir}: ${error}`);
        }
      }
    }

    return ideaFolders;
  }

  private async findIdeaFoldersRecursively(
    dir: string,
    maxDepth: number,
  ): Promise<string[]> {
    if (maxDepth <= 0) return [];

    const ideaFolders: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(dir, entry.name);

          if (entry.name === ".idea") {
            // Found a .idea folder
            ideaFolders.push(fullPath);
          } else if (
            !entry.name.startsWith(".") &&
            entry.name !== "node_modules"
          ) {
            // Recursively search subdirectories
            const subIdeas = await this.findIdeaFoldersRecursively(
              fullPath,
              maxDepth - 1,
            );
            ideaFolders.push(...subIdeas);
          }
        }
      }
    } catch {
      // Ignore permission errors
    }

    return ideaFolders;
  }

  async isAvailable(): Promise<boolean> {
    // Check for JetBrains installations
    const installations = await this.findJetBrainsInstallations();
    if (installations.length > 0) {
      printVerbose(
        `Found JetBrains products: ${installations.map((i) => i.product).join(", ")}`,
      );
      return true;
    }

    // Check for JetBrains cache directories
    const homeDir = os.homedir();
    const platform = os.platform();

    const possibleCacheDirs = [];
    if (platform === "darwin") {
      possibleCacheDirs.push(
        path.join(homeDir, "Library", "Caches", "JetBrains"),
        path.join(homeDir, "Library", "Application Support", "JetBrains"),
      );
    } else if (platform === "win32") {
      possibleCacheDirs.push(
        path.join(homeDir, "AppData", "Local", "JetBrains"),
        path.join(homeDir, "AppData", "Roaming", "JetBrains"),
      );
    } else {
      possibleCacheDirs.push(
        path.join(homeDir, ".cache", "JetBrains"),
        path.join(homeDir, ".config", "JetBrains"),
      );
    }

    for (const cacheDir of possibleCacheDirs) {
      if (await pathExists(cacheDir)) {
        printVerbose(`Found JetBrains cache directory at ${cacheDir}`);
        return true;
      }
    }

    // Check for .idea folders
    const ideaFolders = await this.findIdeaFolders();
    if (ideaFolders.length > 0) {
      printVerbose(`Found ${ideaFolders.length} .idea folders`);
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

    const cachePaths = await this.getJetBrainsCachePaths();
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
        error: "JetBrains IDEs are not available",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

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

          // Be careful with .idea folders - only clear cache subdirectories
          if (cachePath.endsWith(".idea")) {
            // Only clear specific cache subdirectories in .idea folders
            const cacheSubdirs = ["shelf", "sonarlint", "httpRequests", ".tmp"];
            for (const subdir of cacheSubdirs) {
              const subdirPath = path.join(cachePath, subdir);
              if (await pathExists(subdirPath)) {
                await safeRmrf(subdirPath);
                printVerbose(
                  `${symbols.soap} Cleared .idea subdirectory: ${subdir}`,
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
}

export default new JetBrainsCleaner();
