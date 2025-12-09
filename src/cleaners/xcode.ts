import { promises as fs } from "fs";
import path from "path";
import * as os from "os";
import execa from "execa";
import {
  CacheInfo,
  ClearResult,
  CleanerModule,
  CacheSelectionCriteria,
} from "../types";
import { getDirectorySize, pathExists, safeRmrf } from "../utils/fs";
import { printVerbose } from "../utils/cli";

export class XcodeCleaner implements CleanerModule {
  name = "xcode";
  type = "ide" as const;
  description =
    "Xcode cache, derived data, archives, simulators, and device support files";

  private getCachePaths(): Array<{
    path: string;
    description: string;
    category: string;
  }> {
    const homeDir = os.homedir();
    const libraryDir = path.join(homeDir, "Library");

    return [
      // Derived Data - biggest cache culprit (builds, indexes, logs)
      {
        path: path.join(libraryDir, "Developer", "Xcode", "DerivedData"),
        description: "Build outputs, indexes, and intermediate files",
        category: "Derived Data",
      },

      // Archives - can be large but may contain important builds
      {
        path: path.join(libraryDir, "Developer", "Xcode", "Archives"),
        description: "App archives and distribution builds",
        category: "Archives",
      },

      // Device Support - accumulates over time with new iOS versions
      {
        path: path.join(libraryDir, "Developer", "Xcode", "iOS DeviceSupport"),
        description: "iOS device debugging symbols and support files",
        category: "Device Support",
      },
      {
        path: path.join(
          libraryDir,
          "Developer",
          "Xcode",
          "watchOS DeviceSupport",
        ),
        description: "watchOS device debugging symbols",
        category: "Device Support",
      },
      {
        path: path.join(libraryDir, "Developer", "Xcode", "tvOS DeviceSupport"),
        description: "tvOS device debugging symbols",
        category: "Device Support",
      },

      // Core Simulator caches
      {
        path: path.join(libraryDir, "Developer", "CoreSimulator", "Caches"),
        description: "iOS Simulator cache files",
        category: "Simulators",
      },
      {
        path: path.join(libraryDir, "Developer", "CoreSimulator", "Logs"),
        description: "iOS Simulator log files",
        category: "Simulators",
      },

      // Xcode caches and temporary files
      {
        path: path.join(libraryDir, "Caches", "com.apple.dt.Xcode"),
        description: "Xcode application cache",
        category: "App Cache",
      },
      {
        path: path.join(libraryDir, "Caches", "com.apple.dt.XCTest-device"),
        description: "XCTest device cache",
        category: "Testing",
      },
      {
        path: path.join(libraryDir, "Caches", "com.apple.dt.XCTest-simulator"),
        description: "XCTest simulator cache",
        category: "Testing",
      },

      // Documentation and help caches
      {
        path: path.join(libraryDir, "Caches", "com.apple.helpd"),
        description: "Xcode documentation cache",
        category: "Documentation",
      },

      // Provisioning profiles cache
      {
        path: path.join(libraryDir, "MobileDevice", "Provisioning Profiles"),
        description: "Cached provisioning profiles",
        category: "Provisioning",
      },

      // Swift package manager cache (if using SPM)
      {
        path: path.join(libraryDir, "Caches", "org.swift.swiftpm"),
        description: "Swift Package Manager cache",
        category: "Package Manager",
      },
      {
        path: path.join(libraryDir, "org.swift.swiftpm"),
        description: "Swift Package Manager data",
        category: "Package Manager",
      },

      // CocoaPods cache (if using CocoaPods)
      {
        path: path.join(libraryDir, "Caches", "CocoaPods"),
        description: "CocoaPods cache files",
        category: "Package Manager",
      },

      // Instruments and profiling
      {
        path: path.join(libraryDir, "Application Support", "Instruments"),
        description: "Instruments profiling data",
        category: "Profiling",
      },

      // Old simulator devices (can be huge)
      {
        path: path.join(libraryDir, "Developer", "CoreSimulator", "Devices"),
        description: "iOS Simulator device data (⚠️  Contains app data)",
        category: "Simulators",
      },
    ];
  }

  async isAvailable(): Promise<boolean> {
    try {
      printVerbose("Checking if Xcode is installed...");

      // Check for Xcode installation
      const xcodeAppPaths = [
        "/Applications/Xcode.app",
        "/Applications/Xcode-beta.app",
      ];

      for (const xcodePath of xcodeAppPaths) {
        if (await pathExists(xcodePath)) {
          printVerbose(`Found Xcode at ${xcodePath}`);
          return true;
        }
      }

      // Also check for command line tools
      try {
        await execa("xcode-select", ["--print-path"]);
        printVerbose("Found Xcode command line tools");
        return true;
      } catch {
        // Neither GUI Xcode nor command line tools found
      }

      return false;
    } catch {
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const allPaths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;
    let lastModified: Date | undefined;
    const categories = new Map<string, { size: number; count: number }>();

    printVerbose(`Checking ${allPaths.length} Xcode cache locations...`);

    for (const { path: cachePath, description, category } of allPaths) {
      if (await pathExists(cachePath)) {
        existingPaths.push(cachePath);

        try {
          const size = await getDirectorySize(cachePath);
          totalSize += size;

          // Track by category
          const existing = categories.get(category) || { size: 0, count: 0 };
          categories.set(category, {
            size: existing.size + size,
            count: existing.count + 1,
          });

          const stats = await fs.stat(cachePath);
          if (!lastModified || stats.mtime > lastModified) {
            lastModified = stats.mtime;
          }

          const sizeInMB = (size / (1024 * 1024)).toFixed(1);
          printVerbose(
            `Found ${category}: ${cachePath} (${sizeInMB} MB) - ${description}`,
          );
        } catch (error) {
          printVerbose(`Error checking ${cachePath}: ${error}`);
        }
      }
    }

    // Log category summary
    if (categories.size > 0) {
      printVerbose("=== Xcode Cache Summary by Category ===");
      categories.forEach((info, category) => {
        const sizeInMB = (info.size / (1024 * 1024)).toFixed(1);
        printVerbose(`${category}: ${info.count} locations, ${sizeInMB} MB`);
      });
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: existingPaths,
      isInstalled: await this.isAvailable(),
      size: totalSize,
      lastModified,
    };
  }

  async clear(
    dryRun = false,
    _criteria?: CacheSelectionCriteria,
    cacheInfo?: CacheInfo,
  ): Promise<ClearResult> {
    const info = cacheInfo || (await this.getCacheInfo());
    const clearedPaths: string[] = [];
    const sizeBefore = info.size || 0;
    let success = true;
    let error: string | undefined;

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: "Xcode is not installed",
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    if (info.paths.length === 0) {
      printVerbose("No Xcode cache directories found");
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
        printVerbose(
          `[DRY RUN] Would clear ${info.paths.length} Xcode cache locations:`,
        );
        const pathsWithInfo = this.getCachePaths();
        for (const cachePath of info.paths) {
          const pathInfo = pathsWithInfo.find((p) => p.path === cachePath);
          printVerbose(`  • ${pathInfo?.category || "Unknown"}: ${cachePath}`);
          if (pathInfo?.description) {
            printVerbose(`    ${pathInfo.description}`);
          }
        }
        return {
          name: this.name,
          success: true,
          sizeBefore,
          sizeAfter: sizeBefore,
          clearedPaths: info.paths,
        };
      }

      const pathsWithInfo = this.getCachePaths();

      // Clear caches by category priority (safest first)
      const priorityOrder = [
        "App Cache",
        "Testing",
        "Documentation",
        "Profiling",
        "Package Manager",
        "Derived Data",
        "Simulators",
        "Device Support",
        "Provisioning",
        "Archives", // Most careful with archives as they may contain important builds
      ];

      const categorizedPaths = new Map<string, string[]>();
      for (const cachePath of info.paths) {
        const pathInfo = pathsWithInfo.find((p) => p.path === cachePath);
        const category = pathInfo?.category || "Other";

        if (!categorizedPaths.has(category)) {
          categorizedPaths.set(category, []);
        }
        categorizedPaths.get(category)!.push(cachePath);
      }

      // Clear in priority order
      for (const category of priorityOrder) {
        const paths = categorizedPaths.get(category);
        if (!paths) continue;

        printVerbose(`Clearing ${category} caches...`);

        for (const cachePath of paths) {
          try {
            if (await pathExists(cachePath)) {
              const pathInfo = pathsWithInfo.find((p) => p.path === cachePath);

              // Special handling for simulator devices - more cautious
              if (category === "Simulators" && cachePath.includes("Devices")) {
                printVerbose(
                  `Cautiously clearing simulator device data: ${cachePath}`,
                );
                // Could add more specific logic here to preserve certain simulators
              }

              printVerbose(`Clearing ${category}: ${cachePath}`);
              if (pathInfo?.description) {
                printVerbose(`  Purpose: ${pathInfo.description}`);
              }

              await safeRmrf(cachePath);
              clearedPaths.push(cachePath);
            }
          } catch (pathError) {
            printVerbose(`Failed to clear ${cachePath}: ${pathError}`);
            success = false;
            if (!error) {
              error = `Failed to clear some Xcode cache directories: ${pathError}`;
            }
          }
        }
      }

      // Handle any remaining uncategorized paths
      const remainingPaths = info.paths.filter(
        (p) => !clearedPaths.includes(p),
      );
      for (const cachePath of remainingPaths) {
        try {
          if (await pathExists(cachePath)) {
            printVerbose(`Clearing remaining cache: ${cachePath}`);
            await safeRmrf(cachePath);
            clearedPaths.push(cachePath);
          }
        } catch (pathError) {
          printVerbose(`Failed to clear ${cachePath}: ${pathError}`);
          success = false;
          if (!error) {
            error = `Failed to clear some cache directories: ${pathError}`;
          }
        }
      }

      if (sizeBefore > 0) {
        printVerbose(`Freed space from Xcode cache data`);
      }

      return {
        name: this.name,
        success,
        sizeBefore,
        sizeAfter: 0, // Set to 0 as we don't want to rescan
        error,
        clearedPaths,
      };
    } catch (clearError) {
      return {
        name: this.name,
        success: false,
        sizeBefore,
        sizeAfter: sizeBefore,
        error:
          clearError instanceof Error ? clearError.message : String(clearError),
        clearedPaths,
      };
    }
  }

  // Static method to create instance
  static create(): XcodeCleaner {
    return new XcodeCleaner();
  }
}

// Export default instance
export default XcodeCleaner.create();
