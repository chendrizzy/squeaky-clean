import { Command } from "commander";
import inquirer from "inquirer";
import pc from "picocolors";
import { cacheManager } from "../cleaners";
import {
  formatSizeWithColor,
  printInfo,
  printError,
  printHeader,
} from "../utils/cli";
import { config } from "../config";
import { CacheCategory, CacheType } from "../types";
import {
  SAFETY_TIER_INFO,
  SAFETY_TIER_ORDER,
  effectiveSafety,
} from "../safety";

interface InteractiveOptions {
  verbose?: boolean;
}

/**
 * Colored safety badge for a cleaner: the WORST (most restricted) tier among
 * its categories. Cleaners without category data get no badge.
 */
function safetyBadge(cache: { categories?: CacheCategory[] }): string {
  const categories = cache.categories;
  if (!categories || categories.length === 0) return "";

  let worstIndex = -1;
  for (const category of categories) {
    const index = SAFETY_TIER_ORDER.indexOf(effectiveSafety(category));
    if (index > worstIndex) worstIndex = index;
  }
  if (worstIndex < 0) return "";

  const info = SAFETY_TIER_INFO[SAFETY_TIER_ORDER[worstIndex]];
  const colorFn =
    (pc as unknown as Record<string, (text: string) => string>)[info.color] ??
    ((text: string) => text);
  return ` ${colorFn(`[${info.label}]`)}`;
}

function getCacheEmoji(type: CacheType): string {
  switch (type) {
    case "package-manager":
      return "📦";
    case "build-tool":
      return "🔨";
    case "browser":
      return "🌐";
    case "ide":
      return "💻";
    case "system":
      return "🖥️";
    default:
      return "📄";
  }
}

function getTypeEmoji(type: string): string {
  switch (type) {
    case "package-manager":
      return "📦";
    case "build-tool":
      return "🔨";
    case "browser":
      return "🌐";
    case "ide":
      return "💻";
    case "system":
      return "🖥️";
    default:
      return "📄";
  }
}

/**
 * Prompts for a top-level selection method and resolves it to cache names.
 * Returns null when the user chooses to exit entirely (vs. an empty array,
 * which means "try a method again" - the caller treats those differently).
 */
async function pickSelectionMethod(
  availableCaches: any[],
  totalSize: number,
): Promise<string[] | null> {
  const { selectionMethod } = await inquirer.prompt([
    {
      type: "list",
      name: "selectionMethod",
      message: "How would you like to select caches to clean?",
      choices: [
        {
          name: `🧹 Clean all caches (save ${formatSizeWithColor(totalSize)})`,
          value: "all",
        },
        {
          name: "🎯 Select individual caches",
          value: "individual",
        },
        {
          name: "📂 Select by cache type",
          value: "type",
        },
        {
          name: "❌ Exit without cleaning",
          value: "exit",
        },
      ],
    },
  ]);

  if (selectionMethod === "exit") return null;

  if (selectionMethod === "all") {
    return availableCaches.map((cache: any) => cache.name);
  }

  if (selectionMethod === "individual") {
    const { caches } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "caches",
        message: "Select caches to clean:",
        pageSize: 15,
        loop: false,
        choices: availableCaches.map((cache: any) => ({
          name: `${getCacheEmoji(cache.type)} ${cache.name}${safetyBadge(cache)} (${formatSizeWithColor(cache.size)}) - ${cache.description}`,
          value: cache.name,
        })),
      },
    ]);
    return caches;
  }

  // type
  const cacheTypes = [
    ...new Set(availableCaches.map((cache: any) => cache.type)),
  ];
  const typeChoices = cacheTypes.map((type: string) => {
    const typeCaches = availableCaches.filter(
      (cache: any) => cache.type === type,
    );
    const typeSize = typeCaches.reduce(
      (sum: number, cache: any) => sum + cache.size,
      0,
    );
    return {
      name: `${getTypeEmoji(type)} ${type} (${typeCaches.length} caches, ${formatSizeWithColor(typeSize)})`,
      value: type,
    };
  });

  const { types } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "types",
      message: "Select cache types to clean:",
      choices: typeChoices,
    },
  ]);

  return availableCaches
    .filter((cache: any) => types.includes(cache.type))
    .map((cache: any) => cache.name);
}

/**
 * Lets the user add/remove individual caches from an existing selection -
 * the reroute target when a dry-run reveals something unwanted, so a single
 * bad pick doesn't force restarting the whole selection flow.
 */
async function adjustSelection(
  availableCaches: any[],
  currentSelection: string[],
): Promise<string[]> {
  const { caches } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "caches",
      message: "Adjust your selection (checked = will be cleaned):",
      pageSize: 15,
      loop: false,
      choices: availableCaches.map((cache: any) => ({
        name: `${getCacheEmoji(cache.type)} ${cache.name}${safetyBadge(cache)} (${formatSizeWithColor(cache.size)}) - ${cache.description}`,
        value: cache.name,
        checked: currentSelection.includes(cache.name),
      })),
    },
  ]);
  return caches;
}

export const interactiveCommand = new Command("interactive")
  .alias("i")
  .description("interactively select and clean caches with guided prompts")
  .option("-v, --verbose", "enable verbose output")
  .action(async (options: InteractiveOptions) => {
    try {
      // Check if we're in a TTY environment
      if (!process.stdin.isTTY) {
        printError("Interactive mode requires a TTY environment.");
        console.log(pc.yellow("💡 Tip: Use non-interactive commands instead:"));
        console.log(pc.gray("   • squeaky clean --all    # Clean all caches"));
        console.log(
          pc.gray(
            "   • squeaky clean --dry-run # Preview what would be cleaned",
          ),
        );
        console.log(
          pc.gray("   • squeaky list --sizes   # List caches with sizes"),
        );
        return;
      }

      printHeader("Interactive Cache Cleaning");

      // Set verbose mode in config if requested
      if (options.verbose) {
        config.set({ output: { ...config.get().output, verbose: true } });
      }

      // Get all available cache info
      printInfo("🔍 Scanning for available caches...");
      const allCaches = await cacheManager.getAllCacheInfo();
      const availableCaches = allCaches.filter(
        (cache: any) => cache.isInstalled && cache.size > 0,
      );

      if (availableCaches.length === 0) {
        console.log(pc.yellow("\n⚠️  No caches found with reclaimable space."));
        console.log(pc.gray("   This could mean:"));
        console.log(pc.gray("   • Your caches are already clean"));
        console.log(
          pc.gray("   • No supported development tools are installed"),
        );
        console.log(
          pc.gray("   • Cache directories are in non-standard locations"),
        );
        return;
      }

      // Display summary
      console.log(pc.bold("\n📋 Found caches:"));
      const totalSize = availableCaches.reduce(
        (sum: number, cache: any) => sum + cache.size,
        0,
      );
      availableCaches.forEach((cache: any) => {
        const size = formatSizeWithColor(cache.size);
        const emoji = getCacheEmoji(cache.type);
        console.log(
          `   ${emoji} ${pc.bold(cache.name)}${safetyBadge(cache)} - ${size} - ${pc.gray(cache.description)}`,
        );
      });

      console.log(
        pc.bold(
          `\n💾 Total reclaimable space: ${pc.green(formatSizeWithColor(totalSize))}\n`,
        ),
      );

      let selectedCaches: string[] = [];

      // Outer loop: a full reselection (e.g. switching from "by type" to
      // "individual") re-enters here without re-scanning caches.
      sessionLoop: for (;;) {
        if (selectedCaches.length === 0) {
          const picked = await pickSelectionMethod(availableCaches, totalSize);
          if (picked === null) {
            console.log(pc.yellow("\n👋 Exiting without cleaning caches."));
            return;
          }
          if (picked.length === 0) {
            console.log(
              pc.yellow("\n⚠️  No caches selected. Choose again, or exit."),
            );
            continue sessionLoop;
          }
          selectedCaches = picked;
        }

        // Inner loop: review the current selection and act on it. A dry run
        // loops back here instead of forcing a binary proceed-or-exit choice,
        // so a dry-run surprise can be fixed with "Adjust selection" rather
        // than restarting the whole command.
        reviewLoop: for (;;) {
          const selectedSize = availableCaches
            .filter((cache: any) => selectedCaches.includes(cache.name))
            .reduce((sum: number, cache: any) => sum + cache.size, 0);

          console.log(pc.bold("\n🎯 Selected for cleaning:"));
          console.log(
            pc.gray(
              `   This will free up approximately ${formatSizeWithColor(selectedSize)}`,
            ),
          );
          selectedCaches.forEach((name: string) => {
            const cache = availableCaches.find((c: any) => c.name === name);
            if (cache) {
              const emoji = getCacheEmoji(cache.type);
              console.log(
                `   ${emoji} ${name} - ${formatSizeWithColor(cache.size || 0)}`,
              );
            }
          });

          const { action } = await inquirer.prompt([
            {
              type: "list",
              name: "action",
              message: "How would you like to proceed?",
              choices: [
                {
                  name: "🔍 Dry run (preview what would be cleaned)",
                  value: "dry",
                },
                {
                  name: "🧹 Clean selected caches now",
                  value: "clean",
                },
                {
                  name: "✏️  Adjust selection",
                  value: "adjust",
                },
                {
                  name: "🔁 Choose a different selection method",
                  value: "restart-selection",
                },
                {
                  name: "❌ Cancel",
                  value: "cancel",
                },
              ],
            },
          ]);

          if (action === "cancel") {
            console.log(pc.yellow("\n👋 Operation cancelled."));
            return;
          }

          if (action === "restart-selection") {
            selectedCaches = [];
            continue sessionLoop;
          }

          if (action === "adjust") {
            selectedCaches = await adjustSelection(
              availableCaches,
              selectedCaches,
            );
            if (selectedCaches.length === 0) {
              console.log(
                pc.yellow(
                  "\n⚠️  No caches selected. Choose a selection method again.",
                ),
              );
              continue sessionLoop;
            }
            continue reviewLoop;
          }

          const isDryRun = action === "dry";

          // Execute cleaning
          console.log(
            pc.bold(
              `\n${isDryRun ? "🔍 DRY RUN: " : "🧹 "}Cleaning selected caches...\n`,
            ),
          );

          // `include` clears exactly the selected caches without re-scanning
          // every other cleaner just to build an exclude list.
          const results = await cacheManager.cleanAllCaches({
            dryRun: isDryRun,
            include: selectedCaches,
          });

          // Display results
          let totalFreed = 0;
          results.forEach((result: any) => {
            const emoji = result.success ? "✅" : "❌";
            const freed = result.sizeBefore;
            totalFreed += freed;

            if (result.success) {
              const freedStr =
                freed > 0
                  ? ` (${formatSizeWithColor(freed)} ${isDryRun ? "would be " : ""}freed)`
                  : "";
              console.log(`${emoji} ${result.name}${freedStr}`);

              if (
                options.verbose &&
                result.clearedPaths &&
                result.clearedPaths.length > 0
              ) {
                result.clearedPaths.forEach((path: string) => {
                  console.log(pc.gray(`     → ${path}`));
                });
              }
            } else {
              console.log(
                `${emoji} ${result.name}: ${pc.red(result.error || "Unknown error")}`,
              );
            }
          });

          // Summary
          console.log();
          if (totalFreed > 0) {
            console.log(
              `   ${pc.green(formatSizeWithColor(totalFreed))} ${isDryRun ? "would be" : "was"} freed\n`,
            );
          } else {
            console.log(pc.yellow("   No space was freed\n"));
          }

          if (isDryRun) {
            // Back to the same review menu: now the user can clean for real,
            // adjust the selection based on what the preview showed, restart
            // with a different method, or cancel - no dead end.
            continue reviewLoop;
          }

          console.log(pc.bold("🎉 Interactive cleaning session complete!"));

          const { cleanMore } = await inquirer.prompt([
            {
              type: "confirm",
              name: "cleanMore",
              message: "Would you like to clean anything else?",
              default: false,
            },
          ]);

          if (!cleanMore) return;

          selectedCaches = [];
          continue sessionLoop;
        }
      }
    } catch (error) {
      printError(
        `Interactive command failed: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  });
