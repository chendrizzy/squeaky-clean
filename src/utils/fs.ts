import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { rimraf } from "rimraf";
import { cacheManager } from "./cache";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Timeout wrapper for directory size calculation
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeoutMs),
    ),
  ]);
};

/**
 * Simple counting semaphore to bound concurrent expensive operations
 * (child process spawns, deep directory walks) across all cleaners.
 */
class Semaphore {
  private queue: Array<() => void> = [];
  private available: number;

  constructor(max: number) {
    this.available = max;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }
}

// All cleaners scan in parallel; cap how many sizing operations hit the
// disk at once so they share bandwidth instead of thrashing. 16 permits:
// system-wide discovery queues hundreds of directories, and SSD metadata
// walks parallelize well past 8.
const sizingSemaphore = new Semaphore(16);

/**
 * Compute directory size with native `du` (single C-speed process per path,
 * no per-file syscalls from JS). Returns null when du is unavailable or
 * fails so callers can fall back to the JS walker.
 */
async function duDirectorySize(
  dirPath: string,
  timeoutMs: number = 60000,
): Promise<number | null> {
  await sizingSemaphore.acquire();
  try {
    // No "--" end-of-options marker: BusyBox du (Alpine) rejects it, and every
    // path we size is absolute so it can never be misread as a flag.
    const { stdout } = await execFileAsync("du", ["-sk", dirPath], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return parseDuOutput(stdout);
  } catch (error) {
    // du exits non-zero when some subdirectories are unreadable but still
    // prints the total it could measure - use that partial result.
    const stdout = (error as { stdout?: string })?.stdout;
    if (stdout) {
      const size = parseDuOutput(stdout);
      if (size !== null) return size;
    }
    return null;
  } finally {
    sizingSemaphore.release();
  }
}

/** Exported for tests: parse `du -sk` output ("<KB>\t<path>") into bytes. */
export function parseDuOutput(stdout: string): number | null {
  const sizeKB = parseInt(stdout.split("\t")[0], 10);
  if (Number.isNaN(sizeKB)) return null;
  return sizeKB * 1024;
}

/**
 * Pure-JS fallback walker (Windows, or if du fails). Uses dirent type info
 * from readdir to avoid one stat() per entry, and walks directories with
 * bounded concurrency instead of one item at a time.
 */
// Recursion depth cap: real cache trees are shallow, and bounding depth stops
// a symlink/junction cycle (Windows junctions report as directories) from
// looping forever if the symlink guard below is ever bypassed.
const MAX_WALK_DEPTH = 64;

async function walkDirectorySize(rootDir: string): Promise<number> {
  let totalSize = 0;
  let activeWalkers = 0;
  const pendingDirs: Array<{ dir: string; depth: number }> = [
    { dir: rootDir, depth: 0 },
  ];
  const maxConcurrentDirs = 16;

  await new Promise<void>((resolveWalk) => {
    const processDir = async (dir: string, depth: number): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const statTasks: Promise<void>[] = [];
        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name);
          // Never recurse through a symlink/junction: it can escape the tree,
          // double-count shared targets, or cycle (Windows junctions report
          // isDirectory()===true). Count the link itself as a leaf instead.
          if (entry.isDirectory() && !entry.isSymbolicLink()) {
            if (depth < MAX_WALK_DEPTH) {
              pendingDirs.push({ dir: entryPath, depth: depth + 1 });
            }
          } else {
            // lstat: count symlinks themselves, never follow them
            statTasks.push(
              fs.lstat(entryPath).then(
                (s) => {
                  totalSize += s.size;
                },
                () => {},
              ),
            );
          }
        }
        await Promise.all(statTasks);
      } catch {
        // Skip directories we can't access
      }
    };

    const pump = (): void => {
      while (pendingDirs.length > 0 && activeWalkers < maxConcurrentDirs) {
        const { dir, depth } = pendingDirs.pop()!;
        activeWalkers++;
        processDir(dir, depth).finally(() => {
          activeWalkers--;
          pump();
        });
      }
      if (pendingDirs.length === 0 && activeWalkers === 0) {
        resolveWalk();
      }
    };

    pump();
  });

  return totalSize;
}

export async function getDirectorySize(
  dirPath: string,
  // Kept for API compatibility; sizing is now fast enough that estimation
  // shortcuts are no longer needed.
  _skipLargeDirectories: boolean = false,
  // Per-directory sizing budget. Survey-style callers (broad discovery over
  // hundreds of dirs, some enormous) pass a small budget so one giant tree
  // cannot stall the shared sizing queue; on timeout the sampled estimate
  // is used instead.
  timeoutMs: number = 60000,
): Promise<number> {
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      return stats.size;
    }
  } catch {
    return 0;
  }

  if (!isWindows) {
    const duSize = await duDirectorySize(dirPath, timeoutMs);
    if (duSize !== null) return duSize;
  }

  try {
    return await withTimeout(walkDirectorySize(dirPath), timeoutMs);
  } catch {
    // Last resort: sampled estimate rather than hanging forever
    return getEstimatedDirectorySize(dirPath);
  }
}

// Fast estimation for large directories to avoid memory issues
export async function getEstimatedDirectorySize(
  dirPath: string,
): Promise<number> {
  try {
    const stats = await fs.stat(dirPath);

    if (!stats.isDirectory()) {
      return stats.size;
    }

    // Sample a few items to estimate average size
    const items = await fs.readdir(dirPath);
    const sampleSize = Math.min(100, items.length);

    if (sampleSize === 0) return 0;

    let sampleTotalSize = 0;
    let sampleFileCount = 0;

    for (let i = 0; i < sampleSize; i++) {
      const itemPath = path.join(dirPath, items[i]);
      try {
        const itemStats = await fs.stat(itemPath);
        if (!itemStats.isDirectory()) {
          sampleTotalSize += itemStats.size;
          sampleFileCount++;
        }
      } catch {
        // Skip items we can't access
      }
    }

    if (sampleFileCount === 0) return 0;

    const averageFileSize = sampleTotalSize / sampleFileCount;
    const totalFiles = items.length;

    return Math.round(averageFileSize * totalFiles);
  } catch {
    return 0;
  }
}

export async function safeRmrf(targetPath: string): Promise<void> {
  try {
    if (!(await pathExists(targetPath))) {
      return;
    }

    // Safety checks
    const normalizedPath = path.resolve(targetPath);
    const isInHomeOrTemp =
      normalizedPath.includes(path.join(require("os").homedir())) ||
      normalizedPath.includes(require("os").tmpdir()) ||
      normalizedPath.includes("node_modules") ||
      normalizedPath.includes("cache") ||
      normalizedPath.includes("temp");

    if (!isInHomeOrTemp) {
      throw new Error(
        `Refusing to delete path outside safe directories: ${normalizedPath}`,
      );
    }

    // Use rimraf for cross-platform reliable deletion
    await rimraf(normalizedPath, {
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch (error) {
    throw new Error(
      `Failed to delete ${targetPath}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function createDirectoryIfNotExists(
  dirPath: string,
): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

export async function isWritable(dirPath: string): Promise<boolean> {
  try {
    await fs.access(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getDiskSpace(
  dirPath: string,
): Promise<{ free: number; total: number } | null> {
  try {
    const stats = await fs.statfs(dirPath);
    return {
      free: stats.bavail * stats.bsize,
      total: stats.blocks * stats.bsize,
    };
  } catch {
    // statfs not available on all platforms
    return null;
  }
}

export async function getFileModificationTime(
  filePath: string,
): Promise<Date | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime;
  } catch {
    return null;
  }
}

export function sanitizePath(inputPath: string): string {
  if (!inputPath) return ".";
  // Normalize path separators to forward slashes and remove invalid characters
  return path
    .normalize(inputPath)
    .replace(/\\/g, "/")
    .replace(/[<>:"|?*]/g, "");
}

// Alias for cache size calculation
export async function getCacheSize(dirPath: string): Promise<number> {
  return getDirectorySize(dirPath, false);
}

// Clear multiple paths
export async function clearPaths(paths: string[]): Promise<void> {
  for (const p of paths) {
    await safeRmrf(p);
  }
}

/**
 * Get directory size with caching (2-minute TTL)
 * Use this for repeated size calculations on the same paths
 */
export async function getCachedDirectorySize(
  dirPath: string,
  skipLargeDirectories: boolean = false,
  timeoutMs?: number,
): Promise<number> {
  return cacheManager.getCachedSize(
    dirPath,
    () => getDirectorySize(dirPath, skipLargeDirectories, timeoutMs),
    120000, // 2-minute TTL
  );
}

/**
 * Get estimated directory size with caching (2-minute TTL)
 */
export async function getCachedEstimatedDirectorySize(
  dirPath: string,
): Promise<number> {
  return cacheManager.getCachedSize(
    `estimated:${dirPath}`,
    () => getEstimatedDirectorySize(dirPath),
    120000,
  );
}

/**
 * Invalidate size cache for a path (call after clearing)
 */
export function invalidateSizeCache(dirPath: string): void {
  cacheManager.invalidateSize(dirPath);
  cacheManager.invalidateSize(`estimated:${dirPath}`);
}

/**
 * Invalidate all size caches matching a prefix
 */
export function invalidateSizeCachePrefix(prefix: string): void {
  cacheManager.invalidateSizePrefix(prefix);
  cacheManager.invalidateSizePrefix(`estimated:${prefix}`);
}
