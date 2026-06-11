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

/** Upper bound on candidates sized/reported in a single discovery pass. */
// Real systems show ~470 candidates (this dev machine); 800 covers heavy
// setups while still bounding pathological directory layouts.
const MAX_CANDIDATES = 800;

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

    let bounded = kept;
    if (kept.length > MAX_CANDIDATES) {
      printVerbose(
        `app-caches: truncating discovery to ${MAX_CANDIDATES} of ${kept.length} candidates`,
      );
      bounded = kept.slice(0, MAX_CANDIDATES);
    }

    // Size all candidates concurrently; getCachedDirectorySize internally
    // caps concurrent du invocations, so this fan-out is safe. Survey
    // budget: 10s per directory so one enormous tree (100GB+ model caches)
    // cannot stall the shared sizing queue - oversized outliers fall back
    // to a sampled estimate, which is fine for discovery display.
    const categories = await Promise.all(
      bounded.map(async (candidate): Promise<CacheCategory> => {
        const size = await getCachedDirectorySize(candidate.dir, false, 10000);
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

    this.cachedCategories = categories;
    this.discoveredAt = now;
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
      for (const app of await listSubdirs(root)) {
        if (skipDirs.includes(app)) continue;
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
    }

    return candidates;
  }
}

export default new AppCacheDiscoveryCleaner();
