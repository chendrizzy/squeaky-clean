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
import inquirer from "inquirer";

function parseCsvOption(value?: string | string[]): string[] | undefined {
  if (!value) return undefined;

  const parsed = (Array.isArray(value) ? value.join(",") : value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : undefined;
}

function parseTypes(value?: string | string[]): CacheType[] | undefined {
  return parseCsvOption(value) as CacheType[] | undefined;
}

function parseSubCaches(
  value?: string | string[],
): Map<string, string[]> | undefined {
  const pairs = parseCsvOption(value);
  if (!pairs) return undefined;

  const subCachesToClear = new Map<string, string[]>();

  for (const pair of pairs) {
    const [cleanerName, categoryId] = pair
      .split(":")
      .map((part) => part.trim());
    if (!cleanerName || !categoryId) continue;

    if (!subCachesToClear.has(cleanerName)) {
      subCachesToClear.set(cleanerName, []);
    }
    subCachesToClear.get(cleanerName)!.push(categoryId);
  }

  return subCachesToClear.size > 0 ? subCachesToClear : undefined;
}

function canPromptForConfirmation(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function confirmCleanup(): Promise<boolean> {
  try {
    const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
      {
        type: "confirm",
        name: "confirmed",
        message: "Proceed with cache cleanup?",
        default: false,
      },
    ]);

    return confirmed;
  } catch {
    return false;
  }
}

export async function cleanCommand(options: CommandOptions): Promise<void> {
  try {
    const dryRun = Boolean(options.dryRun);

    const types = parseTypes(options.types);
    const exclude = parseCsvOption(options.exclude);
    const include = parseCsvOption(options.include);
    const subCachesToClear = parseSubCaches(options.subCaches);

    if (dryRun) {
      printInfo(
        "Dry run: showing what would be cleaned. No files will be deleted.",
      );
    } else if (!options.force && config.shouldRequireConfirmation()) {
      printWarning("This will permanently delete cache files.");
      printInfo("Use --dry-run to preview or --force to skip this prompt.");

      if (!canPromptForConfirmation()) {
        printWarning(
          "Confirmation is required, but this terminal cannot prompt.",
        );
        printInfo(
          "No caches were cleaned. Re-run with --force to clean or --dry-run to preview.",
        );
        return;
      }

      const confirmed = await confirmCleanup();
      if (!confirmed) {
        printInfo("Operation cancelled. No caches were cleaned.");
        return;
      }
    }

    if (!dryRun) {
      printInfo("Starting cleanup process...");
    }

    // Get cache info first if showing sizes
    if (options.sizes && !dryRun) {
      // Use real-time parallel progress tracking for size scanning
      printInfo("Scanning cache sizes...");
      try {
        const cacheInfos = await cacheManager.getAllCacheInfo({
          showProgress: true, // Enable real-time progress tracking
        });
        const totalSize = cacheInfos.reduce(
          (sum, info) => sum + (info.size || 0),
          0,
        );
        printSuccess(
          `Total cache size found: ${formatSizeWithColor(totalSize)}`,
        );
      } catch (error) {
        printError("Failed to scan cache sizes");
        throw error;
      }
    }

    // Clean the caches
    let results;
    try {
      printInfo(
        dryRun ? "Analyzing selected caches..." : "Scanning selected caches...",
      );
      results = await cacheManager.cleanAllCaches({
        dryRun,
        types,
        exclude,
        include,
        subCachesToClear,
        showProgress: Boolean(process.stdout.isTTY),
      });
    } catch (error) {
      printError(
        dryRun ? "Failed to analyze caches" : "Failed to clean caches",
      );
      throw error;
    }

    // Report results
    let totalFreed = 0;
    let successCount = 0;
    let errorCount = 0;

    if (results.length > 0) {
      console.log();
    }

    for (const result of results) {
      if (result.success) {
        // In dry-run mode, sizeBefore shows what would be cleaned
        // In actual clean mode, it shows what was cleaned
        const freed = dryRun
          ? result.sizeBefore || 0
          : (result.sizeBefore || 0) - (result.sizeAfter || 0);
        totalFreed += freed;
        successCount++;

        if (freed > 0) {
          const freedFormatted = formatSizeWithColor(freed);
          const action = dryRun ? "would be freed" : "freed";
          printSuccess(
            `${result.name}: ${freedFormatted} ${action} ${symbols.bubbles}`,
          );
        } else {
          printInfo(`${result.name}: No cache data found`);
        }
      } else {
        errorCount++;
        printError(`${result.name}: ${result.error || "Unknown error"}`);
      }
    }

    if (results.length > 0) {
      console.log();
    }

    // Summary
    if (totalFreed > 0) {
      const totalFreedFormatted = formatSizeWithColor(totalFreed);
      printSuccess(
        `Total ${dryRun ? "potential " : ""}space freed: ${totalFreedFormatted}`,
      );
    }

    if (errorCount > 0) {
      printWarning(
        `${errorCount} cache${errorCount > 1 ? "s" : ""} had errors`,
      );
    }

    if (successCount > 0 && !dryRun) {
      printCleanComplete("Your dev environment is now squeaky clean!");
    } else if (dryRun) {
      printInfo("Run without --dry-run to actually clean these caches");
    } else {
      printInfo("No caches were cleaned");
    }
  } catch (error) {
    printError(`Clean command error: ${error}`);
    throw error;
  }
}
