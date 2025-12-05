import { Command } from "commander";
import inquirer from "inquirer";
import pc from "picocolors";

import {
  formatSizeWithColor,
  printInfo,
  printError,
  printHeader,
} from "../utils/cli";
import { config } from "../config";
import { CacheType, CacheCategory } from "../types";
import { profileManager } from "../profiles";
import { cleanerRegistry } from "../cleaners/CleanerRegistry";

interface InteractiveOptions {
  verbose?: boolean;
  profile?: string;
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

export const interactiveEnhancedCommand = new Command("interactive")
  .alias("i")
  .description(
    "interactively select and clean caches with advanced granular control",
  )
  .option("-v, --verbose", "enable verbose output")
  .option("-p, --profile <profile>", "use a specific user profile")
  .action(async (options: InteractiveOptions) => {
    try {
      // Check if we're in a TTY environment
      if (!process.stdin.isTTY) {
        printError("Interactive mode requires a TTY environment.");
        return;
      }

      printHeader("🚀 Enhanced Interactive Cache Cleaning");

      // Set verbose mode
      if (options.verbose) {
        config.set({ output: { ...config.get().output, verbose: true } });
      }

      // Profile selection
      if (options.profile) {
        const profile = profileManager.getProfile(options.profile);
        if (profile) {
          profileManager.setActiveProfile(options.profile);
          console.log(
            pc.green(`✅ Using profile: ${profile.icon} ${profile.name}`),
          );
          console.log(pc.gray(`   ${profile.description}`));
        }
      } else {
        // Ask user to select a profile
        const profiles = profileManager.getAllProfiles();
        const { selectedProfile } = await inquirer.prompt([
          {
            type: "list",
            name: "selectedProfile",
            message: "Select a user profile (or skip for custom selection):",
            choices: [
              { name: "Skip (Custom Selection)", value: null },
              ...profiles.map((p) => ({
                name: `${p.icon} ${p.name} - ${p.description}`,
                value: p.id,
              })),
            ],
          },
        ]);

        if (selectedProfile) {
          const profile = profileManager.getProfile(selectedProfile);
          if (profile) {
            profileManager.setActiveProfile(selectedProfile);
            const configToApply = profileManager.applyProfile(selectedProfile);
            if (configToApply) {
              config.set(configToApply);
            }
          }
        }
      }

      // Get protected paths
      const currentConfig = config.get();
      let protectedPaths = currentConfig.protectedPaths || [];

      // Ask if user wants to configure protected paths
      const { configureProtected } = await inquirer.prompt([
        {
          type: "confirm",
          name: "configureProtected",
          message: "Would you like to configure protected paths?",
          default: false,
        },
      ]);

      if (configureProtected) {
        const { protectedAction } = await inquirer.prompt([
          {
            type: "list",
            name: "protectedAction",
            message: "How would you like to configure protected paths?",
            choices: [
              { name: "Add new protected paths", value: "add" },
              { name: "View current protected paths", value: "view" },
              { name: "Remove protected paths", value: "remove" },
              { name: "Skip", value: "skip" },
            ],
          },
        ]);

        switch (protectedAction) {
          case "add":
            const { newPaths } = await inquirer.prompt([
              {
                type: "input",
                name: "newPaths",
                message:
                  "Enter paths to protect (comma-separated, supports glob patterns):",
                filter: (input: string) =>
                  input
                    .split(",")
                    .map((p) => p.trim())
                    .filter((p) => p),
              },
            ]);
            if (newPaths.length > 0) {
              protectedPaths = [...protectedPaths, ...newPaths];
              config.set({ ...currentConfig, protectedPaths });
              console.log(
                pc.green(`✅ Added ${newPaths.length} protected path(s)`),
              );
            }
            break;

          case "view":
            if (protectedPaths.length > 0) {
              console.log(pc.bold("\n🛡️ Protected Paths:"));
              protectedPaths.forEach((p) => console.log(`   • ${p}`));
            } else {
              console.log(pc.yellow("No protected paths configured"));
            }
            break;

          case "remove":
            if (protectedPaths.length > 0) {
              const { pathsToRemove } = await inquirer.prompt([
                {
                  type: "checkbox",
                  name: "pathsToRemove",
                  message: "Select paths to remove from protection:",
                  choices: protectedPaths.map((p) => ({ name: p, value: p })),
                },
              ]);
              protectedPaths = protectedPaths.filter(
                (p) => !pathsToRemove.includes(p),
              );
              config.set({ ...currentConfig, protectedPaths });
              console.log(
                pc.green(
                  `✅ Removed ${pathsToRemove.length} protected path(s)`,
                ),
              );
            }
            break;
        }
      }

      // Scan for caches
      printInfo("🔍 Scanning for available caches...");
      await cleanerRegistry.autoDetect();
      const allCleaners = await cleanerRegistry.getAvailableCleaners();

      if (allCleaners.length === 0) {
        console.log(
          pc.yellow("\n⚠️  No caches found with reclaimable space."),
        );
        return;
      }

      // Get cache info for all cleaners
      const cacheInfoMap = new Map();
      const categoriesMap = new Map();
      let totalSize = 0;

      for (const cleaner of allCleaners) {
        const info = await cleaner.getCacheInfo();
        cacheInfoMap.set(cleaner.name, info);

        if (cleaner.getCacheCategories) {
          const categories = await cleaner.getCacheCategories();
          categoriesMap.set(cleaner.name, categories);

          // Calculate total size from categories
          categories.forEach((cat) => {
            totalSize += cat.size || 0;
          });
        } else if (info.totalSize) {
          totalSize += info.totalSize;
        }
      }

      // Display summary
      console.log(pc.bold("\n📋 Available Cleaners:"));
      allCleaners.forEach((cleaner) => {
        const info = cacheInfoMap.get(cleaner.name);
        const categories = categoriesMap.get(cleaner.name);
        const emoji = getCacheEmoji(cleaner.type);
        const size = info.totalSize || 0;

        console.log(
          `\n   ${emoji} ${pc.bold(cleaner.name)} - ${formatSizeWithColor(size)}`,
        );
        console.log(`      ${pc.gray(cleaner.description)}`);

        if (categories && categories.length > 0) {
          console.log(
            `      ${pc.cyan(`${categories.length} categories available`)}`,
          );
        }
      });

      console.log(
        pc.bold(
          `\n💾 Total reclaimable space: ${pc.green(formatSizeWithColor(totalSize))}\n`,
        ),
      );

      // Selection method
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
              name: "🎯 Granular selection (per tool, with categories)",
              value: "granular",
            },
            {
              name: "📂 Select by cache type",
              value: "type",
            },
            {
              name: "⚙️ Advanced criteria (age, size, priority)",
              value: "advanced",
            },
            {
              name: "❌ Cancel",
              value: "cancel",
            },
          ],
        },
      ]);

      if (selectionMethod === "cancel") {
        console.log(pc.yellow("Cancelled"));
        return;
      }

      let selectedCleaners: any[] = [];
      let selectedCategories = new Map<string, string[]>();

      switch (selectionMethod) {
        case "all":
          selectedCleaners = allCleaners;
          break;

        case "granular":
          // For each cleaner, allow granular category selection
          for (const cleaner of allCleaners) {
            const categories = categoriesMap.get(cleaner.name);
            const info = cacheInfoMap.get(cleaner.name);

            const { selectTool } = await inquirer.prompt([
              {
                type: "confirm",
                name: "selectTool",
                message: `Include ${getCacheEmoji(cleaner.type)} ${cleaner.name}? (${formatSizeWithColor(info.totalSize || 0)})`,
                default: true,
              },
            ]);

            if (selectTool) {
              selectedCleaners.push(cleaner);

              if (categories && categories.length > 1) {
                const { granularSelection } = await inquirer.prompt([
                  {
                    type: "confirm",
                    name: "granularSelection",
                    message: `   Would you like to select specific categories for ${cleaner.name}?`,
                    default: false,
                  },
                ]);

                if (granularSelection) {
                  const { selectedCats } = await inquirer.prompt([
                    {
                      type: "checkbox",
                      name: "selectedCats",
                      message: `   Select categories for ${cleaner.name}:`,
                      choices: categories.map((cat: CacheCategory) => ({
                        name: `${cat.name} - ${formatSizeWithColor(cat.size || 0)} (${cat.priority} priority, ${cat.ageInDays}d old)`,
                        value: cat.id,
                        checked: cat.priority !== "critical",
                      })),
                    },
                  ]);

                  if (selectedCats.length > 0) {
                    selectedCategories.set(cleaner.name, selectedCats);
                  }
                }
              }
            }
          }
          break;

        case "type":
          const types: CacheType[] = [
            "package-manager",
            "build-tool",
            "browser",
            "ide",
            "system",
          ];
          const { selectedTypes } = await inquirer.prompt([
            {
              type: "checkbox",
              name: "selectedTypes",
              message: "Select cache types to clean:",
              choices: types.map((type) => ({
                name: `${getCacheEmoji(type)} ${type}`,
                value: type,
              })),
            },
          ]);

          selectedCleaners = allCleaners.filter((c) =>
            selectedTypes.includes(c.type),
          );
          break;

        case "advanced":
          const { criteria } = await inquirer.prompt([
            {
              type: "checkbox",
              name: "criteria",
              message: "Select advanced criteria:",
              choices: [
                { name: "Age-based (older than X days)", value: "age" },
                { name: "Size-based (larger than X MB)", value: "size" },
                { name: "Priority-based", value: "priority" },
                { name: "Use case-based", value: "usecase" },
              ],
            },
          ]);

          let advancedCriteria: any = {};

          if (criteria.includes("age")) {
            const { olderThan } = await inquirer.prompt([
              {
                type: "number",
                name: "olderThan",
                message: "Clean caches older than (days):",
                default: 30,
              },
            ]);
            advancedCriteria.olderThanDays = olderThan;
          }

          if (criteria.includes("size")) {
            const { largerThan } = await inquirer.prompt([
              {
                type: "number",
                name: "largerThan",
                message: "Clean caches larger than (MB):",
                default: 100,
              },
            ]);
            advancedCriteria.largerThanMB = largerThan;
          }

          if (criteria.includes("priority")) {
            const { priorities } = await inquirer.prompt([
              {
                type: "checkbox",
                name: "priorities",
                message: "Include caches with priority:",
                choices: [
                  { name: "Low", value: "low", checked: true },
                  { name: "Normal", value: "normal", checked: true },
                  { name: "Important", value: "important", checked: false },
                  { name: "Critical", value: "critical", checked: false },
                ],
              },
            ]);
            advancedCriteria.priorities = priorities;
          }

          if (criteria.includes("usecase")) {
            const { useCases } = await inquirer.prompt([
              {
                type: "checkbox",
                name: "useCases",
                message: "Include caches for use cases:",
                choices: [
                  { name: "Development", value: "development" },
                  { name: "Testing", value: "testing" },
                  { name: "Production", value: "production" },
                  { name: "Experimental", value: "experimental" },
                  { name: "Archived", value: "archived", checked: true },
                ],
              },
            ]);
            advancedCriteria.useCases = useCases;
          }

          // Apply criteria to all cleaners
          selectedCleaners = allCleaners;
          // Store criteria for use during cleaning
          selectedCleaners.forEach((cleaner) => {
            (cleaner as any).criteria = advancedCriteria;
          });
          break;
      }

      if (selectedCleaners.length === 0) {
        console.log(pc.yellow("No cleaners selected"));
        return;
      }

      // Confirmation with dry run option
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What would you like to do?",
          choices: [
            { name: "👀 Preview (dry run)", value: "dryrun" },
            { name: "🧹 Clean selected caches", value: "clean" },
            { name: "❌ Cancel", value: "cancel" },
          ],
        },
      ]);

      if (action === "cancel") {
        console.log(pc.yellow("Cancelled"));
        return;
      }

      const isDryRun = action === "dryrun";

      // Execute cleaning
      console.log(
        pc.bold(
          `\n${isDryRun ? "👀 Preview Mode" : "🧹 Cleaning"} Selected Caches...\n`,
        ),
      );

      for (const cleaner of selectedCleaners) {
        const info = cacheInfoMap.get(cleaner.name);
        const categoryIds = selectedCategories.get(cleaner.name);
        const criteria = (cleaner as any).criteria;

        console.log(
          `${getCacheEmoji(cleaner.type)} Processing ${pc.bold(cleaner.name)}...`,
        );

        try {
          let result;

          if (categoryIds && cleaner.clearByCategory) {
            // Clear specific categories
            result = await cleaner.clearByCategory(
              categoryIds,
              isDryRun,
              info,
              protectedPaths,
            );
          } else {
            // Clear with criteria or all
            result = await cleaner.clear(
              isDryRun,
              criteria,
              info,
              protectedPaths,
            );
          }

          if (result.success) {
            const savedSize = result.sizeBefore - (result.sizeAfter || 0);
            console.log(
              pc.green(
                `   ✅ ${isDryRun ? "Would save" : "Saved"}: ${formatSizeWithColor(savedSize)}`,
              ),
            );

            if (
              result.clearedCategories &&
              result.clearedCategories.length > 0
            ) {
              console.log(
                pc.gray(
                  `      Categories: ${result.clearedCategories.join(", ")}`,
                ),
              );
            }

            if (protectedPaths.length > 0 && result.clearedPaths) {
              const skippedCount =
                info.paths.length - result.clearedPaths.length;
              if (skippedCount > 0) {
                console.log(
                  pc.yellow(
                    `      Skipped ${skippedCount} protected path(s)`,
                  ),
                );
              }
            }
          } else {
            console.log(pc.red(`   ❌ Failed: ${result.error}`));
          }
        } catch (error) {
          console.log(pc.red(`   ❌ Error: ${error}`));
        }
      }

      // Summary
      console.log(pc.bold("\n✨ Complete!"));

      if (!isDryRun) {
        // Save configuration if modified
        if (protectedPaths.length > 0) {
          config.set({ ...currentConfig, protectedPaths });
        }

        console.log(pc.green("Cache cleaning completed successfully!"));
      } else {
        console.log(
          pc.yellow(
            "This was a dry run. Run without preview to actually clean caches.",
          ),
        );
      }
    } catch (error) {
      printError(`Interactive mode error: ${error}`);
      process.exit(1);
    }
  });

export default interactiveEnhancedCommand;
