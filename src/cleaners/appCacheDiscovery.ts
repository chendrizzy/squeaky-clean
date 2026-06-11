import { BaseCleaner } from "./BaseCleaner";
import { CacheCategory, CacheInfo, CacheType } from "../types";
import { promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";
import { printVerbose } from "../utils/cli";
import { getCachedDirectorySize, pathExists } from "../utils/fs";
import { classifyCachePath, getDiscoveryRoots } from "../safety/rules";

interface Candidate {
  /** Absolute directory path of the cache candidate. */
  dir: string;
  /** Stable relative identifier, e.g. "library-caches/com.spotify.client". */
  relId: string;
  /** Human-readable name. */
  name: string;
}

/** Fixed per-app cache child names checked one level under app dirs. */
const APP_CHILD_KINDS_DARWIN = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "GrShaderCache",
  "ShaderCache",
  "CachedData",
];
const APP_CHILD_KINDS_WIN32 = ["Cache", "Code Cache", "GPUCache"];
const APP_CHILD_KINDS_LINUX = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "GrShaderCache",
];

/** Upper bound on candidates sized/reported in a single discovery pass. */
// Real systems show ~470 candidates (this dev machine); 800 covers heavy
// setups while still bounding pathological directory layouts.
const MAX_CANDIDATES = 800;

/**
 * Hard ceiling on candidates SIZED in one pass. Above MAX_CANDIDATES we still
 * size everything up to this many and then keep the largest MAX_CANDIDATES by
 * size, so the biggest caches are never dropped merely for appearing late in
 * readdir order. Above this ceiling we fall back to directory-order slicing.
 */
const HARD_MAX_CANDIDATES = 4000;

/** Discovery results are reused for this long within one scan. */
const DISCOVERY_TTL_MS = 2 * 60 * 1000;

function slugSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "library-caches/com.spotify.client" -> "app-caches:library-caches/com.spotify.client" */
function makeId(relId: string): string {
  return `app-caches:${relId.split("/").map(slugSegment).join("/")}`;
}

async function listSubdirs(root: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/** Cheap non-empty check: one readdir, far cheaper than sizing with du. */
async function dirHasEntries(dir: string): Promise<boolean> {
  try {
    const entries = await fsp.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * System-wide application cache discovery. Scans well-known platform cache
 * roots, classifies every candidate through the safety rule engine
 * (safe / probably-safe / caution / manual; "never" and "claimed" paths are
 * excluded entirely), and exposes the survivors as cache categories.
 *
 * Inherits clear()/clearByCategory() from BaseCleaner so the manual-tier
 * consent gate and safety-tier filtering always apply.
 */
export class AppCacheDiscoveryCleaner extends BaseCleaner {
  name = "app-caches";
  type: CacheType = "system";
  description =
    "Discovered application caches across the whole system (with safety classification)";

  private cachedCategories: CacheCategory[] | null = null;
  private discoveredAt = 0;
  private discoveryInFlight: Promise<CacheCategory[]> | null = null;

  async isAvailable(): Promise<boolean> {
    for (const root of getDiscoveryRoots()) {
      if (await pathExists(root)) return true;
    }
    return false;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const categories = await this.discover();
    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: categories.flatMap((c) => c.paths),
      isInstalled: true,
      size: categories.reduce((sum, c) => sum + (c.size || 0), 0),
      categories,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    return this.discover();
  }

  /**
   * Run (or reuse) discovery: collect candidates, classify, size them
   * concurrently, and build categories. Results are cached on the instance
   * so getCacheInfo() + getCacheCategories() within one scan only walk the
   * filesystem once.
   */
  private async discover(): Promise<CacheCategory[]> {
    const now = Date.now();
    if (this.cachedCategories && now - this.discoveredAt < DISCOVERY_TTL_MS) {
      return this.cachedCategories;
    }
    // Memoize the in-flight run: getCacheInfo() and getCacheCategories() are
    // often called back-to-back within one scan; without this each would kick
    // off a full filesystem discovery, because the TTL cache is only populated
    // once the first run finishes.
    if (this.discoveryInFlight) return this.discoveryInFlight;

    this.discoveryInFlight = this.runDiscovery()
      .then((categories) => {
        this.cachedCategories = categories;
        this.discoveredAt = Date.now();
        return categories;
      })
      .finally(() => {
        this.discoveryInFlight = null;
      });
    return this.discoveryInFlight;
  }

  private async runDiscovery(): Promise<CacheCategory[]> {
    const candidates = await this.collectCandidates();

    const kept: Array<
      Candidate & { safety: CacheCategory["safety"]; reason: string }
    > = [];
    for (const candidate of candidates) {
      const { verdict, reason } = classifyCachePath(candidate.dir);
      if (verdict === "never" || verdict === "claimed") {
        printVerbose(
          `app-caches: skipping ${candidate.dir} (${verdict}: ${reason})`,
        );
        continue;
      }
      kept.push({ ...candidate, safety: verdict, reason });
    }

    // Drop empty cache dirs before sizing: most discovered candidates -
    // especially sandboxed-app containers, ~99% of which are empty on a real
    // Mac - have nothing to reclaim, and a single readdir is far cheaper than
    // spawning du for each. This keeps the full-system scan fast even with
    // thousands of container candidates.
    const nonEmpty: typeof kept = [];
    for (let i = 0; i < kept.length; i += 64) {
      const chunk = kept.slice(i, i + 64);
      const present = await Promise.all(chunk.map((c) => dirHasEntries(c.dir)));
      chunk.forEach((candidate, idx) => {
        if (present[idx]) nonEmpty.push(candidate);
      });
    }

    // Size everything (up to a hard ceiling) BEFORE bounding, so that when
    // there are more than MAX_CANDIDATES we keep the largest by size rather
    // than whichever came first in readdir order - the biggest caches are
    // exactly the ones worth surfacing.
    let toSize = nonEmpty;
    if (nonEmpty.length > HARD_MAX_CANDIDATES) {
      printVerbose(
        `app-caches: ${nonEmpty.length} non-empty candidates exceed the hard cap; sizing the first ${HARD_MAX_CANDIDATES} in directory order`,
      );
      toSize = nonEmpty.slice(0, HARD_MAX_CANDIDATES);
    }

    // Size all candidates concurrently; getCachedDirectorySize internally
    // caps concurrent du invocations, so this fan-out is safe. Survey
    // budget: 4s per directory so big caches (browser/Electron trees, model
    // stores) cannot stall the shared sizing queue - outliers fall back to a
    // sampled estimate, which is fine for discovery display (real freed bytes
    // are measured at clean time, not here).
    let categories = await Promise.all(
      toSize.map(async (candidate): Promise<CacheCategory> => {
        const size = await getCachedDirectorySize(candidate.dir, false, 4000);
        let lastModified: Date | undefined;
        let ageInDays: number | undefined;
        try {
          const stat = await fsp.stat(candidate.dir);
          lastModified = stat.mtime;
          ageInDays = Math.floor(
            (Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24),
          );
        } catch {
          // stat failures only cost recency metadata
        }

        return {
          id: makeId(candidate.relId),
          name: candidate.name,
          description: `${candidate.reason} (${candidate.dir})`,
          paths: [candidate.dir],
          size,
          lastModified,
          ageInDays,
          priority: "normal",
          safety: candidate.safety,
          useCase: "development",
        };
      }),
    );

    // Keep the largest MAX_CANDIDATES once sized, so truncation never hides a
    // big cache behind hundreds of tiny ones. Order is otherwise preserved
    // (no re-sort) when we are under the cap.
    if (categories.length > MAX_CANDIDATES) {
      printVerbose(
        `app-caches: keeping the ${MAX_CANDIDATES} largest of ${categories.length} discovered caches`,
      );
      categories = categories
        .slice()
        .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
        .slice(0, MAX_CANDIDATES);
    }

    return categories;
  }

  /** Enumerate candidate cache directories for the current platform. */
  private async collectCandidates(): Promise<Candidate[]> {
    const home = os.homedir();
    const platform = os.platform();
    const candidates: Candidate[] = [];

    const addSubdirs = async (
      root: string,
      relPrefix: string,
    ): Promise<void> => {
      for (const sub of await listSubdirs(root)) {
        candidates.push({
          dir: path.join(root, sub),
          relId: `${relPrefix}/${sub}`,
          name: sub,
        });
      }
    };

    // One level under each app dir: check only the fixed cache child names.
    const addAppChildren = async (
      root: string,
      relPrefix: string,
      kinds: string[],
      nameLabel: string,
      skipDirs: string[] = [],
    ): Promise<void> => {
      const skipLower = skipDirs.map((d) => d.toLowerCase());
      for (const app of await listSubdirs(root)) {
        if (skipLower.includes(app.toLowerCase())) continue;
        for (const kind of kinds) {
          const dir = path.join(root, app, kind);
          if (!(await isDirectory(dir))) continue;
          candidates.push({
            dir,
            relId: `${relPrefix}/${app}/${kind}`,
            name: `${nameLabel}: ${app}/${kind}`,
          });
        }
      }
    };

    // Sandboxed-app caches live inside each app's container, under a fixed
    // Caches subpath - never the app's Data root. The bundle id is a path
    // segment, so the same safety rules (never/claimed/manual/...) apply.
    const addContainerCaches = async (
      root: string,
      relPrefix: string,
      cacheRelPath: string[],
      label: string,
    ): Promise<void> => {
      for (const bundle of await listSubdirs(root)) {
        const dir = path.join(root, bundle, ...cacheRelPath);
        if (!(await isDirectory(dir))) continue;
        candidates.push({
          dir,
          relId: `${relPrefix}/${bundle}`,
          name: `${label}: ${bundle}`,
        });
      }
    };

    if (platform === "darwin") {
      await addSubdirs(path.join(home, "Library", "Caches"), "library-caches");
      await addSubdirs(
        path.join(home, "Library", "Application Support", "Caches"),
        "app-support-caches",
      );
      await addAppChildren(
        path.join(home, "Library", "Application Support"),
        "app-support",
        APP_CHILD_KINDS_DARWIN,
        "App Support",
        // The Caches subdir is scanned wholesale above, not per-app.
        ["Caches"],
      );
      await addSubdirs(path.join(home, "Library", "Logs"), "logs");
      // ~/.cache may be a symlink; readdir uses it as-is (never resolved).
      await addSubdirs(path.join(home, ".cache"), "dot-cache");
      // Sandboxed / Mac App Store apps keep caches in their container, not
      // ~/Library/Caches (CleanMyMac-parity coverage). Only the Caches
      // subpath is targeted, never the app's Data root.
      await addContainerCaches(
        path.join(home, "Library", "Containers"),
        "containers",
        ["Data", "Library", "Caches"],
        "Container",
      );
      await addContainerCaches(
        path.join(home, "Library", "Group Containers"),
        "group-containers",
        ["Library", "Caches"],
        "Group Container",
      );
    } else if (platform === "win32") {
      const local =
        process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
      const roaming =
        process.env.APPDATA || path.join(home, "AppData", "Roaming");

      const temp = path.join(local, "Temp");
      if (await isDirectory(temp)) {
        candidates.push({ dir: temp, relId: "local-temp", name: "Temp" });
      }
      await addAppChildren(
        roaming,
        "appdata",
        APP_CHILD_KINDS_WIN32,
        "AppData",
      );
      await addAppChildren(
        local,
        "local-appdata",
        APP_CHILD_KINDS_WIN32,
        "AppData",
      );
    } else {
      const xdgCache = process.env.XDG_CACHE_HOME || path.join(home, ".cache");
      await addSubdirs(xdgCache, "xdg-cache");

      // Linux Electron/Chromium apps keep caches under the config dir
      // (~/.config/<App>/Cache, Code Cache, ...), not only ~/.cache.
      const xdgConfig =
        process.env.XDG_CONFIG_HOME || path.join(home, ".config");
      await addAppChildren(
        xdgConfig,
        "xdg-config",
        APP_CHILD_KINDS_LINUX,
        "Config",
      );

      // Flatpak per-app caches: ~/.var/app/<id>/cache
      await addAppChildren(
        path.join(home, ".var", "app"),
        "flatpak",
        ["cache"],
        "Flatpak",
      );

      // Snap per-app caches: ~/snap/<name>/current/.cache and common/.cache
      // ("current" is a symlink to the active revision; isDirectory() stats
      // through it).
      await addAppChildren(
        path.join(home, "snap"),
        "snap",
        [path.join("current", ".cache"), path.join("common", ".cache")],
        "Snap",
      );
    }

    // Drop any non-absolute candidate: an empty os.homedir() (stripped env)
    // would otherwise produce paths resolved against the current directory,
    // including the win32 Temp path built from an unset LOCALAPPDATA.
    return candidates.filter((candidate) => path.isAbsolute(candidate.dir));
  }
}

export default new AppCacheDiscoveryCleaner();
