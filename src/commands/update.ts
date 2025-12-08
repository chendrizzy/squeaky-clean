import { config } from "../config";
import {
  printSuccess,
  printError,
  printInfo,
  printWarning,
} from "../utils/cli";
import execa from "execa";

interface UpdateOptions {
  check?: boolean;
  force?: boolean;
  enableAuto?: boolean;
  disableAuto?: boolean;
  enableAutoUpdate?: boolean;
  disableAutoUpdate?: boolean;
  autoOn?: boolean;
  autoOff?: boolean;
}

interface VersionInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

/**
 * Get the current installed version from package.json
 */
function getCurrentVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../../package.json");
    return pkg.version;
  } catch {
    return "unknown";
  }
}

/**
 * Get the latest version from npm registry
 */
async function getLatestVersion(): Promise<string> {
  try {
    const result = await execa("npm", ["view", "squeaky-clean", "version"], {
      timeout: 10000,
    });
    return result.stdout.trim();
  } catch {
    throw new Error("Failed to fetch latest version from npm registry");
  }
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

/**
 * Check for available updates
 */
export async function checkForUpdate(): Promise<VersionInfo> {
  const current = getCurrentVersion();
  const latest = await getLatestVersion();
  const updateAvailable = compareVersions(current, latest) < 0;

  return { current, latest, updateAvailable };
}

/**
 * Perform the actual update
 */
async function performUpdate(): Promise<boolean> {
  try {
    printInfo("📦 Updating squeaky-clean...");

    // Detect if installed globally
    const isGlobal = __dirname.includes("node_modules");

    const args = ["install", "squeaky-clean@latest"];
    if (isGlobal) args.splice(1, 0, "-g");

    printInfo(`Running: npm ${args.join(" ")}`);

    await execa("npm", args, {
      stdio: "inherit",
      timeout: 60000,
    });

    return true;
  } catch (error) {
    throw new Error(
      `Failed to update: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/**
 * Background update check for startup (non-blocking, time-based)
 * Only checks if enough time has passed since last check
 */
export async function backgroundUpdateCheck(): Promise<void> {
  if (!config.shouldCheckForUpdate()) return;

  try {
    const versionInfo = await checkForUpdate();
    config.setLastUpdateCheck(new Date());

    if (versionInfo.updateAvailable) {
      console.log();
      printWarning(
        `Update available: ${versionInfo.current} → ${versionInfo.latest}`,
      );
      printInfo("Run 'squeaky update' to update");
      console.log();
    }
  } catch {
    // Silently ignore errors in background check
  }
}

/**
 * Main update command
 */
export async function updateCommand(options: UpdateOptions): Promise<void> {
  const enableAutoFlag =
    options.autoOn ?? options.enableAuto ?? options.enableAutoUpdate;
  const disableAutoFlag =
    options.autoOff ?? options.disableAuto ?? options.disableAutoUpdate;

  // Handle auto-update configuration
  if (enableAutoFlag !== undefined) {
    const currentConfig = config.get();
    config.set({
      ...currentConfig,
      autoUpdate: {
        ...currentConfig.autoUpdate,
        enabled: true,
      },
    });
    printSuccess("Auto-update check enabled (will check on every run)");
    return;
  }

  if (disableAutoFlag !== undefined) {
    const currentConfig = config.get();
    config.set({
      ...currentConfig,
      autoUpdate: {
        ...currentConfig.autoUpdate,
        enabled: false,
      },
    });
    printSuccess("Auto-update check disabled");
    return;
  }

  // Check for updates
  try {
    printInfo("🔍 Checking for updates...");

    const versionInfo = await checkForUpdate();

    printInfo(`Current version: ${versionInfo.current}`);
    printInfo(`Latest version:  ${versionInfo.latest}`);

    if (!versionInfo.updateAvailable) {
      printSuccess("✨ You're already on the latest version!");
      return;
    }

    // Only check mode - just show info
    if (options.check) {
      printWarning(
        `Update available: ${versionInfo.current} → ${versionInfo.latest}`,
      );
      printInfo("Run 'squeaky update' to install the update");
      return;
    }

    // Perform the update
    printWarning(
      `Updating from ${versionInfo.current} to ${versionInfo.latest}...`,
    );

    const success = await performUpdate();

    if (success) {
      printSuccess(`✨ Successfully updated to v${versionInfo.latest}!`);
      printInfo("Please restart your terminal to use the new version.");
    }
  } catch (error) {
    printError(
      `Update failed: ${error instanceof Error ? error.message : error}`,
    );
    printInfo(
      "You can manually update with: npm install -g squeaky-clean@latest",
    );
  }
}
