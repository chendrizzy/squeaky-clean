import { promises as fs } from "fs";
import path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import {
  CacheInfo,
  ClearResult,
  CleanerModule,
  CacheSelectionCriteria,
  CacheCategory,
} from "../types";
import { pathExists } from "../utils/fs";
import { printVerbose } from "../utils/cli";

const execAsync = promisify(exec);

// Common application directories to scan for Universal binaries
const APP_DIRECTORIES = [
  "/Applications",
  "/Applications/Utilities",
  path.join(os.homedir(), "Applications"),
];

// Executables to skip (system critical or known problematic)
const SKIP_EXECUTABLES = new Set([
  "Finder",
  "SystemUIServer",
  "loginwindow",
  "launchd",
  "kernel",
]);

interface UniversalBinaryInfo {
  appPath: string;
  appName: string;
  binaryPath: string;
  totalSize: number;
  architectures: string[];
  potentialSavings: number;
}

export class UniversalBinaryCleaner implements CleanerModule {
  name = "universal-binary";
  type = "system" as const;
  description =
    "Thin Universal Binaries on Apple Silicon to remove unused x86_64 code";

  private universalBinaries: UniversalBinaryInfo[] = [];

  async isAvailable(): Promise<boolean> {
    // Only available on macOS with Apple Silicon
    if (process.platform !== "darwin") {
      printVerbose("Universal Binary cleaner only available on macOS");
      return false;
    }

    try {
      const { stdout } = await execAsync("uname -m");
      const arch = stdout.trim();
      if (arch !== "arm64") {
        printVerbose(
          `Universal Binary cleaner requires Apple Silicon (arm64), found: ${arch}`,
        );
        return false;
      }

      // Verify lipo is available
      await execAsync("which lipo");
      return true;
    } catch {
      return false;
    }
  }

  private async findExecutablesInApp(appPath: string): Promise<string[]> {
    const executables: string[] = [];
    const macosPath = path.join(appPath, "Contents", "MacOS");

    try {
      if (!(await pathExists(macosPath))) {
        return [];
      }

      const entries = await fs.readdir(macosPath);
      for (const entry of entries) {
        const fullPath = path.join(macosPath, entry);
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isFile()) {
            // Check if it's an executable (not a script or config)
            const { stdout } = await execAsync(
              `file "${fullPath}" 2>/dev/null`,
            );
            if (
              stdout.includes("Mach-O") &&
              !SKIP_EXECUTABLES.has(path.basename(fullPath))
            ) {
              executables.push(fullPath);
            }
          }
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Skip apps we can't read
    }

    return executables;
  }

  private async checkIfUniversal(
    binaryPath: string,
  ): Promise<{ isUniversal: boolean; architectures: string[] }> {
    try {
      const { stdout } = await execAsync(`lipo -info "${binaryPath}" 2>&1`);

      // Parse lipo output: "Architectures in the fat file: /path are: x86_64 arm64"
      // or "Non-fat file: /path is architecture: arm64"
      if (stdout.includes("Architectures in the fat file")) {
        const archMatch = stdout.match(/are:\s*(.+)$/m);
        if (archMatch) {
          const architectures = archMatch[1].trim().split(/\s+/);
          return {
            isUniversal: architectures.length > 1,
            architectures,
          };
        }
      }

      // Single architecture
      const singleArchMatch = stdout.match(/is architecture:\s*(\w+)/);
      if (singleArchMatch) {
        return {
          isUniversal: false,
          architectures: [singleArchMatch[1]],
        };
      }

      return { isUniversal: false, architectures: [] };
    } catch {
      return { isUniversal: false, architectures: [] };
    }
  }

  private async getBinarySize(binaryPath: string): Promise<number> {
    try {
      const stat = await fs.stat(binaryPath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  private async scanForUniversalBinaries(): Promise<UniversalBinaryInfo[]> {
    const universalBinaries: UniversalBinaryInfo[] = [];

    for (const appDir of APP_DIRECTORIES) {
      if (!(await pathExists(appDir))) {
        continue;
      }

      printVerbose(`Scanning ${appDir} for Universal Binaries...`);

      try {
        const entries = await fs.readdir(appDir);
        for (const entry of entries) {
          if (!entry.endsWith(".app")) {
            continue;
          }

          const appPath = path.join(appDir, entry);
          const executables = await this.findExecutablesInApp(appPath);

          for (const execPath of executables) {
            const { isUniversal, architectures } =
              await this.checkIfUniversal(execPath);

            if (isUniversal && architectures.includes("arm64")) {
              const totalSize = await this.getBinarySize(execPath);
              // Estimate savings as roughly half the binary size (x86_64 portion)
              const x86Archs = architectures.filter(
                (a) => a.includes("x86") || a.includes("i386"),
              );
              const potentialSavings = Math.round(
                (totalSize * x86Archs.length) / architectures.length,
              );

              universalBinaries.push({
                appPath,
                appName: path.basename(appPath, ".app"),
                binaryPath: execPath,
                totalSize,
                architectures,
                potentialSavings,
              });

              printVerbose(
                `Found Universal Binary: ${entry} (${architectures.join(", ")}) - potential savings: ${(potentialSavings / (1024 * 1024)).toFixed(1)} MB`,
              );
            }
          }
        }
      } catch (error) {
        printVerbose(`Error scanning ${appDir}: ${error}`);
      }
    }

    return universalBinaries;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    if (!(await this.isAvailable())) {
      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [],
        isInstalled: false,
        size: 0,
      };
    }

    printVerbose("Scanning for Universal Binaries on Apple Silicon...");
    this.universalBinaries = await this.scanForUniversalBinaries();

    const totalSavings = this.universalBinaries.reduce(
      (sum, b) => sum + b.potentialSavings,
      0,
    );

    printVerbose(`Found ${this.universalBinaries.length} Universal Binaries`);
    printVerbose(
      `Total potential savings: ${(totalSavings / (1024 * 1024)).toFixed(1)} MB`,
    );

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: this.universalBinaries.map((b) => b.binaryPath),
      isInstalled: true,
      size: totalSavings, // Report potential savings as "cache size"
      categories: await this.getCacheCategories(),
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    if (this.universalBinaries.length === 0) {
      this.universalBinaries = await this.scanForUniversalBinaries();
    }

    // Group by application for user-friendly selection
    return this.universalBinaries.map((binary) => ({
      id: `universal-${binary.appName.toLowerCase().replace(/\s+/g, "-")}`,
      name: binary.appName,
      description: `Universal Binary: ${binary.architectures.join(", ")} - ${(binary.potentialSavings / (1024 * 1024)).toFixed(1)} MB potential savings`,
      paths: [binary.binaryPath],
      size: binary.potentialSavings,
      priority: "low" as const, // Thinning is optional optimization
      useCase: "archived" as const, // x86_64 code is legacy on Apple Silicon
      isProjectSpecific: false,
    }));
  }

  async clear(
    dryRun = false,
    criteria?: CacheSelectionCriteria,
    cacheInfo?: CacheInfo,
  ): Promise<ClearResult> {
    const info = cacheInfo || (await this.getCacheInfo());

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error:
          "Universal Binary cleaner requires macOS on Apple Silicon (arm64)",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    // Filter binaries based on criteria
    let binariesToThin = this.universalBinaries;

    if (criteria?.categories && criteria.categories.length > 0) {
      binariesToThin = binariesToThin.filter((b) => {
        const categoryId = `universal-${b.appName.toLowerCase().replace(/\s+/g, "-")}`;
        return criteria.categories!.includes(categoryId);
      });
    }

    if (binariesToThin.length === 0) {
      return {
        name: this.name,
        success: true,
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = binariesToThin.reduce((sum, b) => sum + b.totalSize, 0);
    if (dryRun) {
      printVerbose(
        `[DRY RUN] Would thin ${binariesToThin.length} Universal Binaries:`,
      );
      for (const binary of binariesToThin) {
        printVerbose(
          `  • ${binary.appName}: ${binary.architectures.join(", ")} → arm64 only`,
        );
        printVerbose(
          `    Potential savings: ${(binary.potentialSavings / (1024 * 1024)).toFixed(1)} MB`,
        );
      }
      return {
        name: this.name,
        success: true,
        sizeBefore,
        sizeAfter: sizeBefore,
        clearedPaths: binariesToThin.map((b) => b.binaryPath),
      };
    }

    const clearedPaths: string[] = [];
    let totalFreed = 0;
    let error: string | undefined;

    for (const binary of binariesToThin) {
      try {
        printVerbose(`Thinning ${binary.appName}...`);

        // Create backup first (optional safety measure)
        const backupPath = `${binary.binaryPath}.universal.bak`;

        // Thin the binary to arm64 only
        // Note: This requires proper permissions and may need sudo for system apps
        const tempPath = `${binary.binaryPath}.thin`;

        try {
          // Extract arm64 slice to temp file
          await execAsync(
            `lipo -thin arm64 "${binary.binaryPath}" -output "${tempPath}"`,
          );

          // Backup original
          await fs.rename(binary.binaryPath, backupPath);

          // Move thinned version
          await fs.rename(tempPath, binary.binaryPath);

          // Preserve permissions
          await execAsync(`chmod +x "${binary.binaryPath}"`);

          // Remove backup on success
          await fs.unlink(backupPath);

          clearedPaths.push(binary.binaryPath);
          totalFreed += binary.potentialSavings;

          printVerbose(
            `✓ Thinned ${binary.appName}: saved ${(binary.potentialSavings / (1024 * 1024)).toFixed(1)} MB`,
          );
        } catch (thinError) {
          // Restore backup if it exists
          if (await pathExists(backupPath)) {
            try {
              await fs.rename(backupPath, binary.binaryPath);
            } catch {
              // Backup restore failed
            }
          }
          throw thinError;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        printVerbose(`Failed to thin ${binary.appName}: ${errMsg}`);

        if (!error) {
          error = `Some binaries could not be thinned (may require elevated permissions): ${errMsg}`;
        }
      }
    }

    return {
      name: this.name,
      success: clearedPaths.length > 0,
      sizeBefore,
      sizeAfter: sizeBefore - totalFreed,
      error,
      clearedPaths,
    };
  }

  async clearByCategory(
    categoryIds: string[],
    dryRun = false,
  ): Promise<ClearResult> {
    return this.clear(dryRun, { categories: categoryIds });
  }

  static create(): UniversalBinaryCleaner {
    return new UniversalBinaryCleaner();
  }
}

export default UniversalBinaryCleaner.create();
