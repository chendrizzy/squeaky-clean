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
import { commandExists } from "../utils/which";

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

// Mach-O cputype values (CPU_ARCH_ABI64 flag = 0x01000000)
const CPU_TYPE_NAMES: Record<number, string> = {
  0x00000007: "i386",
  0x01000007: "x86_64",
  0x0000000c: "arm",
  0x0100000c: "arm64",
  0x00000012: "ppc",
  0x01000012: "ppc64",
};

function cpuTypeName(cputype: number): string {
  return CPU_TYPE_NAMES[cputype] ?? `cpu_0x${cputype.toString(16)}`;
}

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

    const arch = os.arch();
    if (arch !== "arm64") {
      printVerbose(
        `Universal Binary cleaner requires Apple Silicon (arm64), found: ${arch}`,
      );
      return false;
    }

    // Verify lipo is available
    return commandExists("lipo");
  }

  /**
   * Read Mach-O architecture info straight from the file's header bytes -
   * what `file` + `lipo -info` report, without two process spawns per file.
   * Returns [] when the file is not a Mach-O binary.
   */
  private async readMachOArchitectures(binaryPath: string): Promise<string[]> {
    let file;
    try {
      file = await fs.open(binaryPath, "r");
      const buffer = Buffer.alloc(1024);
      const { bytesRead } = await file.read(buffer, 0, 1024, 0);
      if (bytesRead < 8) return [];

      const beMagic = buffer.readUInt32BE(0);

      // Fat (universal) binary: big-endian header listing each arch slice
      if (beMagic === 0xcafebabe || beMagic === 0xcafebabf) {
        const count = buffer.readUInt32BE(4);
        // Java .class files share the CAFEBABE magic; their version field
        // here is always far larger than any real architecture count.
        if (count === 0 || count > 30) return [];

        const entrySize = beMagic === 0xcafebabf ? 32 : 20;
        const architectures: string[] = [];
        for (let i = 0; i < count; i++) {
          const offset = 8 + i * entrySize;
          if (offset + 4 > bytesRead) break;
          architectures.push(cpuTypeName(buffer.readUInt32BE(offset)));
        }
        return architectures;
      }

      // Thin Mach-O (little-endian on modern macOS, big-endian on PPC-era)
      const leMagic = buffer.readUInt32LE(0);
      if (leMagic === 0xfeedface || leMagic === 0xfeedfacf) {
        return [cpuTypeName(buffer.readUInt32LE(4))];
      }
      if (beMagic === 0xfeedface || beMagic === 0xfeedfacf) {
        return [cpuTypeName(buffer.readUInt32BE(4))];
      }

      return [];
    } catch {
      return [];
    } finally {
      await file?.close().catch(() => {});
    }
  }

  private async scanApp(appPath: string): Promise<UniversalBinaryInfo[]> {
    const found: UniversalBinaryInfo[] = [];
    const macosPath = path.join(appPath, "Contents", "MacOS");

    let entries: string[];
    try {
      entries = await fs.readdir(macosPath);
    } catch {
      return found; // No Contents/MacOS directory or unreadable
    }

    for (const entry of entries) {
      if (SKIP_EXECUTABLES.has(entry)) continue;

      const binaryPath = path.join(macosPath, entry);
      try {
        const stat = await fs.stat(binaryPath);
        if (!stat.isFile()) continue;

        // Skip macOS dataless/offloaded files (iCloud "Optimize Mac Storage"):
        // blocks===0 with size>0 means the bytes aren't local, and reading the
        // header would force a download just to inspect the architecture.
        if (stat.blocks === 0 && stat.size > 0) {
          printVerbose(`Skipping dataless (offloaded) binary: ${binaryPath}`);
          continue;
        }

        const architectures = await this.readMachOArchitectures(binaryPath);
        const isUniversal = architectures.length > 1;
        if (!isUniversal || !architectures.includes("arm64")) continue;

        // Estimate savings as the x86 slices' share of the binary size
        const totalSize = stat.size;
        const x86Archs = architectures.filter(
          (a) => a.includes("x86") || a.includes("i386"),
        );
        const potentialSavings = Math.round(
          (totalSize * x86Archs.length) / architectures.length,
        );

        found.push({
          appPath,
          appName: path.basename(appPath, ".app"),
          binaryPath,
          totalSize,
          architectures,
          potentialSavings,
        });

        printVerbose(
          `Found Universal Binary: ${path.basename(appPath)} (${architectures.join(", ")}) - potential savings: ${(potentialSavings / (1024 * 1024)).toFixed(1)} MB`,
        );
      } catch {
        // Skip files we can't read
      }
    }

    return found;
  }

  private async scanForUniversalBinaries(): Promise<UniversalBinaryInfo[]> {
    const appPaths: string[] = [];

    for (const appDir of APP_DIRECTORIES) {
      if (!(await pathExists(appDir))) {
        continue;
      }

      printVerbose(`Scanning ${appDir} for Universal Binaries...`);

      try {
        const entries = await fs.readdir(appDir);
        for (const entry of entries) {
          if (entry.endsWith(".app")) {
            appPaths.push(path.join(appDir, entry));
          }
        }
      } catch (error) {
        printVerbose(`Error scanning ${appDir}: ${error}`);
      }
    }

    // Scan apps concurrently; each app is a handful of small header reads
    const universalBinaries: UniversalBinaryInfo[] = [];
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(8, appPaths.length) },
      async () => {
        while (nextIndex < appPaths.length) {
          const appPath = appPaths[nextIndex++];
          universalBinaries.push(...(await this.scanApp(appPath)));
        }
      },
    );
    await Promise.all(workers);

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
