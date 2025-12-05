import {
  printInfo,
  printSuccess,
  printError,
  printWarning,
  formatSizeWithColor,
  symbols,
} from "../utils/cli";
import { cacheManager } from "../cleaners";
import ora from "ora";

interface AutoOptions {
  safe?: boolean;
  aggressive?: boolean;
  verbose?: boolean;
}

export async function autoCommand(options: AutoOptions): Promise<void> {
  try {
    console.log("\n🤖 Intelligent Cache Cleaning");
    console.log("─".repeat(40));
    printInfo("Analyzing your development environment...");

    const spinner = ora("Scanning caches...").start();

    // Get all cache information, excluding universal-binary (separate operation)
    const cacheInfos = await cacheManager.getAllCacheInfo();
    const availableCaches = cacheInfos.filter(
      (info) =>
        info.isInstalled &&
        (info.size || 0) > 0 &&
        info.name !== "universal-binary", // UB is a separate operation via `squeaky ub`
    );

    spinner.stop();

    if (availableCaches.length === 0) {
      printInfo("No caches found with reclaimable space.");
      printSuccess("Your development environment is already clean! 🎉");
      return;
    }

    // Set thresholds based on mode
    const minSizeBytes = options.aggressive
      ? 5 * 1024 * 1024 // 5MB in aggressive mode
      : 20 * 1024 * 1024; // 20MB in safe mode

    const maxAgeDays = options.aggressive ? 3 : 7; // 3 days aggressive, 7 days safe
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - maxAgeMs);

    // Smart filtering logic
    const recommendations: Array<{
      cache: any;
      reason: string;
      priority: "high" | "medium" | "low";
      safe: boolean;
    }> = [];

    for (const cache of availableCaches) {
      const sizeInMB = (cache.size || 0) / (1024 * 1024);
      const lastModified = cache.lastModified
        ? new Date(cache.lastModified)
        : null;
      const isOld = lastModified && lastModified < cutoffDate;

      // High priority: Large, old, or temporary caches
      const cacheSafe = isSafeToAutoClean(cache.name, cache.type);
      if (sizeInMB > 100) {
        recommendations.push({
          cache,
          reason: `Large cache (${sizeInMB.toFixed(1)} MB)`,
          priority: "high",
          safe: cacheSafe,
        });
      } else if (isOld && sizeInMB > minSizeBytes / (1024 * 1024)) {
        recommendations.push({
          cache,
          reason: `Old cache (${Math.floor((Date.now() - lastModified!.getTime()) / (24 * 60 * 60 * 1000))} days)`,
          priority: "high",
          safe: cacheSafe,
        });
      }
      // Medium priority: Moderate size caches
      else if (sizeInMB > 50) {
        recommendations.push({
          cache,
          reason: `Moderate size (${sizeInMB.toFixed(1)} MB)`,
          priority: "medium",
          safe: isSafeToAutoClean(cache.name, cache.type),
        });
      }
      // Low priority: Smaller caches that are safe to clean
      else if (
        sizeInMB > minSizeBytes / (1024 * 1024) &&
        isSafeToAutoClean(cache.name, cache.type)
      ) {
        recommendations.push({
          cache,
          reason: `Safe cache (${sizeInMB.toFixed(1)} MB)`,
          priority: "low",
          safe: true,
        });
      }
    }

    if (recommendations.length === 0) {
      printInfo("No caches meet the criteria for automatic cleaning.");
      printInfo(
        "Your caches are either small, recent, or contain important data.",
      );
      printInfo("💡 Use `squeaky clean --dry-run` for manual review.");
      return;
    }

    // Sort by priority and size
    recommendations.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return (b.cache.size || 0) - (a.cache.size || 0);
    });

    // Display recommendations
    console.log("\n🎯 Smart Cleaning Recommendations:");
    console.log();

    let totalRecommendedSize = 0;
    const safesToClean: string[] = [];
    const needsReview: string[] = [];

    for (const rec of recommendations) {
      const emoji = getPriorityEmoji(rec.priority);
      const sizeStr = formatSizeWithColor(rec.cache.size || 0);
      const safetyFlag = rec.safe ? "✅" : "⚠️";

      console.log(`${emoji} ${safetyFlag} ${rec.cache.name} - ${sizeStr}`);
      console.log(`     ${rec.reason}`);

      totalRecommendedSize += rec.cache.size || 0;

      if (rec.safe) {
        safesToClean.push(rec.cache.name);
      } else {
        needsReview.push(rec.cache.name);
      }
    }

    console.log();
    printInfo(
      `💾 Total recommended for cleaning: ${formatSizeWithColor(totalRecommendedSize)}`,
    );

    if (safesToClean.length > 0) {
      console.log();
      printSuccess(`✅ Safe to auto-clean (${safesToClean.length} caches):`);
      safesToClean.forEach((name) => console.log(`   • ${name}`));
    }

    if (needsReview.length > 0) {
      console.log();
      printWarning(`⚠️  Need manual review (${needsReview.length} caches):`);
      needsReview.forEach((name) => console.log(`   • ${name}`));
    }

    // Execute cleaning based on mode
    const mode = options.aggressive
      ? "aggressive"
      : options.safe
        ? "safe"
        : "smart";
    console.log();
    printInfo(`🤖 Running in ${mode} mode...`);

    if (options.safe) {
      printInfo("Safe mode: Only cleaning verified safe caches.");
    } else if (options.aggressive) {
      printInfo("Aggressive mode: Cleaning all recommended caches.");
    }

    const cachesToClean = options.aggressive
      ? recommendations.map((r) => r.cache.name)
      : safesToClean;

    if (cachesToClean.length > 0) {
      const excludeCaches = cacheInfos
        .filter((cache) => !cachesToClean.includes(cache.name))
        .map((cache) => cache.name);

      console.log();
      const cleanSpinner = ora("Cleaning recommended caches...").start();

      try {
        const results = await cacheManager.cleanAllCaches({
          dryRun: false,
          exclude: excludeCaches,
        });

        cleanSpinner.stop();

        let actualFreed = 0;
        let cleanedCount = 0;
        let errorCount = 0;

        console.log();
        for (const result of results) {
          if (!cachesToClean.includes(result.name)) continue;

          if (result.success) {
            const freed = (result.sizeBefore || 0) - (result.sizeAfter || 0);
            actualFreed += freed;
            cleanedCount++;

            if (freed > 0) {
              printSuccess(
                `${symbols.bubbles} ${result.name}: ${formatSizeWithColor(freed)} freed`,
              );
            }
          } else {
            errorCount++;
            printError(`❌ ${result.name}: ${result.error || "Unknown error"}`);
          }
        }

        console.log();

        if (actualFreed > 0) {
          printSuccess(
            `🎉 Auto-cleaning complete! Freed ${formatSizeWithColor(actualFreed)}`,
          );
          printSuccess(`✨ Your dev environment is now squeaky clean!`);
        } else {
          printInfo("No space was actually freed (caches may have been empty)");
        }

        if (needsReview.length > 0 && !options.aggressive) {
          console.log();
          printInfo("💡 Pro tip: Review the flagged caches manually:");
          printInfo("   `squeaky clean --dry-run` to preview all caches");
          printInfo("   `squeaky auto --aggressive` to clean everything");
        }
      } catch (error) {
        cleanSpinner.fail("Auto-cleaning failed");
        throw error;
      }
    } else {
      printInfo("No caches selected for automatic cleaning.");
    }
  } catch (error) {
    printError(`Auto command error: ${error}`);
    throw error;
  }
}

function getPriorityEmoji(priority: "high" | "medium" | "low"): string {
  switch (priority) {
    case "high":
      return "🔥";
    case "medium":
      return "⚡";
    case "low":
      return "💡";
  }
}

/**
 * Determine if a cache is safe to clean automatically based on cleaner type
 * and known characteristics.
 */
function isSafeToAutoClean(cacheName: string, cacheType: string): boolean {
  // Universal binary is a separate operation - never auto-clean
  if (cacheName === "universal-binary") {
    return false;
  }

  // Package managers are generally safe (downloaded artifacts can be re-fetched)
  if (cacheType === "package-manager") {
    return true;
  }

  // Build tools are generally safe (can be rebuilt)
  if (cacheType === "build-tool") {
    return true;
  }

  // Docker is safe (images can be re-pulled, but may take time)
  if (cacheName === "docker") {
    return true;
  }

  // Gradle is safe (downloaded dependencies)
  if (cacheName === "gradle") {
    return true;
  }

  // Browsers may contain user data - needs review
  if (cacheType === "browser") {
    return false;
  }

  // IDEs may contain important settings/history - needs review
  // But Xcode DerivedData is safe, VSCode/Cursor/Windsurf caches are generally safe
  const safeIdeCaches = ["xcode", "vscode", "cursor", "windsurf", "zed"];
  if (cacheType === "ide" && safeIdeCaches.includes(cacheName)) {
    return true;
  }

  return false;
}
