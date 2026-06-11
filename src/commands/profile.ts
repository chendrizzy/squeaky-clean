import pc from "picocolors";
import { config } from "../config";
import {
  CLEANING_PROFILES,
  CleaningProfileName,
  DEFAULT_PROFILE,
  SAFETY_TIER_INFO,
  isCleaningProfileName,
} from "../safety";
import { printHeader, printError, printInfo, printSuccess } from "../utils/cli";

type ColorFn = (text: string) => string;

function tierColor(color: string): ColorFn {
  return (
    (pc as unknown as Record<string, ColorFn>)[color] ??
    ((text: string) => text)
  );
}

function formatTierSet(tiers: readonly string[]): string {
  return tiers
    .map((tier) => {
      const info = SAFETY_TIER_INFO[tier as keyof typeof SAFETY_TIER_INFO];
      return info ? tierColor(info.color)(info.label) : tier;
    })
    .join(", ");
}

function resolveActiveProfile(): {
  name: CleaningProfileName;
  fromConfig: boolean;
} {
  const active = config.getActiveProfile();
  if (active && isCleaningProfileName(active)) {
    return { name: active, fromConfig: true };
  }
  return { name: DEFAULT_PROFILE, fromConfig: false };
}

/**
 * `squeaky profile` - print the active cleaning profile plus the available
 * profiles with their tier sets and descriptions.
 * `squeaky profile <name>` - validate and persist the active profile.
 */
export async function profileCommand(name?: string): Promise<void> {
  if (name !== undefined) {
    const normalized = name.trim().toLowerCase();
    if (!isCleaningProfileName(normalized)) {
      printError(
        `Unknown profile "${name}". Valid profiles: ${Object.keys(CLEANING_PROFILES).join(", ")}`,
      );
      process.exitCode = 1;
      return;
    }

    config.setActiveProfile(normalized);
    printSuccess(
      `Active cleaning profile set to "${normalized}" (cleans: ${CLEANING_PROFILES[normalized].tiers.join(", ")})`,
    );
    return;
  }

  printHeader("Cleaning Profile");

  const active = resolveActiveProfile();
  printInfo(
    `Active profile: ${pc.bold(active.name)}${active.fromConfig ? "" : " (default)"}`,
  );

  console.log(pc.bold("\nAvailable profiles:"));
  for (const [profileName, profile] of Object.entries(CLEANING_PROFILES)) {
    const marker = profileName === active.name ? pc.green("●") : pc.gray("○");
    console.log(`\n  ${marker} ${pc.bold(profileName)}`);
    console.log(`      Cleans: ${formatTierSet(profile.tiers)}`);
    console.log(`      ${pc.gray(profile.description)}`);
  }

  console.log();
  printInfo("Set a profile with: squeaky profile <name>");
  printInfo(
    "Override per run with: squeaky clean --profile <name> or --safety <tiers>",
  );
}
