import {
  printInfo,
  printSuccess,
  printError,
  printWarning,
  formatSizeWithColor,
  symbols,
} from "../utils/cli";
import { UniversalBinaryCleaner } from "../cleaners/universalBinary";
import ora from "ora";
import inquirer from "inquirer";

interface UBOptions {
  all?: boolean;
  dryRun?: boolean;
  list?: boolean;
  verbose?: boolean;
  force?: boolean;
}

export async function ubCommand(options: UBOptions): Promise<void> {
  console.log("\n🍎 Universal Binary Thinner for Apple Silicon");
  console.log("─".repeat(50));

  const cleaner = new UniversalBinaryCleaner();

  // Check availability first
  if (!(await cleaner.isAvailable())) {
    printError(
      "Universal Binary cleaner requires macOS on Apple Silicon (arm64)",
    );
    printInfo(
      "This feature is only available on Macs with Apple Silicon chips.",
    );
    return;
  }

  const spinner = ora("Scanning for Universal Binaries...").start();

  try {
    const cacheInfo = await cleaner.getCacheInfo();
    spinner.stop();

    if (!cacheInfo.isInstalled || cacheInfo.paths.length === 0) {
      printInfo("No Universal Binaries found that can be thinned.");
      printSuccess("Your applications are already optimized for Apple Silicon!");
      return;
    }

    const categories = cacheInfo.categories || [];
    const totalSavings = cacheInfo.size || 0;

    // List mode - just show what's available
    if (options.list) {
      console.log("\n📋 Universal Binaries found:\n");

      for (const cat of categories) {
        const sizeStr = formatSizeWithColor(cat.size || 0);
        console.log(`  ${symbols.binary} ${cat.name}`);
        console.log(`     Architectures: ${cat.description.split(":")[1]?.split("-")[0]?.trim() || "Universal"}`);
        console.log(`     Potential savings: ${sizeStr}`);
        console.log();
      }

      printInfo(
        `Total potential savings: ${formatSizeWithColor(totalSavings)}`,
      );
      console.log();
      printInfo("💡 Run `squeaky ub` to interactively select binaries to thin");
      printInfo("   Run `squeaky ub --all` to thin all Universal Binaries");
      return;
    }

    // Display found binaries
    console.log(`\n${symbols.sparkles} Found ${categories.length} Universal Binaries:\n`);

    for (const cat of categories) {
      const sizeStr = formatSizeWithColor(cat.size || 0);
      console.log(`  • ${cat.name} - ${sizeStr} potential savings`);
    }

    console.log();
    printInfo(`Total potential savings: ${formatSizeWithColor(totalSavings)}`);

    // Determine which binaries to thin
    let binariesToThin: string[] = [];

    if (options.all) {
      // Thin all binaries
      binariesToThin = categories.map((cat) => cat.id);
      printInfo("All Universal Binaries selected for thinning.");
    } else {
      // Interactive selection
      console.log();
      printWarning(
        "⚠️  Warning: Thinning removes x86_64 code from application binaries.",
      );
      printWarning(
        "   This is generally safe but cannot be easily undone.",
      );
      printWarning(
        "   Affected apps can be reinstalled if needed.",
      );
      console.log();

      const choices = categories.map((cat) => ({
        name: `${cat.name} (${formatSizeWithColor(cat.size || 0)} savings)`,
        value: cat.id,
        checked: false,
      }));

      try {
        const answers = await inquirer.prompt<{ binaries: string[] }>([
          {
            type: "checkbox",
            name: "binaries",
            message: "Select applications to thin (space to select, enter to confirm):",
            choices,
          },
        ]);
        binariesToThin = answers.binaries;
      } catch (error) {
        // User cancelled
        printInfo("Operation cancelled.");
        return;
      }
    }

    if (binariesToThin.length === 0) {
      printInfo("No binaries selected for thinning.");
      return;
    }

    // Calculate selected savings
    const selectedSavings = categories
      .filter((cat) => binariesToThin.includes(cat.id))
      .reduce((sum, cat) => sum + (cat.size || 0), 0);

    console.log();
    printInfo(
      `Selected ${binariesToThin.length} application(s) for thinning`,
    );
    printInfo(`Expected space savings: ${formatSizeWithColor(selectedSavings)}`);

    // Dry run mode
    if (options.dryRun) {
      console.log("\n[DRY RUN] Would thin the following binaries:\n");
      for (const catId of binariesToThin) {
        const cat = categories.find((c) => c.id === catId);
        if (cat) {
          console.log(`  • ${cat.name}`);
        }
      }
      console.log();
      printInfo("Run without --dry-run to actually thin the binaries.");
      return;
    }

    // Confirmation
    if (!options.force) {
      console.log();
      const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
        {
          type: "confirm",
          name: "confirmed",
          message: `Proceed with thinning ${binariesToThin.length} application(s)?`,
          default: false,
        },
      ]);

      if (!confirmed) {
        printInfo("Operation cancelled.");
        return;
      }
    }

    // Execute thinning
    console.log();
    const thinSpinner = ora("Thinning Universal Binaries...").start();

    try {
      const result = await cleaner.clearByCategory(binariesToThin, false);

      thinSpinner.stop();

      if (result.success) {
        const actualFreed = (result.sizeBefore || 0) - (result.sizeAfter || 0);

        if (actualFreed > 0) {
          console.log();
          printSuccess(
            `${symbols.sparkles} Thinning complete! Freed ${formatSizeWithColor(actualFreed)}`,
          );
          printSuccess(
            `✨ ${result.clearedPaths.length} application(s) optimized for Apple Silicon!`,
          );
        } else {
          printInfo("Thinning completed but no space was freed.");
        }

        if (result.error) {
          console.log();
          printWarning(`Some binaries could not be thinned: ${result.error}`);
          printInfo(
            "This is often due to permission issues with system applications.",
          );
          printInfo("Try running with elevated permissions for those apps.");
        }
      } else {
        printError(`Thinning failed: ${result.error}`);
      }
    } catch (error) {
      thinSpinner.fail("Thinning failed");
      throw error;
    }
  } catch (error) {
    spinner.stop();
    printError(`Universal Binary command error: ${error}`);
    throw error;
  }
}
