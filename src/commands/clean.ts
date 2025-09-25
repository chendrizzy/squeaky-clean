import { CommandOptions, CacheType } from "../types";
import {
  printInfo,
  printSuccess,
  printError,
  printWarning,
  printCleanComplete,
  symbols,
  formatSizeWithColor,
} from "../utils/cli";
import { cacheManager } from "../cleaners";
import { config } from "../config";
import ora from "ora";

export async function cleanCommand(options: CommandOptions): Promise<void> {
  try {
    if (options.dryRun) {
      printInfo(`DRY RUN: Showing what would be cleaned...`);
    } else {
      printInfo(`${symbols.soap} Starting cleanup process...`);
    }

    // Parse types if specified
    const types: CacheType[] | undefined = options.types
      ? ((Array.isArray(options.types)
          ? options.types.join(",")
          : options.types
        )
          .split(",")
          .map((t) => t.trim()) as CacheType[])
      : undefined;

    // Parse exclude list if specified
    const exclude: string[] | undefined = options.exclude
      ? (Array.isArray(options.exclude)
          ? options.exclude.join(",")
          : options.exclude
        )
          .split(",")
          .map((t) => t.trim())
      : undefined;

    // Parse include list if specified
    const include: string[] | undefined = options.include
      ? (Array.isArray(options.include)
          ? options.include.join(",")
          : options.include
        )
          .split(",")
          .map((t) => t.trim())
      : undefined;

    // Parse sub-caches if specified
    let subCachesToClear: Map<string, string[]> | undefined;
    if (options.subCaches) {
      subCachesToClear = new Map<string, string[]>();
      const pairs = (
        Array.isArray(options.subCaches)
          ? options.subCaches.join(",")
          : options.subCaches
      ).split(",");
      for (const pair of pairs) {
        const [cleanerName, categoryId] = pair.trim().split(":");
        if (cleanerName && categoryId) {
          if (!subCachesToClear.has(cleanerName)) {
            subCachesToClear.set(cleanerName, []);
          }
          subCachesToClear.get(cleanerName)!.push(categoryId);
        }
      }
    }

    // Check if user wants confirmation and we're not in force mode
    if (
      !options.dryRun &&
      !options.force &&
      config.shouldRequireConfirmation()
    ) {
      printWarning(
        "This will permanently delete cache files. Use --dry-run to preview or --force to skip confirmation.",
      );
      printInfo(
        "For now, running in dry-run mode to show what would be cleaned...",
      );
      options.dryRun = true;
    }

    // Get cache info first if showing sizes
    if (options.sizes && !options.dryRun) {
      const sizeSpinner = ora("Scanning cache sizes...").start();
      try {
        const cacheInfos = await cacheManager.getAllCacheInfo();
        const totalSize = cacheInfos.reduce(
          (sum, info) => sum + (info.size || 0),
          0,
        );
        sizeSpinner.succeed(
          `Total cache size found: ${formatSizeWithColor(totalSize)}`,
        );
      } catch (error) {
        sizeSpinner.fail("Failed to scan cache sizes");
        throw error;
      }
    }

    // Clean the caches
    const cleanSpinner = ora(
      options.dryRun ? "Analyzing caches..." : "Cleaning caches...",
    ).start();
    let results;
    try {
      results = await cacheManager.cleanAllCaches({
        dryRun: options.dryRun,
        types,
        exclude,
        include,
        subCachesToClear, // Pass sub-caches option
      });
      cleanSpinner.stop();
    } catch (error) {
      cleanSpinner.fail(
        options.dryRun ? "Failed to analyze caches" : "Failed to clean caches",
      );
      throw error;
    }

    // Report results
    let totalFreed = 0;
    let successCount = 0;
    let errorCount = 0;

    console.log(); // Add some space

    for (const result of results) {
      if (result.success) {
        // In dry-run mode, sizeBefore shows what would be cleaned
        // In actual clean mode, it shows what was cleaned
        const freed = options.dryRun
          ? result.sizeBefore || 0
          : (result.sizeBefore || 0) - (result.sizeAfter || 0);
        totalFreed += freed;
        successCount++;

        if (freed > 0) {
          const freedFormatted = formatSizeWithColor(freed);
          printSuccess(
            `${result.name}: ${freedFormatted} ${options.dryRun ? "would be" : ""} freed ${symbols.bubbles}`,
          );
        } else {
          printInfo(`${result.name}: No cache data found`);
        }
      } else {
        errorCount++;
        printError(`${result.name}: ${result.error || "Unknown error"}`);
      }
    }

    console.log(); // Add some space

    // Summary
    if (totalFreed > 0) {
      const totalFreedFormatted = formatSizeWithColor(totalFreed);
      printSuccess(
        `Total ${options.dryRun ? "potential " : ""}space freed: ${totalFreedFormatted}`,
      );
    }

    if (errorCount > 0) {
      printWarning(
        `${errorCount} cache${errorCount > 1 ? "s" : ""} had errors`,
      );
    }

    if (successCount > 0 && !options.dryRun) {
      printCleanComplete("Your dev environment is now squeaky clean!");
    } else if (options.dryRun) {
      printInfo(
        `${symbols.soap} Run without --dry-run to actually clean these caches`,
      );
    } else {
      printInfo("No caches were cleaned");
    }
  } catch (error) {
    printError(`Clean command error: ${error}`);
    throw error;
  }
}
