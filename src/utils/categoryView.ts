import pc from "picocolors";
import {
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
  groupBy: AppCacheGroupBy;
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

function bucketKey(item: CategoryViewItem, groupBy: AppCacheGroupBy): string {
  switch (groupBy) {
    case "app":
      return item.appKey || item.name || item.id;
    case "tier":
      return item.safety;
    case "kind":
      return kindOf(item.id);
    case "none":
    default:
      return "";
  }
}

export interface CategoryGroup {
  key: string;
  label: string;
  tier?: SafetyTier;
  items: CategoryViewItem[];
  total: number;
}

/**
 * Group view items for display. Items within a group are sorted largest-first;
 * groups are sorted largest-first too, except "tier" which orders groups by
 * safety severity so the riskiest caches surface up front.
 */
export function groupCategories(
  items: CategoryViewItem[],
  groupBy: AppCacheGroupBy,
): CategoryGroup[] {
  const buckets = new Map<string, CategoryViewItem[]>();
  for (const item of items) {
    const key = bucketKey(item, groupBy);
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
    const tier = groupBy === "tier" ? (key as SafetyTier) : undefined;
    const label =
      groupBy === "tier" ? SAFETY_TIER_INFO[key as SafetyTier].label : key;
    groups.push({ key, label, tier, items: sorted, total });
  }

  if (groupBy === "tier") {
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

/**
 * Render a grouped, indented tree of categories as lines of text. Pure: returns
 * strings instead of printing, so clean, categories, and tests all share one
 * renderer. Emoji gated on emojiMode; color on useColor.
 */
export function renderCategoryTree(
  items: CategoryViewItem[],
  options: CategoryViewOptions,
): string[] {
  const { groupBy, useColor, emojiMode } = options;
  const indent = options.indent ?? "";
  const showEmoji = emojiMode === "on";
  const lines: string[] = [];
  if (items.length === 0) return lines;

  const groups = groupCategories(items, groupBy);
  const flat = groupBy === "none";

  for (const group of groups) {
    if (!flat) {
      const sizeStr = colorFor("cyan", formatSize(group.total), useColor);
      const count = colorFor("gray", `(${group.items.length})`, useColor);
      let header: string;
      if (groupBy === "tier" && group.tier) {
        header = `${tierBadge(group.tier, useColor)} ${sizeStr} ${count}`;
      } else if (groupBy === "kind") {
        const emoji = showEmoji ? `${KIND_EMOJI[group.key] ?? "📁"} ` : "";
        header = `${emoji}${colorFor("bold", group.label, useColor)} ${sizeStr} ${count}`;
      } else {
        // "app" grouping: the app identity is the heading.
        header = `${colorFor("bold", group.label, useColor)} ${sizeStr} ${count}`;
      }
      lines.push(`${indent}${header}`);
    }

    const itemIndent = flat ? indent : `${indent}  `;
    for (const item of group.items) {
      const sizeStr = colorFor("cyan", formatSize(item.size), useColor);
      // Under tier grouping the tier is already the header, so don't repeat the
      // badge on every row; under other groupings the per-row badge is the only
      // place tier is shown.
      const badge =
        groupBy === "tier" ? "" : `${tierBadge(item.safety, useColor)} `;
      const age =
        item.ageInDays !== undefined
          ? colorFor("gray", ` (${item.ageInDays}d)`, useColor)
          : "";
      lines.push(`${itemIndent}${badge}${item.name} ${sizeStr}${age}`);
      if (options.showId) {
        lines.push(`${itemIndent}  ${colorFor("gray", item.id, useColor)}`);
      }
    }
  }
  return lines;
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
