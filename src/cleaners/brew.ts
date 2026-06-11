import {
  CleanerModule,
  CacheInfo,
  ClearResult,
  CacheType,
  CacheSelectionCriteria,
} from "../types";
import { getCacheSize, pathExists } from "../utils/fs";
import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { printVerbose, symbols } from "../utils/cli";
import * as os from "os";
import { minimatch } from "minimatch";
import { commandExists } from "../utils/which";

/**
 * Resolve Homebrew's cache directory without spawning `brew --cache`
 * (a Ruby process that costs ~1s). Mirrors Homebrew's own resolution.
 */
async function findBrewCacheDir(): Promise<string | null> {
  if (process.env.HOMEBREW_CACHE) {
    return process.env.HOMEBREW_CACHE;
  }

  const home = os.homedir();
  const candidate =
    os.platform() === "darwin"
      ? path.join(home, "Library", "Caches", "Homebrew")
      : path.join(
          process.env.XDG_CACHE_HOME || path.join(home, ".cache"),
          "Homebrew",
        );

  return (await pathExists(candidate)) ? candidate : null;
}

/**
 * Estimate reclaimable old keg versions by scanning the Cellar directly.
 * Replaces `brew cleanup -s --dry-run`, which boots Ruby and took 10-20s
 * of event-loop-blocking time. A formula with multiple version directories
 * keeps only its most recently modified one; the rest are "old versions".
 */
async function estimateOldVersionsSize(): Promise<number> {
  // HOMEBREW_PREFIX first so custom and Linuxbrew installs aren't missed; the
  // Set dedupes it against the defaults so a matching prefix isn't scanned
  // (and double-counted) twice.
  const prefixes = [
    ...new Set(
      [
        process.env.HOMEBREW_PREFIX,
        "/opt/homebrew",
        "/usr/local",
        "/home/linuxbrew/.linuxbrew",
      ].filter((p): p is string => Boolean(p)),
    ),
  ];
  let total = 0;

  for (const prefix of prefixes) {
    const cellar = path.join(prefix, "Cellar");
    let formulas: string[];
    try {
      formulas = await fs.readdir(cellar);
    } catch {
      continue;
    }

    await Promise.all(
      formulas.map(async (formula) => {
        const formulaDir = path.join(cellar, formula);
        let versions: string[];
        try {
          versions = await fs.readdir(formulaDir);
        } catch {
          return;
        }
        if (versions.length < 2) return;

        const versionDirs = (
          await Promise.all(
            versions.map(async (version) => {
              const versionPath = path.join(formulaDir, version);
              try {
                const stat = await fs.stat(versionPath);
                return stat.isDirectory()
                  ? { path: versionPath, mtime: stat.mtime.getTime() }
                  : null;
              } catch {
                return null;
              }
            }),
          )
        ).filter((v): v is { path: string; mtime: number } => v !== null);

        if (versionDirs.length < 2) return;

        versionDirs.sort((a, b) => b.mtime - a.mtime);
        for (const oldVersion of versionDirs.slice(1)) {
          total += await getCacheSize(oldVersion.path);
        }
      }),
    );
  }

  return total;
}

const cleaner: CleanerModule = {
  name: "brew",
  type: "package-manager" as CacheType,
  description: "Homebrew package manager caches and old versions",

  async isAvailable(): Promise<boolean> {
    // Only works on macOS and Linux
    if (os.platform() !== "darwin" && os.platform() !== "linux") {
      return false;
    }

    // Check if brew is installed (PATH lookup, no process spawn)
    return commandExists("brew");
  },

  async getCacheInfo(): Promise<CacheInfo> {
    // Only works on macOS and Linux
    if (os.platform() !== "darwin" && os.platform() !== "linux") {
      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [],
        isInstalled: false,
        size: 0,
      };
    }

    // Check if brew is installed (PATH lookup, no process spawn)
    const isInstalled = await commandExists("brew");
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

    const paths = [];
    let totalSize = 0;

    try {
      // Homebrew download cache (resolved without spawning brew)
      const cacheDir = await findBrewCacheDir();
      if (cacheDir) {
        paths.push(cacheDir);
        totalSize += await getCacheSize(cacheDir);
      }

      // Old keg versions, estimated from the Cellar layout directly
      totalSize += await estimateOldVersionsSize();
    } catch (error) {
      printVerbose(`Error getting Homebrew cache info: ${error}`);
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths,
      isInstalled,
      size: totalSize,
    };
  },

  async clear(
    dryRun?: boolean,
    _criteria?: CacheSelectionCriteria,
    cacheInfo?: CacheInfo,
    protectedPaths: string[] = [],
  ): Promise<ClearResult> {
    const info = cacheInfo || (await this.getCacheInfo());
    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: "Homebrew is not installed",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    // Check if any of the paths are protected
    const pathsToClear = info.paths.filter((cachePath) => {
      const isProtected = protectedPaths.some((protectedPattern) =>
        minimatch(cachePath, protectedPattern, { dot: true }),
      );
      if (isProtected) {
        printVerbose(`Skipping protected path: ${cachePath}`);
      }
      return !isProtected;
    });

    if (pathsToClear.length === 0 && !dryRun) {
      // If all paths are protected and not a dry run
      printVerbose("All Homebrew cache paths are protected. Nothing to clear.");
      return {
        name: this.name,
        success: true,
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    try {
      if (dryRun) {
        printVerbose(`${symbols.info} [DRY RUN] Would run: brew cleanup -s`);
        printVerbose(
          `${symbols.info} [DRY RUN] Would clear Homebrew cache and old versions`,
        );

        // Get what would be cleaned
        try {
          const cleanupDryRun = execSync("brew cleanup -s --dry-run 2>&1", {
            encoding: "utf8",
          });
          const lines = cleanupDryRun.split("\n");
          for (const line of lines) {
            if (line.includes("Would remove:") || line.includes("==>")) {
              printVerbose(`  ${line.trim()}`);
            }
          }
        } catch {
          // Ignore dry-run errors
        }

        return {
          name: this.name,
          success: true,
          clearedPaths: pathsToClear, // Only report paths that would be cleared
          sizeBefore,
          sizeAfter: sizeBefore,
        };
      }

      // Run actual cleanup
      printVerbose(`${symbols.soap} Running Homebrew cleanup...`);

      try {
        // Clean up old versions and cache
        execSync("brew cleanup -s", { stdio: "inherit" });
        clearedPaths.push(...pathsToClear); // Only push paths that were actually cleared

        // Also prune old downloads
        execSync("brew cleanup --prune=all", { stdio: "ignore" });

        printVerbose(`${symbols.bubbles} Homebrew cleanup completed`);
      } catch (error) {
        printVerbose(`${symbols.warning} Partial Homebrew cleanup: ${error}`);
      }

      return {
        name: this.name,
        success: true,
        clearedPaths,
        sizeBefore,
        sizeAfter: 0, // Set to 0 as we don't want to rescan
      };
    } catch (error) {
      return {
        name: this.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        clearedPaths: [],
        sizeBefore,
        sizeAfter: sizeBefore,
      };
    }
  },
};

export default cleaner;
