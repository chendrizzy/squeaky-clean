import { AppCacheGroupAxis } from "../types";

/**
 * The grouping axes available for the app-caches breakdown. "none" is not an
 * axis - a flat list is simply an empty hierarchy.
 */
export const APP_CACHE_GROUP_AXES: AppCacheGroupAxis[] = [
  "tier",
  "kind",
  "app",
];

/**
 * Default grouping hierarchy: safety tier first (risk-forward, the right
 * default for a safety-oriented cleaner), then cache kind, then app.
 */
export const DEFAULT_GROUP_HIERARCHY: AppCacheGroupAxis[] = [
  "tier",
  "kind",
  "app",
];

export function isGroupAxis(value: string): value is AppCacheGroupAxis {
  return (APP_CACHE_GROUP_AXES as string[]).includes(value);
}

/**
 * Coerce an arbitrary value (a config array, a CLI comma-list string, a single
 * axis, or "none"/blank) into an ordered, de-duplicated axis hierarchy.
 * Unknown axes are dropped; "none" or blank yields a flat list (`[]`).
 */
export function normalizeHierarchy(value: unknown): AppCacheGroupAxis[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const out: AppCacheGroupAxis[] = [];
    for (const entry of value) {
      const s = String(entry).trim().toLowerCase();
      if (isGroupAxis(s) && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (!s || s === "none") return [];
    return normalizeHierarchy(s.split(","));
  }
  return [];
}

/**
 * Resolve the effective hierarchy from a stored config value. `undefined` falls
 * back to the default; any defined value (including `[]`) is honored after
 * normalization, so a user can explicitly choose a flat list.
 */
export function resolveStoredHierarchy(stored: unknown): AppCacheGroupAxis[] {
  if (stored === undefined || stored === null) return DEFAULT_GROUP_HIERARCHY;
  return normalizeHierarchy(stored);
}

/** Human-readable hierarchy label, e.g. "tier → kind → app" or "flat". */
export function formatHierarchy(hierarchy: AppCacheGroupAxis[]): string {
  return hierarchy.length > 0 ? hierarchy.join(" → ") : "flat (no grouping)";
}
