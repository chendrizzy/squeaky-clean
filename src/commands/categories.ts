import { cacheManager } from "../cleaners";
import { printHeader, printInfo, formatSize } from "../utils/cli";
import pc from "picocolors";
import { AppCacheGroupBy, CacheCategory } from "../types";
import { config } from "../config";
import { categoryToViewItem, renderCategoryTree } from "../utils/categoryView";

interface CategoriesOptions {
  tool?: string;
  verbose?: boolean;
  type?: string;
  groupBy?: string;
}

const GROUP_BY_VALUES: AppCacheGroupBy[] = ["app", "tier", "kind", "none"];

/** Validate a --group-by value, falling back to the configured default. */
function resolveGroupBy(value: string | undefined): AppCacheGroupBy {
  const fallback = config.getAppCacheDisplay().groupBy;
  if (!value) return fallback;
  const v = value.trim().toLowerCase();
  return (GROUP_BY_VALUES as string[]).includes(v)
    ? (v as AppCacheGroupBy)
    : fallback;
}

export async function categoriesCommand(
  options: CategoriesOptions,
): Promise<void> {
  printHeader("Cache Categories");

  let cleaners = cacheManager.getAllCleaners();

  // Filter by specific tool if provided
  if (options.tool) {
    cleaners = cleaners.filter((c) => c.name === options.tool);
    if (cleaners.length === 0) {
      printInfo(`Tool '${options.tool}' not found`);
      return;
    }
  }

  // Filter by type if specified
  if (options.type) {
    cleaners = cleaners.filter((c) => c.type === options.type);
  }

  const groupBy = resolveGroupBy(options.groupBy);
  const useColor = config.shouldUseColors();
  const emojiMode = config.getEmojiMode();
  const showEmoji = emojiMode === "on";

  console.log();
  printInfo(`Analyzing cache categories (grouped by ${groupBy})...`);

  for (const cleaner of cleaners) {
    // Cleaners without category support are skipped (only noted under -v).
    if (!cleaner.getCacheCategories) {
      if (options.verbose) {
        console.log(
          pc.gray(`${cleaner.name}: categories not supported (legacy mode)`),
        );
      }
      continue;
    }

    let categories: CacheCategory[];
    try {
      categories = await cleaner.getCacheCategories();
    } catch (error) {
      console.log(pc.red(`  Error analyzing ${cleaner.name}: ${error}`));
      continue;
    }

    if (categories.length === 0) {
      if (options.verbose) {
        console.log(pc.gray(`${cleaner.name}: no caches found`));
      }
      continue;
    }

    const prefix = showEmoji ? "📦 " : "";
    console.log();
    console.log(pc.bold(pc.blue(`${prefix}${cleaner.name.toUpperCase()}`)));
    console.log(pc.gray("─".repeat(50)));

    // Shared renderer: the same grouping/badging the clean command uses, with
    // ids shown so they can be copied into --categories / --allow-manual.
    const items = categories.map(categoryToViewItem);
    const lines = renderCategoryTree(items, {
      groupBy,
      useColor,
      emojiMode,
      indent: "  ",
      showId: true,
    });
    for (const line of lines) console.log(line);

    const totalSize = categories.reduce((sum, c) => sum + (c.size || 0), 0);
    const oldCaches = categories.filter((c) => (c.ageInDays || 0) > 30).length;
    console.log(pc.gray("  " + "─".repeat(25)));
    console.log(
      `  ${pc.bold("Total:")} ${pc.green(String(categories.length))} categories, ` +
        `${pc.yellow(formatSize(totalSize))}` +
        (oldCaches > 0 ? pc.blue(` · ${oldCaches} older than 30d`) : ""),
    );
  }

  console.log();
  printInfo(
    "Tip: regroup with --group-by <app|tier|kind|none>; clean specific IDs with --categories.",
  );
  printInfo(
    "Manual-tier categories need explicit consent (--allow-manual <id>) to clean.",
  );
}
