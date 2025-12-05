import { promises as fs } from "fs";
import path from "path";
import { rimraf } from "rimraf";
import { cacheManager } from "./cache";

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

export async function getDirectorySize(
  dirPath: string,
  skipLargeDirectories: boolean = false,
): Promise<number> {
  // Wrap the actual calculation with an 8-second timeout to prevent hangs
  try {
    return await withTimeout(
      calculateDirectorySize(dirPath, skipLargeDirectories),
      8000,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Timeout") {
      // Use estimated size for directories that take too long
      return getEstimatedDirectorySize(dirPath);
    }
    return 0;
  }
}

async function calculateDirectorySize(
  dirPath: string,
  skipLargeDirectories: boolean = false,
): Promise<number> {
  try {
    const stats = await fs.stat(dirPath);

    if (!stats.isDirectory()) {
      return stats.size;
    }

    // For very large cache directories, return estimated size instead of calculating exact size
    if (skipLargeDirectories) {
      return getEstimatedDirectorySize(dirPath);
    }

    let totalSize = 0;
    const stack = [dirPath];
    let processedCount = 0;
    const maxItems = 10000; // Limit total items processed to prevent memory issues

    while (stack.length > 0 && processedCount < maxItems) {
      const currentDir = stack.pop()!;

      try {
        const items = await fs.readdir(currentDir);

        for (const item of items) {
          if (processedCount >= maxItems) break;

          const itemPath = path.join(currentDir, item);
          try {
            const itemStats = await fs.stat(itemPath);

            if (itemStats.isDirectory()) {
              stack.push(itemPath);
            } else {
              totalSize += itemStats.size;
            }

            processedCount++;
          } catch {
            // Skip items we can't access (permissions, etc.)
          }
        }
      } catch {
        // Skip directories we can't access
      }
    }

    return totalSize;
  } catch {
    return 0;
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
): Promise<number> {
  return cacheManager.getCachedSize(
    dirPath,
    () => getDirectorySize(dirPath, skipLargeDirectories),
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
