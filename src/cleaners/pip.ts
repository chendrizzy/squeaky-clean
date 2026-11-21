import {
  CleanerModule,
  CacheInfo,
  ClearResult,
  CacheSelectionCriteria,
} from "../types";
import * as path from "path";
import * as os from "os";
import { pathExists, getDirectorySize, safeRmrf } from "../utils/fs";
import execa from "execa";
import { anyCommandExists } from "../utils/which";
import { printVerbose, symbols } from "../utils/cli";

class PipCleaner implements CleanerModule {
  name = "pip";
  type = "package-manager" as const;
  description = "Python pip package manager caches and temporary files";

  private async getPipCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();
    const platform = os.platform();

    // Platform-specific pip cache paths
    if (platform === "darwin") {
      // macOS
      const macPaths = [
        path.join(homeDir, "Library", "Caches", "pip"),
        path.join(homeDir, ".cache", "pip"),
      ];

      for (const cachePath of macPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else if (platform === "win32") {
      // Windows
      const windowsPaths = [
        path.join(homeDir, "AppData", "Local", "pip", "cache"),
        path.join(homeDir, "AppData", "Local", "pip", "Cache"),
        path.join(homeDir, "pip", "cache"),
      ];

      for (const cachePath of windowsPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else {
      // Linux/Unix
      const linuxPaths = [
        path.join(homeDir, ".cache", "pip"),
        path.join(homeDir, ".pip", "cache"),
        "/tmp/pip-cache",
      ];

      for (const cachePath of linuxPaths) {
        if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    }

    // Try to get pip cache directory from pip itself
    try {
      const pipCacheDir = await this.getPipCacheDir();
      if (pipCacheDir && !paths.includes(pipCacheDir)) {
        paths.push(pipCacheDir);
      }
    } catch (error) {
      printVerbose(`Could not get pip cache directory: ${error}`);
    }

    // Look for virtual environment caches
    try {
      const venvCaches = await this.findVirtualEnvCaches();
      paths.push(...venvCaches);
    } catch (error) {
      printVerbose(`Error finding virtual environment caches: ${error}`);
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  /**
   * Probe pip for its cache dir. Prefer `python3 -m pip` over bare `pip3`/`pip`:
   * PATH often has wrapper shims (semgrep mfw, pyenv) that can hang forever when
   * spawned with a piped stdin. Always ignore stdin and bound the wait.
   */
  private async getPipCacheDir(): Promise<string | null> {
    // ponytail: 5s ceiling; hung shims used to block the whole parallel scan.
    // Upgrade: resolve real pip binaries and skip known shim dirs.
    const probes: Array<[string, string[]]> = [
      ["python3", ["-m", "pip", "cache", "dir"]],
      ["python", ["-m", "pip", "cache", "dir"]],
      ["pip3", ["cache", "dir"]],
      ["pip", ["cache", "dir"]],
    ];

    for (const [cmd, args] of probes) {
      try {
        const result = await execa(cmd, args, {
          stdin: "ignore",
          timeout: 5000,
          reject: false,
        });
        if (result.failed || result.timedOut) continue;
        const cacheDir = result.stdout.trim();
        if (!cacheDir) continue;
        // Pip answered. If the dir is missing the cache is simply empty —
        // stop here so we don't fall through to shimmed `pip3`/`pip` that
        // can each burn the full timeout.
        return (await pathExists(cacheDir)) ? cacheDir : null;
      } catch {
        // Command missing or timed out — try next probe
      }
    }

    return null;
  }

  private async findVirtualEnvCaches(): Promise<string[]> {
    const caches: string[] = [];
    const homeDir = os.homedir();

    // Common virtual environment directories
    const venvDirs = [
      path.join(homeDir, ".virtualenvs"),
      path.join(homeDir, "envs"),
      path.join(homeDir, "venv"),
      path.join(homeDir, ".venv"),
      path.join(homeDir, "anaconda3", "envs"),
      path.join(homeDir, "miniconda3", "envs"),
      path.join(homeDir, ".conda", "envs"),
    ];

    for (const venvDir of venvDirs) {
      if (await pathExists(venvDir)) {
        try {
          const envCaches = await this.findPipCachesInDir(venvDir);
          caches.push(...envCaches);
        } catch (error) {
          printVerbose(`Error searching virtual envs in ${venvDir}: ${error}`);
        }
      }
    }

    return caches;
  }

  private async findPipCachesInDir(dir: string): Promise<string[]> {
    const caches: string[] = [];

    try {
      const platform = os.platform();

      // Look for pip cache subdirectories in virtual environments
      const possibleCachePaths = [];

      if (platform === "win32") {
        possibleCachePaths.push(
          path.join(dir, "Lib", "site-packages", "pip", "_internal", "cache"),
          path.join(dir, "pip", "cache"),
        );
      } else {
        possibleCachePaths.push(
          path.join(
            dir,
            "lib",
            "python*",
            "site-packages",
            "pip",
            "_internal",
            "cache",
          ),
          path.join(dir, "pip", "cache"),
        );
      }

      for (const cachePath of possibleCachePaths) {
        if (await pathExists(cachePath)) {
          caches.push(cachePath);
        }
      }
    } catch {
      // Ignore errors
    }

    return caches;
  }

  async isAvailable(): Promise<boolean> {
    // Check if Python or pip is on PATH (no process spawn).
    // Tries pip3 then pip (plus python3/python) without booting interpreters.
    if (await anyCommandExists("python3", "python", "pip3", "pip")) {
      printVerbose("Found Python/pip on PATH");
      return true;
    }

    // Check if pip cache exists
    const homeDir = os.homedir();
    const platform = os.platform();

    let defaultCachePath: string;
    if (platform === "darwin") {
      defaultCachePath = path.join(homeDir, "Library", "Caches", "pip");
    } else if (platform === "win32") {
      defaultCachePath = path.join(homeDir, "AppData", "Local", "pip", "cache");
    } else {
      defaultCachePath = path.join(homeDir, ".cache", "pip");
    }

    if (await pathExists(defaultCachePath)) {
      printVerbose(`Found pip cache at ${defaultCachePath}`);
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

    const cachePaths = await this.getPipCachePaths();
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
  ): Promise<ClearResult> {
    const info = cacheInfo || (await this.getCacheInfo());

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: "Python/pip is not available",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    // Try pip cache purge command first
    if (!dryRun) {
      await this.runPipCachePurge();
    }

    for (const cachePath of info.paths) {
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
      sizeAfter: 0, // Set to 0 as we don't want to rescan
      error: errors.length > 0 ? errors.join("; ") : undefined,
      clearedPaths,
    };
  }

  private async runPipCachePurge(): Promise<void> {
    const probes: Array<[string, string[]]> = [
      ["python3", ["-m", "pip", "cache", "purge"]],
      ["python", ["-m", "pip", "cache", "purge"]],
      ["pip3", ["cache", "purge"]],
      ["pip", ["cache", "purge"]],
    ];

    for (const [cmd, args] of probes) {
      try {
        const result = await execa(cmd, args, {
          stdin: "ignore",
          timeout: 60_000,
          reject: false,
        });
        if (result.failed || result.timedOut) {
          printVerbose(
            `Note: ${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout || "timed out/failed"}`,
          );
          continue;
        }
        printVerbose(`${symbols.soap} Executed: ${cmd} ${args.join(" ")}`);
        return;
      } catch (error) {
        printVerbose(`Note: ${cmd} cache purge failed: ${error}`);
      }
    }
  }
}

export default new PipCleaner();
