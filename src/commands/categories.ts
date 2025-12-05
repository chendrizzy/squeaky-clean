import { cacheManager } from "../cleaners";
import { printHeader, printInfo, printSuccess, formatSize } from "../utils/cli";
import pc from "picocolors";
import { CacheCategory } from "../types";

interface CategoriesOptions {
  tool?: string;
  verbose?: boolean;
  type?: string;
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

  console.log(pc.cyan("\n📊 Analyzing cache categories...\n"));

  for (const cleaner of cleaners) {
    // Check if cleaner supports categories
    if (!cleaner.getCacheCategories) {
      if (options.verbose) {
        console.log(
          pc.gray(
            `${cleaner.name}: Categories not supported (using legacy mode)`,
          ),
        );
      }
      continue;
    }

    try {
      const categories = await cleaner.getCacheCategories();

      if (categories.length === 0) {
        console.log(pc.gray(`${cleaner.name}: No caches found`));
        continue;
      }

      console.log(
        pc.bold(
          pc.blue(`\n📦 ${cleaner.name.toUpperCase()} Cache Categories:`),
        ),
      );
      console.log(pc.gray("─".repeat(50)));

      // Group categories by use case
      const grouped: { [key: string]: CacheCategory[] } = {};
      for (const category of categories) {
        const key = category.useCase || "other";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(category);
      }

      // Display categories grouped by use case
      for (const [useCase, cats] of Object.entries(grouped)) {
        console.log(
          pc.yellow(
            `\n  ${getUseCaseEmoji(useCase)} ${useCase.toUpperCase()}:`,
          ),
        );

        for (const cat of cats) {
          const priorityColor = getPriorityColor(cat.priority);
          const ageText =
            cat.ageInDays !== undefined
              ? pc.gray(`(${cat.ageInDays}d old)`)
              : "";
          const sizeText = cat.size
            ? pc.cyan(formatSize(cat.size))
            : pc.gray("unknown size");
          const projectText =
            cat.isProjectSpecific && cat.projectPath
              ? pc.magenta(`[${path.basename(cat.projectPath)}]`)
              : "";

          console.log(`    ${priorityColor("●")} ${pc.bold(cat.name)}`);
          console.log(`      ID: ${pc.gray(cat.id)}`);
          console.log(`      Size: ${sizeText} ${ageText} ${projectText}`);
          console.log(`      Priority: ${priorityColor(cat.priority)}`);

          if (options.verbose) {
            console.log(`      Path: ${pc.gray(cat.paths.join(", "))}`);
            console.log(`      Description: ${pc.gray(cat.description)}`);
            if (cat.lastModified) {
              console.log(
                `      Last Modified: ${pc.gray(cat.lastModified.toLocaleDateString())}`,
              );
            }
          }
        }
      }

      // Summary
      const totalSize = categories.reduce((sum, c) => sum + (c.size || 0), 0);
      const criticalCount = categories.filter(
        (c) => c.priority === "critical",
      ).length;
      const oldCaches = categories.filter(
        (c) => (c.ageInDays || 0) > 30,
      ).length;

      console.log(pc.gray("\n  ─".repeat(25)));
      console.log(pc.bold(`  Summary:`));
      console.log(`    Total Categories: ${pc.green(categories.length)}`);
      console.log(`    Total Size: ${pc.yellow(formatSize(totalSize))}`);
      if (criticalCount > 0) {
        console.log(
          `    Critical Caches: ${pc.red(criticalCount)} (recently used, preserve)`,
        );
      }
      if (oldCaches > 0) {
        console.log(
          `    Old Caches (>30d): ${pc.blue(oldCaches)} (safe to clean)`,
        );
      }
    } catch (error) {
      console.log(pc.red(`  Error analyzing ${cleaner.name}: ${error}`));
    }
  }

  console.log();
  printSuccess(
    "💡 Use category IDs with --categories flag to selectively clean",
  );
  printInfo(
    "💡 Use --older-than flag to clean old caches (e.g., --older-than 7d)",
  );
  printInfo(
    "💡 Use --priority flag to preserve important caches (e.g., --priority low)",
  );
}

function getUseCaseEmoji(useCase: string): string {
  switch (useCase) {
    case "development":
      return "🔧";
    case "testing":
      return "🧪";
    case "production":
      return "🚀";
    case "experimental":
      return "🔬";
    case "archived":
      return "📦";
    default:
      return "📁";
  }
}

function getPriorityColor(priority: string): (text: string) => string {
  switch (priority) {
    case "critical":
      return pc.red;
    case "important":
      return pc.yellow;
    case "normal":
      return pc.green;
    case "low":
      return pc.gray;
    default:
      return pc.white;
  }
}

// Import path for basename
import path from "path";
