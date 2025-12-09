import {
  CleanerModule,
  CacheInfo,
  ClearResult,
  CacheSelectionCriteria,
} from "../types";
import * as path from "path";
import * as os from "os";
import { pathExists, getDirectorySize, safeRmrf } from "../utils/fs";
import { printVerbose, symbols } from "../utils/cli";
import { minimatch } from "minimatch";
import { readdirSync } from "fs";

/**
 * ShipIt Cleaner - Cleans ShipIt update caches used by various applications
 *
 * ShipIt is macOS's update mechanism used by apps like Google Chrome, Atom,
 * and other Sparkle/Squirrel-based updaters. These caches store downloaded
 * updates and can accumulate significant disk space.
 */
class ShipItCleaner implements CleanerModule {
  name = "shipit";
  type = "system" as const;
  description =
    "ShipIt update caches (Google apps, Electron apps, Sparkle-based updaters)";

  // Known ShipIt bundle identifiers
  private readonly knownShipItPatterns = [
    "com.google.antigravity.ShipIt",
    "com.google.Chrome.ShipIt",
    "com.google.Keystone.Agent",
    "com.github.atom.ShipIt",
    "com.microsoft.VSCode.ShipIt",
    "com.spotify.client.ShipIt",
    "com.slack.Slack.ShipIt",
    "com.discord.Discord.ShipIt",
    "*.ShipIt", // Catch-all for other ShipIt caches
  ];

  private async getShipItCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();
    const platform = os.platform();

    if (platform !== "darwin") {
      // ShipIt is macOS-specific
      return paths;
    }

    const cachesDir = path.join(homeDir, "Library", "Caches");

    try {
      if (await pathExists(cachesDir)) {
        const entries = readdirSync(cachesDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            // Check for known ShipIt patterns
            const isShipIt =
              entry.name.endsWith(".ShipIt") ||
              entry.name.includes("Keystone") ||
              this.knownShipItPatterns.some((pattern) => {
                if (pattern.includes("*")) {
                  return minimatch(entry.name, pattern);
                }
                return entry.name === pattern;
              });

            if (isShipIt) {
              const fullPath = path.join(cachesDir, entry.name);
              paths.push(fullPath);
            }
          }
        }
      }
    } catch (error) {
      printVerbose(`Error scanning ShipIt caches: ${error}`);
    }

    // Also check Application Support for Keystone
    const keystonePaths = [
      path.join(homeDir, "Library", "Google", "GoogleSoftwareUpdate"),
      path.join(homeDir, "Library", "Caches", "com.google.Keystone.Agent"),
    ];

    for (const keystonePath of keystonePaths) {
      if (await pathExists(keystonePath)) {
        paths.push(keystonePath);
      }
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  async isAvailable(): Promise<boolean> {
    // Only available on macOS
    if (os.platform() !== "darwin") {
      return false;
    }

    const cachePaths = await this.getShipItCachePaths();
    if (cachePaths.length > 0) {
      printVerbose(`Found ${cachePaths.length} ShipIt cache directories`);
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

    const cachePaths = await this.getShipItCachePaths();
    let totalSize = 0;
    const validPaths: string[] = [];

    for (const cachePath of cachePaths) {
      try {
        const size = await getDirectorySize(cachePath, true);
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
        error: "ShipIt caches not found (macOS only)",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    const errors: string[] = [];

    printVerbose(
      `${symbols.warning} Note: Applications using these caches should be closed for best results`,
    );

    for (const cachePath of info.paths) {
      // Check if the path is protected
      const isProtected = protectedPaths.some((protectedPattern) =>
        minimatch(cachePath, protectedPattern, { dot: true }),
      );

      if (isProtected) {
        printVerbose(`Skipping protected path: ${cachePath}`);
        continue;
      }

      try {
        if (dryRun) {
          printVerbose(`${symbols.soap} Would clear: ${cachePath}`);
          clearedPaths.push(cachePath);
        } else {
          printVerbose(`${symbols.soap} Clearing: ${cachePath}`);
          await safeRmrf(cachePath);
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
      sizeAfter: 0,
      error: errors.length > 0 ? errors.join("; ") : undefined,
      clearedPaths,
    };
  }
}

export default new ShipItCleaner();
