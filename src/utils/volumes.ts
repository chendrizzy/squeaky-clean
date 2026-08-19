import { promises as fs } from "fs";
import path from "path";
import { ClearResult } from "../types";
import { getCachedDirectorySize } from "./fs";

/**
 * Physical-volume label for an already-resolved (realpath'd) absolute path.
 * macOS mounts secondary volumes under /Volumes/<name>; everything else
 * belongs to the boot volume, reported as "/". On Windows the drive letter
 * is the volume.
 */
export function volumeOf(resolvedPath: string): string {
  const drive = /^([A-Za-z]:)[\\/]/.exec(resolvedPath);
  if (drive) return drive[1].toUpperCase() + "\\";
  const mount = /^\/Volumes\/([^/]+)/.exec(resolvedPath);
  return mount ? `/Volumes/${mount[1]}` : "/";
}

export type VolumeResolver = (p: string) => Promise<string>;

/**
 * Resolve which physical volume a cleaned path lives on. The path may
 * already be deleted (clean just ran), so walk up to the nearest existing
 * ancestor - every level of one tree sits on the same volume, and the
 * ancestor's realpath still crosses any symlink (e.g. ~/.cache ->
 * /Volumes/BOLT/...) that made the tree external.
 */
export async function resolveVolume(p: string): Promise<string> {
  let candidate = path.resolve(p);
  for (;;) {
    try {
      return volumeOf(await fs.realpath(candidate));
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return volumeOf(candidate);
      candidate = parent;
    }
  }
}

export interface VolumeEntry {
  paths: string[];
  size: number;
}

/**
 * Bucket for freed bytes that cannot be tied to a filesystem path - some
 * custom cleaners report human-readable labels in clearedPaths ("Docker
 * system"), or none at all. Kept visible so the per-volume rows always sum
 * to the printed total instead of silently dropping bytes or attributing
 * them to whatever volume the CLI happened to run from.
 */
export const UNATTRIBUTABLE = "unknown";

/**
 * Group freed bytes by physical volume. Each entry (one cache category, or
 * one whole ClearResult as fallback) attributes its size to its paths'
 * volumes.
 */
// ponytail: an entry spanning multiple paths splits its size evenly across
// them - exact attribution would need per-path sizing. Entries are per cache
// category, which is almost always a single directory; switch to
// size-weighted shares if that stops holding.
export async function computeVolumeBreakdown(
  entries: VolumeEntry[],
  resolve: VolumeResolver = resolveVolume,
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.size <= 0 || entry.paths.length === 0) continue;
    const share = entry.size / entry.paths.length;
    for (const entryPath of entry.paths) {
      const volume = await resolve(entryPath);
      totals[volume] = (totals[volume] || 0) + share;
    }
  }
  for (const volume of Object.keys(totals)) {
    totals[volume] = Math.round(totals[volume]);
  }
  return totals;
}

/**
 * Sum per-volume freed bytes across clean results for display. Results that
 * carry their own volumeBreakdown (BaseCleaner-driven cleaners; per-category
 * accurate) are used as-is; custom clear() implementations without one are
 * attributed from their cleared paths.
 */
export async function aggregateVolumeBreakdown(
  results: Array<
    Pick<
      ClearResult,
      | "success"
      | "sizeBefore"
      | "sizeAfter"
      | "clearedPaths"
      | "volumeBreakdown"
    >
  >,
  dryRun: boolean,
  resolve: VolumeResolver = resolveVolume,
  sizeOf: (p: string) => Promise<number> = getCachedDirectorySize,
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const result of results) {
    if (!result.success) continue;
    const freed = dryRun
      ? result.sizeBefore || 0
      : (result.sizeBefore || 0) - (result.sizeAfter || 0);
    if (freed <= 0) continue;

    let breakdown = result.volumeBreakdown;
    if (!breakdown || Object.keys(breakdown).length === 0) {
      breakdown = await attributeFreedAcrossPaths(
        result.clearedPaths ?? [],
        freed,
        resolve,
        sizeOf,
      );
    }
    for (const [volume, bytes] of Object.entries(breakdown)) {
      totals[volume] = (totals[volume] || 0) + bytes;
    }
  }
  return totals;
}

/**
 * Attribute one result's freed bytes across its cleared paths. Paths are
 * weighted by their cached sizes - the scan sized them moments before the
 * clean, so this is a cache hit, not a rescan - which keeps a cleaner whose
 * paths straddle volumes (e.g. a symlinked store plus a local cache dir)
 * honest about where the bytes actually were.
 */
async function attributeFreedAcrossPaths(
  paths: string[],
  freed: number,
  resolve: VolumeResolver,
  sizeOf: (p: string) => Promise<number>,
): Promise<Record<string, number>> {
  // Only absolute filesystem paths can be volume-resolved; anything else in
  // clearedPaths is a display label (docker reports "Build cache" etc.),
  // which path.resolve would otherwise turn into a phantom path under cwd.
  const realPaths = paths.filter((p) => path.isAbsolute(p));
  if (realPaths.length === 0) {
    return { [UNATTRIBUTABLE]: freed };
  }
  if (realPaths.length > 1) {
    const weights = await Promise.all(realPaths.map((p) => sizeOf(p)));
    const totalWeight = weights.reduce((sum, w) => sum + (w || 0), 0);
    if (totalWeight > 0) {
      return computeVolumeBreakdown(
        realPaths.map((p, i) => ({
          paths: [p],
          size: (freed * (weights[i] || 0)) / totalWeight,
        })),
        resolve,
      );
    }
    // No size data (cold cache after a long real clean): fall through to the
    // even split below rather than dropping the bytes.
  }
  return computeVolumeBreakdown([{ paths: realPaths, size: freed }], resolve);
}

/**
 * Volume breakdown for a custom clear() implementation, built from the paths
 * it is about to delete. Call BEFORE deleting or invalidating size caches:
 * the per-path sizes are then warm cache hits from the scan that just ran,
 * and the paths still exist for realpath resolution.
 */
export async function volumeBreakdownForPaths(
  paths: string[],
  resolve: VolumeResolver = resolveVolume,
  sizeOf: (p: string) => Promise<number> = getCachedDirectorySize,
): Promise<Record<string, number>> {
  const entries: VolumeEntry[] = [];
  for (const entryPath of paths.filter((p) => path.isAbsolute(p))) {
    entries.push({ paths: [entryPath], size: await sizeOf(entryPath) });
  }
  return computeVolumeBreakdown(entries, resolve);
}

/** Human label: keep mount paths as-is, name the boot volume explicitly. */
export function volumeLabel(volume: string): string {
  if (volume === "/") return "/ (internal)";
  if (volume === UNATTRIBUTABLE) return "(unattributable)";
  return volume;
}
