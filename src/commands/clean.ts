import {
  CommandOptions,
  CacheType,
  CacheCategory,
  CacheSelectionCriteria,
  CleanerModule,
  SafetyTier,
} from "../types";
import {
  printInfo,
  printSuccess,
  printError,
  printWarning,
  printCleanComplete,
  symbols,
  formatSize,
  formatSizeWithColor,
} from "../utils/cli";
import { cacheManager } from "../cleaners";
import { config } from "../config";
import {
  CLEANING_PROFILES,
  CleaningProfileName,
  DEFAULT_PROFILE,
  SAFETY_TIER_ORDER,
  effectiveSafety,
  isCleaningProfileName,
  parseSafetyTiers,
  tiersForProfile,
} from "../safety";
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

/**
 * Parse an age expression like "7d", "2w", "1m" (or a bare number of days)
 * into days. Returns undefined for unparseable input.
 */
export function parseAgeToDays(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*([dwmy])?$/i.exec(String(value).trim());
  if (!match) return undefined;
  const amount = parseFloat(match[1]);
  const unit = (match[2] || "d").toLowerCase();
  const multipliers: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };
  return amount * (multipliers[unit] ?? 1);
}

/**
 * Parse a size expression like "100MB", "1GB" (or a bare number of MB) into
 * megabytes. Returns undefined for unparseable input.
 */
export function parseSizeToMB(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i.exec(
    String(value).trim(),
  );
  if (!match) return undefined;
  const amount = parseFloat(match[1]);
  const unit = (match[2] || "mb").toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1 / (1024 * 1024),
    kb: 1 / 1024,
    mb: 1,
    gb: 1024,
    tb: 1024 * 1024,
  };
  return amount * (multipliers[unit] ?? 1);
}

export type SafetyTierResolution =
  | {
      ok: true;
      tiers: SafetyTier[];
      source: "safety-flag" | "profile-flag" | "config" | "default";
      profile?: CleaningProfileName;
    }
  | { ok: false; error: string };

/**
 * Resolve the safety tiers to clean. Precedence:
 * 1. --safety (explicit tier list, overrides everything)
 * 2. --profile (named cleaning profile)
 * 3. config activeProfile (when it names a cleaning profile)
 * 4. the built-in default profile
 */
export function resolveSafetyTiers(
  options: Pick<CommandOptions, "safety" | "profile">,
  configStore: { get(): { activeProfile?: string } } = config,
): SafetyTierResolution {
  if (options.safety !== undefined) {
    const tiers = parseSafetyTiers(String(options.safety));
    if (!tiers) {
      return {
        ok: false,
        error: `Invalid --safety value "${options.safety}". Valid tiers: ${SAFETY_TIER_ORDER.join(", ")}`,
      };
    }
    return { ok: true, tiers, source: "safety-flag" };
  }

  if (options.profile !== undefined) {
    const profile = String(options.profile).trim().toLowerCase();
    if (!isCleaningProfileName(profile)) {
      return {
        ok: false,
        error: `Invalid --profile "${options.profile}". Valid profiles: ${Object.keys(CLEANING_PROFILES).join(", ")}`,
      };
    }
    return {
      ok: true,
      tiers: tiersForProfile(profile),
      source: "profile-flag",
      profile,
    };
  }

  const activeProfile = configStore.get().activeProfile;
  if (activeProfile && isCleaningProfileName(activeProfile)) {
    return {
      ok: true,
      tiers: tiersForProfile(activeProfile),
      source: "config",
      profile: activeProfile,
    };
  }

  return {
    ok: true,
    tiers: tiersForProfile(DEFAULT_PROFILE),
    source: "default",
    profile: DEFAULT_PROFILE,
  };
}

/**
 * Mirror the cleaner selection logic in CacheManager.cleanAllCaches so we can
 * inspect manual-tier categories before any cleaning starts.
 */
function selectTargetCleaners(
  types?: CacheType[],
  include?: string[],
  exclude?: string[],
): CleanerModule[] {
  let cleaners = cacheManager.getEnabledCleaners?.() ?? [];

  if (types && types.length > 0) {
    cleaners = cleaners.filter((cleaner) => types.includes(cleaner.type));
  }

  if (include && include.length > 0) {
    cleaners = cleaners.filter((cleaner) => include.includes(cleaner.name));
  } else if (exclude && exclude.length > 0) {
    cleaners = cleaners.filter((cleaner) => !exclude.includes(cleaner.name));
  }

  return cleaners;
}

interface PendingManualCategory {
  cleanerName: string;
  category: CacheCategory;
}

/**
 * Collect manual-tier categories on the target cleaners that do not yet have
 * explicit consent via allowManualIds.
 */
async function collectPendingManualCategories(
  cleaners: CleanerModule[],
  allowManualIds: string[],
): Promise<PendingManualCategory[]> {
  const pending: PendingManualCategory[] = [];

  for (const cleaner of cleaners) {
    if (!cleaner.getCacheCategories) continue;
    try {
      const categories = await cleaner.getCacheCategories();
      for (const category of categories) {
        if (effectiveSafety(category) !== "manual") continue;
        if (allowManualIds.includes(category.id)) continue;
        pending.push({ cleanerName: cleaner.name, category });
      }
    } catch {
      // A cleaner failing to enumerate categories should not abort the run.
    }
  }

  return pending;
}

function describeManualCategory(item: PendingManualCategory): string {
  const sizeText =
    item.category.size !== undefined
      ? formatSize(item.category.size)
      : "unknown size";
  return `${item.category.name} [${item.category.id}] (${item.cleanerName}, ${sizeText})`;
}

/**
 * Prompt per manual-tier category; only confirmed ids are returned. Prompt
 * failures count as "no" - manual categories are never cleaned implicitly.
 */
async function confirmManualCategories(
  pending: PendingManualCategory[],
): Promise<string[]> {
  const confirmedIds: string[] = [];

  printWarning(
    `${pending.length} cache categor${pending.length === 1 ? "y" : "ies"} require explicit confirmation (manual tier):`,
  );

  for (const item of pending) {
    try {
      const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
        {
          type: "confirm",
          name: "confirmed",
          message: `Clean ${describeManualCategory(item)}? ${item.category.description}`,
          default: false,
        },
      ]);
      if (confirmed) confirmedIds.push(item.category.id);
    } catch {
      // Treat prompt failures as declined.
    }
  }

  return confirmedIds;
}

function printSkippedManualCategories(pending: PendingManualCategory[]): void {
  printWarning("Skipped (requires manual confirmation):");
  for (const item of pending) {
    console.log(`  - ${describeManualCategory(item)}`);
  }
  printInfo(
    "Re-run with --allow-manual <id> or use interactive mode to clean these.",
  );
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

    // Resolve safety tiers: --safety > --profile > config activeProfile > default.
    const resolution = resolveSafetyTiers(options, config);
    if (!resolution.ok) {
      printError(resolution.error);
      process.exitCode = 1;
      return;
    }

    // Build the selection criteria from the granular flags.
    const criteria: CacheSelectionCriteria = {
      safetyTiers: resolution.tiers,
      allowManualIds: parseCsvOption(options.allowManual) ?? [],
    };

    if (options.olderThan) {
      const days = parseAgeToDays(options.olderThan);
      if (days === undefined) {
        printWarning(`Ignoring unparseable --older-than: ${options.olderThan}`);
      } else {
        criteria.olderThanDays = days;
      }
    }
    if (options.newerThan) {
      const days = parseAgeToDays(options.newerThan);
      if (days === undefined) {
        printWarning(`Ignoring unparseable --newer-than: ${options.newerThan}`);
      } else {
        criteria.newerThanDays = days;
      }
    }
    if (options.largerThan) {
      const mb = parseSizeToMB(options.largerThan);
      if (mb === undefined) {
        printWarning(
          `Ignoring unparseable --larger-than: ${options.largerThan}`,
        );
      } else {
        criteria.largerThanMB = mb;
      }
    }
    if (options.smallerThan) {
      const mb = parseSizeToMB(options.smallerThan);
      if (mb === undefined) {
        printWarning(
          `Ignoring unparseable --smaller-than: ${options.smallerThan}`,
        );
      } else {
        criteria.smallerThanMB = mb;
      }
    }

    const useCases = parseCsvOption(options.useCase);
    if (useCases) {
      criteria.useCases = useCases as NonNullable<
        CacheSelectionCriteria["useCases"]
      >;
    }
    const priorities = parseCsvOption(options.priority);
    if (priorities) {
      criteria.priorities = priorities as NonNullable<
        CacheSelectionCriteria["priorities"]
      >;
    }
    const categoryIds = parseCsvOption(options.categories);
    if (categoryIds) {
      criteria.categories = categoryIds;
    }

    // Pre-clean banner: show which profile/tiers govern this run.
    printInfo(
      resolution.source === "safety-flag"
        ? `Safety tiers: ${resolution.tiers.join(", ")} (custom via --safety)`
        : `Profile: ${resolution.profile} (${resolution.tiers.join(", ")})`,
    );
    if (resolution.source === "safety-flag" || options.profile) {
      // Honest scoping note: tier filtering operates on cache CATEGORIES.
      // Classic tool cleaners without category granularity clean their
      // whole cache when selected, regardless of tier restrictions.
      printInfo(
        "Tier filtering applies per cache category; category-less tool cleaners clean whole-tool when selected.",
      );
    }

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

    // Manual-tier categories require explicit per-category consent. --force
    // never auto-confirms them: prompt when interactive, otherwise skip them
    // with a clear notice.
    const targetCleaners = selectTargetCleaners(types, include, exclude);
    const pendingManual = await collectPendingManualCategories(
      targetCleaners,
      criteria.allowManualIds ?? [],
    );
    if (pendingManual.length > 0) {
      if (!dryRun && canPromptForConfirmation()) {
        const confirmedIds = await confirmManualCategories(pendingManual);
        if (confirmedIds.length > 0) {
          criteria.allowManualIds = [
            ...(criteria.allowManualIds ?? []),
            ...confirmedIds,
          ];
        }
        const declined = pendingManual.filter(
          (item) => !confirmedIds.includes(item.category.id),
        );
        if (declined.length > 0) {
          printSkippedManualCategories(declined);
        }
      } else {
        printSkippedManualCategories(pendingManual);
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
        criteria,
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
