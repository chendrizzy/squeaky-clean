import {
  printInfo,
  printSuccess,
  printError,
  printWarning,
  formatSizeWithColor,
  symbols,
} from "../utils/cli";
import {
  DEFAULT_KEEP_BACKUP_DAYS,
  UniversalBinaryCleaner,
  outcomeLine,
  recoveryLine,
} from "../cleaners/universalBinary";
import type { ClearResult } from "../types";
import ora from "ora";
import inquirer from "inquirer";

// the formatter lives with the cleaner so its signal-exit report prints the same lines
export { outcomeLine };

interface UBOptions {
  all?: boolean;
  exclude?: string;
  dryRun?: boolean;
  list?: boolean;
  verbose?: boolean;
  force?: boolean;
}

/** Recovery of interrupted earlier runs and housekeeping notes (e.g. a failed prune), under their own heading. */
function printHousekeeping(cleaner: UniversalBinaryCleaner): void {
  if (cleaner.lastRecovery.length === 0 && cleaner.lastNotes.length === 0) return;
  console.log("\nRecovery and housekeeping:");
  for (const r of cleaner.lastRecovery) {
    if (r.result === "restore-failed" || r.result === "unreachable") printError(recoveryLine(r));
    else printInfo(recoveryLine(r));
  }
  for (const n of cleaner.lastNotes) printWarning(n);
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

    const categories = cacheInfo.categories || [];
    if (!cacheInfo.isInstalled || categories.length === 0) {
      printInfo("No Universal Binaries found that can be thinned.");
      printSuccess(
        "Your applications are already optimized for Apple Silicon!",
      );
      return;
    }

    // Auto-ignored classes (Mac App Store, Apple, Chrome, ...) are never thinned by default (spec §6.2 row 5)
    const ignoredClass = (id: string) => cleaner.autoIgnoredClass(id);
    const thinnable = categories.filter((c) => !ignoredClass(c.id));
    const skippedByDefault = categories.filter((c) => ignoredClass(c.id));
    const totalSavings = cacheInfo.size || 0;
    const printSkippedByDefault = () => {
      if (skippedByDefault.length === 0) return;
      console.log("\nSkipped by default:\n");
      for (const cat of skippedByDefault) {
        console.log(
          `  • ${cat.name} — auto-ignored: ${ignoredClass(cat.id)} (${formatSizeWithColor(cat.size || 0)})`,
        );
      }
    };

    // List mode - just show what's available
    if (options.list) {
      console.log("\n📋 Universal Binaries found:\n");

      for (const cat of thinnable) {
        console.log(`  ${symbols.binary} ${cat.name}  [${cat.id}]`);
        console.log(`     ${cat.paths[0]}`);
        console.log(`     Potential savings: ${formatSizeWithColor(cat.size || 0)}`);
        console.log();
      }
      printSkippedByDefault();
      console.log();

      printInfo(
        `Total potential savings: ${formatSizeWithColor(totalSavings)}`,
      );
      console.log();
      printInfo("💡 Run `squeaky ub` to interactively select binaries to thin");
      printInfo("   Run `squeaky ub --all` to thin all Universal Binaries");
      return;
    }

    // Display found binaries
    console.log(
      `\n${symbols.sparkles} Found ${thinnable.length} Universal Binaries:\n`,
    );

    for (const cat of thinnable) {
      const sizeStr = formatSizeWithColor(cat.size || 0);
      console.log(`  • ${cat.name} - ${sizeStr} potential savings`);
    }
    printSkippedByDefault();

    console.log();
    printInfo(`Total potential savings: ${formatSizeWithColor(totalSavings)}`);

    // Determine which binaries to thin
    let binariesToThin: string[] = [];
    // only an interactive tick beats the auto-ignore class and the per-app floor (spec §6.2); --all does not
    let tickedIds: string[] | undefined;

    if (options.all) {
      // Thin all apps that are not auto-ignored, minus any --exclude'd category ids
      const excluded = new Set(
        (options.exclude ?? "")
          .split(",")
          .map((id) => id.trim().toLowerCase())
          .filter(Boolean),
      );
      binariesToThin = thinnable
        .map((cat) => cat.id)
        .filter((id) => !excluded.has(id.toLowerCase()));
      if (excluded.size > 0) {
        printInfo(
          `All Universal Binaries selected for thinning (excluded: ${[...excluded].join(", ")}).`,
        );
      } else {
        printInfo("All Universal Binaries selected for thinning.");
      }
    } else {
      // Interactive selection: an explicit tick may include an auto-ignored app (spec §6.2)
      console.log();
      printWarning(
        "Thinning removes x86_64 code from application binaries.",
      );
      printWarning(
        `   Originals are kept as backups for ${DEFAULT_KEEP_BACKUP_DAYS} days; an app that fails signature verification is rolled back.`,
      );
      console.log();

      const choices = categories.map((cat) => ({
        name: `${cat.name} (${formatSizeWithColor(cat.size || 0)} savings)${ignoredClass(cat.id) ? ` [auto-ignored: ${ignoredClass(cat.id)}]` : ""}`,
        value: cat.id,
        checked: false,
      }));

      try {
        const answers = await inquirer.prompt<{ binaries: string[] }>([
          {
            type: "checkbox",
            name: "binaries",
            message:
              "Select applications to thin (space to select, enter to confirm):",
            choices,
          },
        ]);
        binariesToThin = answers.binaries;
        tickedIds = answers.binaries;
      } catch {
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
    printInfo(`Selected ${binariesToThin.length} application(s) for thinning`);
    printInfo(
      `Expected space savings: ${formatSizeWithColor(selectedSavings)}`,
    );

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

    // the path shown for each id, so clear() refuses an id that now names a different app (T11-R4)
    const expectedPaths = Object.fromEntries(
      categories
        .filter((cat) => binariesToThin.includes(cat.id))
        .map((cat) => [cat.id, cat.paths[0]]),
    );
    let result: ClearResult;
    try {
      result = await cleaner.clear(false, {
        categories: binariesToThin,
        tickedIds,
        expectedPaths,
      });
      thinSpinner.stop();
    } catch (error) {
      thinSpinner.fail("Thinning failed");
      throw error;
    } finally {
      // interrupted earlier runs, recovered under the lock before this one started: shown even if thinning threw
      printHousekeeping(cleaner);
    }

    if (!result.success && cleaner.lastOutcomes.length === 0) {
      printError(`Thinning failed: ${result.error ?? "unknown error"}`);
      return;
    }

    console.log();
    for (const o of cleaner.lastOutcomes) console.log(`  ${outcomeLine(o)}`);
    console.log();
    printSuccess(
      `Held in backups: ${formatSizeWithColor(result.heldBytes || 0)} (freed automatically after ${DEFAULT_KEEP_BACKUP_DAYS} days)`,
    );
    if (!result.success) {
      printWarning("Some applications need attention (see above).");
    }
  } catch (error) {
    spinner.stop();
    printError(`Universal Binary command error: ${error}`);
    throw error;
  }
}
