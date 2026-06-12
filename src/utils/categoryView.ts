import pc from "picocolors";
import {
  AppCacheGroupAxis,
  AppCacheGroupBy,
  CacheCategory,
  CategoryBreakdownEntry,
  SafetyTier,
} from "../types";
import {
  SAFETY_TIER_INFO,
  SAFETY_TIER_ORDER,
  effectiveSafety,
} from "../safety";
import { formatSize } from "./cli";
import { normalizeHierarchy } from "./groupHierarchy";

/**
 * Minimal view shape shared by full CacheCategory objects (the `categories`
 * command) and the lighter CategoryBreakdownEntry rows carried on a
 * ClearResult (the `clean` command). Both render through one code path so the
 * two surfaces can never drift apart.
 */
export interface CategoryViewItem {
  id: string;
  name: string;
  size: number;
  safety: SafetyTier;
  appKey?: string;
  ageInDays?: number;
}

export interface CategoryViewOptions {
  /** A single axis, "none", or an ordered hierarchy (e.g. ["tier","kind","app"]). */
  groupBy: AppCacheGroupBy | AppCacheGroupAxis[];
  useColor: boolean;
  emojiMode: "on" | "off" | "minimal";
  /** Leading indent applied to every emitted line. */
  indent?: string;
  /** Print each category's id on a dim sub-line (for `categories`, so ids can
   * be copied into --categories / --allow-manual). */
  showId?: boolean;
}

/** Resolve a full CacheCategory to the minimal view shape (resolving tier). */
export function categoryToViewItem(category: CacheCategory): CategoryViewItem {
  return {
    id: category.id,
    name: category.name,
    size: category.size ?? 0,
    safety: effectiveSafety(category),
    appKey: category.appKey,
    ageInDays: category.ageInDays,
  };
}

/** Breakdown rows already carry a resolved tier; pass through. */
export function breakdownToViewItem(
  entry: CategoryBreakdownEntry,
): CategoryViewItem {
  return {
    id: entry.id,
    name: entry.name,
    size: entry.size,
    safety: entry.safety,
    appKey: entry.appKey,
    ageInDays: entry.ageInDays,
  };
}

function colorFor(color: string, text: string, useColor: boolean): string {
  if (!useColor) return text;
  const fn = (pc as unknown as Record<string, (t: string) => string>)[color];
  return typeof fn === "function" ? fn(text) : text;
}

/** Colored, text-labelled tier badge e.g. [SAFE] / [MANUAL]. The text label is
 * the primary signal so the badge still reads under --no-color / screen
 * readers; color is only a secondary cue. */
export function tierBadge(tier: SafetyTier, useColor: boolean): string {
  const info = SAFETY_TIER_INFO[tier];
  return colorFor(info.color, `[${info.label}]`, useColor);
}

/** "app-caches:library-caches/com.spotify.client" -> "library-caches" */
function kindOf(id: string): string {
  const body = id.startsWith("app-caches:")
    ? id.slice("app-caches:".length)
    : id;
  return body.split("/")[0] || body;
}

export interface CategoryGroup {
  key: string;
  label: string;
  tier?: SafetyTier;
  items: CategoryViewItem[];
  total: number;
}

const KIND_EMOJI: Record<string, string> = {
  "library-caches": "📚",
  containers: "📦",
  "group-containers": "📦",
  "app-support-caches": "🗂️",
  "app-support": "🗂️",
  "dot-cache": "📁",
  "xdg-cache": "📁",
  "xdg-config": "📁",
  flatpak: "📦",
  snap: "📦",
  logs: "📝",
  "local-appdata": "📁",
  appdata: "📁",
};

function axisBucketKey(
  item: CategoryViewItem,
  axis: AppCacheGroupAxis,
): string {
  switch (axis) {
    case "tier":
      return item.safety;
    case "kind":
      return kindOf(item.id);
    case "app":
    default:
      return item.appKey || item.name || item.id;
  }
}

/**
 * Group items by a single axis. Items within a group are sorted largest-first;
 * tier groups order by safety severity (so the riskiest surface up front),
 * every other axis orders groups largest-first.
 */
export function groupByAxis(
  items: CategoryViewItem[],
  axis: AppCacheGroupAxis,
): CategoryGroup[] {
  const buckets = new Map<string, CategoryViewItem[]>();
  for (const item of items) {
    const key = axisBucketKey(item, axis);
    const arr = buckets.get(key);
    if (arr) arr.push(item);
    else buckets.set(key, [item]);
  }

  const groups: CategoryGroup[] = [];
  for (const [key, groupItems] of buckets) {
    const sorted = groupItems
      .slice()
      .sort((a, b) => (b.size || 0) - (a.size || 0));
    const total = sorted.reduce((sum, i) => sum + (i.size || 0), 0);
    const tier = axis === "tier" ? (key as SafetyTier) : undefined;
    const label =
      axis === "tier" ? SAFETY_TIER_INFO[key as SafetyTier].label : key;
    groups.push({ key, label, tier, items: sorted, total });
  }

  if (axis === "tier") {
    groups.sort(
      (a, b) =>
        SAFETY_TIER_ORDER.indexOf(a.key as SafetyTier) -
        SAFETY_TIER_ORDER.indexOf(b.key as SafetyTier),
    );
  } else {
    groups.sort((a, b) => b.total - a.total);
  }
  return groups;
}

/**
 * Single-level grouping by a single axis (or "none" = one flat bucket sorted by
 * size). Kept for callers/tests that group on one axis; multi-level nesting is
 * handled by renderCategoryTree.
 */
export function groupCategories(
  items: CategoryViewItem[],
  groupBy: AppCacheGroupBy,
): CategoryGroup[] {
  if (groupBy === "none") {
    const sorted = items.slice().sort((a, b) => (b.size || 0) - (a.size || 0));
    if (sorted.length === 0) return [];
    const total = sorted.reduce((sum, i) => sum + (i.size || 0), 0);
    return [{ key: "", label: "", items: sorted, total }];
  }
  return groupByAxis(items, groupBy);
}

function renderLevel(
  items: CategoryViewItem[],
  axes: AppCacheGroupAxis[],
  options: CategoryViewOptions,
  depth: number,
  tierInHierarchy: boolean,
): string[] {
  const { useColor, emojiMode } = options;
  const indent = (options.indent ?? "") + "  ".repeat(depth);
  const lines: string[] = [];
  if (items.length === 0) return lines;

  // Leaves: list the individual caches, largest first.
  if (axes.length === 0) {
    const sorted = items.slice().sort((a, b) => (b.size || 0) - (a.size || 0));
    for (const item of sorted) {
      const sizeStr = colorFor("cyan", formatSize(item.size), useColor);
      // Show the tier badge on leaves only when tier is NOT one of the header
      // levels; otherwise the tier is already visible up the tree.
      const badge = tierInHierarchy
        ? ""
        : `${tierBadge(item.safety, useColor)} `;
      const age =
        item.ageInDays !== undefined
          ? colorFor("gray", ` (${item.ageInDays}d)`, useColor)
          : "";
      lines.push(`${indent}${badge}${item.name} ${sizeStr}${age}`);
      if (options.showId) {
        lines.push(`${indent}  ${colorFor("gray", item.id, useColor)}`);
      }
    }
    return lines;
  }

  const axis = axes[0];
  const showEmoji = emojiMode === "on";
  for (const group of groupByAxis(items, axis)) {
    const sizeStr = colorFor("cyan", formatSize(group.total), useColor);
    const count = colorFor("gray", `(${group.items.length})`, useColor);
    let header: string;
    if (axis === "tier" && group.tier) {
      header = `${tierBadge(group.tier, useColor)} ${sizeStr} ${count}`;
    } else if (axis === "kind") {
      const emoji = showEmoji ? `${KIND_EMOJI[group.key] ?? "📁"} ` : "";
      header = `${emoji}${colorFor("bold", group.label, useColor)} ${sizeStr} ${count}`;
    } else {
      // "app" grouping: the app identity is the heading.
      header = `${colorFor("bold", group.label, useColor)} ${sizeStr} ${count}`;
    }
    lines.push(`${indent}${header}`);
    lines.push(
      ...renderLevel(
        group.items,
        axes.slice(1),
        options,
        depth + 1,
        tierInHierarchy,
      ),
    );
  }
  return lines;
}

/**
 * Render a grouped, indented tree of categories as lines of text. Pure: returns
 * strings instead of printing, so clean, categories, and tests all share one
 * renderer. `groupBy` may be a single axis, "none", or an ordered hierarchy
 * (e.g. ["tier","kind","app"]) which nests each level. Emoji gated on
 * emojiMode; color on useColor.
 */
export function renderCategoryTree(
  items: CategoryViewItem[],
  options: CategoryViewOptions,
): string[] {
  const hierarchy = normalizeHierarchy(options.groupBy);
  const tierInHierarchy = hierarchy.includes("tier");
  return renderLevel(items, hierarchy, options, 0, tierInHierarchy);
}

/**
 * One-line collapsed summary of an app-cache breakdown: total, cache count,
 * app count, and the largest topN apps inline (sizes are already computed, so
 * this is free). Used as the default `clean` line so the breakdown is
 * discoverable without expanding it.
 */
export function summarizeAppCaches(
  items: CategoryViewItem[],
  options: {
    topN: number;
    useColor: boolean;
    verboseHint?: boolean;
    action?: string;
  },
): string {
  const { topN, useColor } = options;
  const total = items.reduce((sum, i) => sum + (i.size || 0), 0);

  const byApp = new Map<string, number>();
  for (const item of items) {
    const key = item.appKey || item.name || item.id;
    byApp.set(key, (byApp.get(key) || 0) + (item.size || 0));
  }
  const apps = [...byApp.entries()].sort((a, b) => b[1] - a[1]);

  const totalStr = colorFor("bold", formatSize(total), useColor);
  const head = options.action ? `${totalStr} ${options.action}` : totalStr;
  const caches = `${items.length} cache${items.length === 1 ? "" : "s"}`;
  const appWord = `${apps.length} app${apps.length === 1 ? "" : "s"}`;
  const parts = [head, caches, appWord];

  if (topN > 0 && apps.length > 0) {
    const top = apps
      .slice(0, topN)
      .map(([name, size]) => `${name} ${formatSize(size)}`)
      .join(", ");
    const more = apps.length > topN ? ", …" : "";
    parts.push(`top: ${top}${more}`);
  }

  const hint =
    options.verboseHint === false
      ? ""
      : colorFor("gray", " (-v for all)", useColor);
  return parts.join(" · ") + hint;
}
