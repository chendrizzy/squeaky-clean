import { CacheCategory, SafetyTier } from "../types";

/**
 * Safety tiers ordered from least to most restricted. Used to compare and
 * filter categories against a cleaning profile.
 */
export const SAFETY_TIER_ORDER: SafetyTier[] = [
  "safe",
  "probably-safe",
  "caution",
  "manual",
];

export function isSafetyTier(value: string): value is SafetyTier {
  return (SAFETY_TIER_ORDER as string[]).includes(value);
}

/**
 * Display metadata per tier. Colors reference chalk method names so UI code
 * can apply them without this module depending on chalk.
 */
export const SAFETY_TIER_INFO: Record<
  SafetyTier,
  { label: string; color: "green" | "cyan" | "yellow" | "red"; summary: string }
> = {
  safe: {
    label: "SAFE",
    color: "green",
    summary: "Regenerated transparently; no observable downside to cleaning",
  },
  "probably-safe": {
    label: "PROBABLY SAFE",
    color: "cyan",
    summary: "Regenerable; apps may start slower or re-download data once",
  },
  caution: {
    label: "CAUTION",
    color: "yellow",
    summary:
      "May lose useful state (offline content, large re-downloads) or upset running apps",
  },
  manual: {
    label: "MANUAL",
    color: "red",
    summary:
      "User-data adjacent; requires explicit per-item confirmation, never cleaned implicitly",
  },
};

/**
 * Effective safety tier for a category. Categories that predate the safety
 * field derive a tier from their priority: critical (active in the last day)
 * maps to caution, low (untouched for 30+ days) maps to safe, everything
 * else is probably-safe. "manual" is never derived - cleaners must opt in
 * explicitly.
 */
export function effectiveSafety(category: CacheCategory): SafetyTier {
  if (category.safety) return category.safety;

  switch (category.priority) {
    case "critical":
      return "caution";
    case "low":
      return "safe";
    default:
      return "probably-safe";
  }
}

/**
 * Cleaning profiles: named presets mapping to the set of tiers cleaned
 * without per-item confirmation. The "manual" tier is intentionally part of
 * no profile - manual categories always need explicit consent.
 */
export type CleaningProfileName = "conservative" | "balanced" | "aggressive";

export const CLEANING_PROFILES: Record<
  CleaningProfileName,
  { tiers: SafetyTier[]; description: string }
> = {
  conservative: {
    tiers: ["safe"],
    description: "Only caches that are definitely safe to clean",
  },
  balanced: {
    tiers: ["safe", "probably-safe"],
    description:
      "Safe caches plus regenerable ones that may cost a slower next launch (default)",
  },
  aggressive: {
    tiers: ["safe", "probably-safe", "caution"],
    description:
      "Everything except manual-confirmation items; includes caches with re-download or running-app risks",
  },
};

export const DEFAULT_PROFILE: CleaningProfileName = "balanced";

export function isCleaningProfileName(
  value: string,
): value is CleaningProfileName {
  return value in CLEANING_PROFILES;
}

/**
 * Resolve the allowed tiers for a profile name; unknown names fall back to
 * the default profile.
 */
export function tiersForProfile(profile?: string): SafetyTier[] {
  if (profile && isCleaningProfileName(profile)) {
    return CLEANING_PROFILES[profile].tiers;
  }
  return CLEANING_PROFILES[DEFAULT_PROFILE].tiers;
}

/**
 * Parse a user-supplied comma-separated tier list (e.g. "safe,caution").
 * Returns null when any entry is invalid so callers can report it.
 */
export function parseSafetyTiers(input: string): SafetyTier[] | null {
  const parts = input
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const tiers: SafetyTier[] = [];
  for (const part of parts) {
    if (!isSafetyTier(part)) return null;
    if (!tiers.includes(part)) tiers.push(part);
  }
  return tiers;
}
