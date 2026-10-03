import * as path from "path";
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
  LOCK_WAIT_MS,
  UniversalBinaryCleaner,
  outcomeLine,
  recoveryLine,
} from "../cleaners/universalBinary";
import { DEFAULT_MIN_SAVINGS } from "../ub/thinner";
import { ensureAgentHome, type AgentHome } from "../ub/paths";
import { acquireLock } from "../ub/lock";
import { recoverJournal, restoreAppFromJournal } from "../ub/restore";
import { pruneBackups } from "../ub/backups";
import { config } from "../config";
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
      printInfo(
        `   Run \`squeaky ub --all\` to thin every app listed above that saves at least ${DEFAULT_MIN_SAVINGS / (1024 * 1024)} MB (never auto-ignored or protected ones)`,
      );
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
      printInfo(
        `Selected every app that is not auto-ignored${excluded.size > 0 ? ` (excluded: ${[...excluded].join(", ")})` : ""}.`,
      );
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

    // the path shown for each id, so clear() refuses an id that now names a different app (T11-R4)
    const expectedPaths = Object.fromEntries(
      categories
        .filter((cat) => binariesToThin.includes(cat.id))
        .map((cat) => [cat.id, cat.paths[0]]),
    );
    const selection = { categories: binariesToThin, tickedIds, expectedPaths };
    const protectedPaths = config.getProtectedPaths();

    // The cleaner's own decision on the last scan, so totals count only what the run will thin
    const plan = await cleaner.preview(selection, protectedPaths);
    const willThin = plan.filter((o) => o.reason === "dry-run");
    const willSkip = plan.filter((o) => o.reason !== "dry-run");
    const expectedSavings = willThin.reduce((sum, o) => sum + o.heldBytes, 0);

    console.log();
    printInfo(
      `Will thin ${willThin.length} of ${binariesToThin.length} selected application(s)`,
    );
    printInfo(`Expected space savings: ${formatSizeWithColor(expectedSavings)}`);
    if (willSkip.length > 0) {
      console.log("\nWill skip:\n");
      for (const o of willSkip) console.log(`  ${outcomeLine(o)}`);
    }

    // Dry run mode
    if (options.dryRun) {
      console.log("\n[DRY RUN] Would thin the following applications:\n");
      for (const o of willThin) {
        console.log(
          `  • ${path.basename(o.app, ".app")} (${formatSizeWithColor(o.heldBytes)})`,
        );
      }
      if (willThin.length === 0) console.log("  (none)");
      console.log();
      printInfo("Run without --dry-run to actually thin the binaries.");
      return;
    }

    if (willThin.length === 0) {
      printInfo("Nothing to thin.");
      return;
    }

    // Confirmation
    if (!options.force) {
      console.log();
      const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
        {
          type: "confirm",
          name: "confirmed",
          message: `Proceed with thinning ${willThin.length} application(s)?`,
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

    let result: ClearResult;
    try {
      // the full selection, not just willThin: clear() re-checks it against a fresh scan and reports every skip
      result = await cleaner.clear(false, selection, undefined, protectedPaths);
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

/** Runs fn under the agent lock (the same wait as a thinning run). A busy lock is an error: nothing is touched. */
async function withAgentLock<T>(fn: (home: AgentHome, runId: string) => Promise<T>): Promise<T> {
  const home = await ensureAgentHome();
  const lock = await acquireLock(home, { waitMs: LOCK_WAIT_MS });
  if (!lock) throw new Error("agent busy: another squeaky ub run holds the lock");
  try {
    return await fn(home, lock.runId);
  } finally {
    await lock.release();
  }
}

/** `squeaky ub restore <app>`: put back the originals recorded by the app's last thin. Throws unless restored or nothing to do. */
export async function ubRestoreCommand(app: string): Promise<void> {
  const name = path.basename(app, ".app");
  const { status, notes } = await withAgentLock(async (home, runId) => {
    // an interrupted run is finished by its own journal entry first (it may be this very app)
    for (const r of await recoverJournal(home, runId)) {
      if (r.result === "restore-failed" || r.result === "unreachable") printError(recoveryLine(r));
      else printInfo(recoveryLine(r));
    }
    return restoreAppFromJournal(home, app);
  });
  if (status === "restored") printSuccess(`Restored ${name} from its backup (signature verified)`);
  else if (status === "nothing-to-do") printInfo(`${name}: nothing to restore`);
  for (const n of notes) printWarning(`  ${n}`);
  if (status !== "restored" && status !== "nothing-to-do") throw new Error(`${name} was not restored: ${status}`);
}

/** `squeaky ub prune [<app>|--all]`: release backups early. Neither or both is an error that removes nothing. */
export async function ubPruneCommand(app: string | undefined, opts: { all?: boolean }): Promise<void> {
  if ((app === undefined) === !opts.all) throw new Error("give an app path or --all (not both)");
  const r = await withAgentLock((home) => pruneBackups(home, app));
  const what = app === undefined ? "all apps" : path.basename(app, ".app");
  if (r.removedDirs.length === 0 && r.heldDirs.length === 0) printInfo(`No backups found for ${what}.`);
  else printSuccess(`Removed ${r.removedDirs.length} backup(s) for ${what}, freed ${formatSizeWithColor(r.freedBytes)}`);
  for (const d of r.heldDirs) printWarning(`  kept ${d}: an unfinished thin or restore still needs it`);
  if (r.heldDirs.length > 0) throw new Error(`${r.heldDirs.length} backup(s) kept; run \`squeaky ub restore <app>\` to finish the interrupted run first`);
}
