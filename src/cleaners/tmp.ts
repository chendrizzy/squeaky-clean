import { BaseCleaner } from "./BaseCleaner";
import {
  CacheCategory,
  CacheInfo,
  CacheType,
  SafetyTier,
} from "../types";
import {
  readdir as fsReaddir,
  lstat as fsLstat,
  realpath as fsRealpath,
  rm as fsRm,
} from "fs/promises";
import { realpathSync, statSync, Stats } from "fs";
import * as os from "os";
import * as path from "path";
import { minimatch } from "minimatch";
import { printVerbose } from "../utils/cli";
import { config } from "../config";

/**
 * Minimal filesystem surface the tmp cleaner depends on. Injecting it keeps the
 * safety-critical walk and the guarded deleter deterministically testable
 * (sockets, uids, and symlinks that memfs cannot model) without touching the
 * production path, which uses the real fs/promises functions below.
 */
export interface TmpFs {
  readdir(p: string): Promise<string[]>;
  lstat(p: string): Promise<Stats>;
  realpath(p: string): Promise<string>;
  rm(p: string, opts: { recursive: boolean; force: boolean }): Promise<void>;
}

const realFs: TmpFs = {
  readdir: (p) => fsReaddir(p),
  lstat: (p) => fsLstat(p),
  realpath: (p) => fsRealpath(p),
  rm: (p, opts) => fsRm(p, opts),
};

/**
 * Anything modified/changed within this window is treated as in-use and never
 * offered, even under the aggressive profile. The single cheapest, spawn-free
 * "active task" signal.
 */
export const IN_USE_FLOOR_MS = 60 * 60 * 1000;

/**
 * Default boundary (days) between the aggressive-only "caution" band and the
 * default-cleaned "probably-safe" band. Per-run override via `--older-than`.
 */
export const DEFAULT_TMP_MAX_AGE_DAYS = 3;

// Bounds that keep the subtree walk from ever stalling a scan. Reaching any of
// them makes a candidate INELIGIBLE (we never delete what we could not verify).
const MAX_WALK_DEPTH = 64;
const MAX_NODES_PER_CANDIDATE = 50_000;
const PER_CANDIDATE_BUDGET_MS = 2_000;
const GLOBAL_WALK_BUDGET_MS = 8_000;
const HARD_MAX_CANDIDATES = 4_000;
const MAX_CANDIDATES = 800;
const DISCOVERY_TTL_MS = 2 * 60 * 1000;

/**
 * Names always excluded. The file-type check already skips sockets/FIFOs, but a
 * regular DIRECTORY can wrap live sockets the top-level type check cannot see
 * (e.g. an ssh agent dir holding a socket). These protect those wrappers.
 */
export const TMP_NEVER_PATTERNS: RegExp[] = [
  /^ssh-/i, // ssh agent socket dirs (ssh-XXXXXX)
  /^\.X11-unix$/i,
  /^\.ICE-unix$/i,
  /^\.font-unix$/i,
  /^\.XIM-unix$/i,
  /^\.Test-unix$/i,
  /^tmux-/i, // tmux server socket dirs (tmux-1000)
  /^dbus-/i,
  /^systemd-/i, // systemd-private-*, systemd-xxxxxx
  /^snap\./i, // snap socket dirs
  /^gpg-/i,
  /^\.gnupg/i,
  /^com\.apple\./i, // macOS launchd/service dirs
  /^\.com\.apple\./i,
  /^powerlog$/i,
  /^\.org\.chromium\./i,
  /^\.com\.google\.Chrome/i,
];

/**
 * Names owned by dedicated cleaners; excluded so tmp never double-sizes or
 * double-deletes what go-build / pip already manage.
 */
export const TMP_CLAIMED_PATTERNS: RegExp[] = [
  /^go-build/i, // goBuild cleaner
  /^pip-cache$/i, // pip cleaner
  /^pip-(ephem|build|req|install|unpack|wheel|tmp)/i, // pip ephemeral temp dirs
];

export function matchesNeverName(name: string): boolean {
  return TMP_NEVER_PATTERNS.some((re) => re.test(name));
}

export function matchesClaimedName(name: string): boolean {
  return TMP_CLAIMED_PATTERNS.some((re) => re.test(name));
}

/** User `toolSettings.tmp.exclude` name globs (minimatch) / substrings. */
function matchesNameExclude(name: string, patterns: string[]): boolean {
  const n = name.toLowerCase();
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.includes("*") || p.includes("?")) return minimatch(n, p);
    return n === p || n.includes(p);
  });
}

function readTmpExcludes(): string[] {
  try {
    const ex = config.get().toolSettings?.tmp?.exclude;
    return Array.isArray(ex)
      ? ex.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Resolve the temp roots: realpath-canonicalized, deduped, existing dirs only.
 * macOS `os.tmpdir()` -> /var/folders/<h>/T (the reclaimable bulk) and /tmp ->
 * /private/tmp; realpath collapses those aliases. We NEVER ascend to a root's
 * parent (its 0/C/X siblings on macOS are live Darwin state). On Windows only
 * os.tmpdir() (%TEMP%, per-user) exists; /tmp and /var/tmp realpath-fail and drop.
 */
export function resolveTmpRoots(
  rawRoots: string[] = [os.tmpdir(), "/tmp", "/var/tmp"],
  realpathSyncFn: (p: string) => string = realpathSync,
  statSyncFn: (p: string) => { isDirectory(): boolean } = statSync,
): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const r of rawRoots) {
    if (!r) continue;
    try {
      const real = realpathSyncFn(r);
      if (!statSyncFn(real).isDirectory()) continue;
      if (!seen.has(real)) {
        seen.add(real);
        roots.push(real);
      }
    } catch {
      // missing / broken root -> skip
    }
  }
  return roots;
}

/**
 * Return the matching root if `realPath` is a STRICT descendant of exactly one
 * root, else null. Equality with a root returns null: a root is never a
 * deletion target. This is the containment boundary the inherited clearPath and
 * safeRmrf both lack.
 */
export function isWithinRoots(realPath: string, roots: string[]): string | null {
  for (const root of roots) {
    if (realPath === root) return null;
    if (realPath.startsWith(root + path.sep)) return root;
  }
  return null;
}

/** Tier from age. <threshold (but >= the in-use floor) is aggressive-only. */
export function tierForAgeDays(
  ageDays: number,
  thresholdDays: number,
): SafetyTier {
  if (ageDays >= 30) return "safe";
  if (ageDays >= thresholdDays) return "probably-safe";
  return "caution";
}

function ownedByCurrentUser(st: Stats): boolean {
  // Windows has no getuid; rely on the per-user %LOCALAPPDATA%\Temp root instead.
  if (typeof process.getuid !== "function") return true;
  return st.uid === process.getuid();
}

function nodeSize(st: Stats): number {
  // Match `du` (block-based) when available; fall back to apparent size.
  if (typeof st.blocks === "number" && st.blocks > 0) return st.blocks * 512;
  return st.size ?? 0;
}

function makeTmpId(full: string): string {
  return `tmp:${full.replace(/[^a-zA-Z0-9._/\\-]+/g, "-")}`;
}

interface WalkResult {
  eligible: boolean;
  reason?: string;
  newestActivityMs: number;
  size: number;
}

interface WalkBudget {
  deadline: number;
  nodesLeft: number;
}

/**
 * Bounded recursive subtree guard — the real liveness mechanism. Disqualifies
 * the ENTIRE candidate if any descendant is a socket/FIFO/device, or any
 * descendant's max(mtime,ctime) is within the in-use floor, or the subtree
 * cannot be fully verified within the budget. Liveness uses mtime/ctime, NOT
 * atime: our own readdir bumps directory atime and would self-disqualify
 * everything. Also returns the newest activity (for tiering) and total size.
 */
export async function analyzeTree(
  rootPath: string,
  topStat: Stats,
  now: number,
  budget: WalkBudget,
  fs: TmpFs = realFs,
): Promise<WalkResult> {
  let newest = 0;
  let size = 0;

  const visit = async (
    p: string,
    st: Stats,
    depth: number,
  ): Promise<string | null> => {
    if (
      st.isSocket() ||
      st.isFIFO() ||
      st.isBlockDevice() ||
      st.isCharacterDevice()
    ) {
      return "special-file";
    }
    // Ownership is checked on EVERY node, not just the top candidate: a
    // user-owned wrapper dir on a sticky/shared /tmp can hold root- or
    // other-user-owned files, and rm -rf of the wrapper would delete them.
    if (!ownedByCurrentUser(st)) return "foreign-owner";

    const activity = Math.max(st.mtimeMs, st.ctimeMs);
    if (now - activity < IN_USE_FLOOR_MS) return "recently-active";
    if (activity > newest) newest = activity;
    size += nodeSize(st);

    if (!st.isDirectory()) return null;
    // Cannot descend deeper -> cannot prove the subtree is socket-free/stale.
    if (depth >= MAX_WALK_DEPTH) return "too-deep";

    let names: string[];
    try {
      names = await fs.readdir(p);
    } catch {
      // Unreadable subtree -> cannot verify -> refuse the whole candidate.
      return "unreadable-subtree";
    }

    for (const name of names) {
      if (budget.nodesLeft-- <= 0 || Date.now() > budget.deadline) {
        return "budget-exceeded";
      }
      const child = path.join(p, name);
      let cst: Stats;
      try {
        cst = await fs.lstat(child);
      } catch {
        continue; // entry vanished between readdir and lstat; ignore it
      }
      // A symlink inside is removed as a link by rm (never followed); skip it.
      if (cst.isSymbolicLink()) continue;
      const reason = await visit(child, cst, depth + 1);
      if (reason) return reason;
    }
    return null;
  };

  const reason = await visit(rootPath, topStat, 0);
  if (reason) {
    return { eligible: false, reason, newestActivityMs: newest, size };
  }
  return {
    eligible: true,
    newestActivityMs:
      newest > 0 ? newest : Math.max(topStat.mtimeMs, topStat.ctimeMs),
    size,
  };
}

/**
 * System temp cleaner. Reclaims abandoned files across the user's temp roots,
 * enabled by default, while structurally refusing to touch anything a live
 * process could need — spawn-free (file-type + ownership + name + recency
 * heuristics, no lsof). Extends BaseCleaner for tier-gating and consent, but
 * OVERRIDES clearPath with a guarded deleter because the inherited path has no
 * containment check.
 */
export class TmpCleaner extends BaseCleaner {
  name = "tmp";
  type: CacheType = "system";
  description =
    "Abandoned files in system temp directories (active-task aware, on by default)";

  private roots: string[] | null = null;
  private cachedCategories: CacheCategory[] | null = null;
  private discoveredAt = 0;
  private discoveryInFlight: Promise<CacheCategory[]> | null = null;

  constructor(
    private readonly fsImpl: TmpFs = realFs,
    private readonly rootsOverride?: string[],
    // Injectable so tests can make the walk deterministic (no wall-clock
    // dependence). Production uses the module constants.
    private readonly budgets: { perCandidateMs: number; globalMs: number } = {
      perCandidateMs: PER_CANDIDATE_BUDGET_MS,
      globalMs: GLOBAL_WALK_BUDGET_MS,
    },
  ) {
    super();
  }

  private getRoots(): string[] {
    if (this.rootsOverride) return this.rootsOverride;
    if (this.roots === null) this.roots = resolveTmpRoots();
    return this.roots;
  }

  async isAvailable(): Promise<boolean> {
    return this.getRoots().length > 0;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const categories = await this.discover();
    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: categories.flatMap((c) => c.paths),
      isInstalled: this.getRoots().length > 0,
      size: categories.reduce((sum, c) => sum + (c.size || 0), 0),
      categories,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    return this.discover();
  }

  /** Run (or reuse within one scan) discovery. Mirrors app-caches memoization. */
  private async discover(): Promise<CacheCategory[]> {
    const now = Date.now();
    if (this.cachedCategories && now - this.discoveredAt < DISCOVERY_TTL_MS) {
      return this.cachedCategories;
    }
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
    const roots = this.getRoots();
    const now = Date.now();
    const thresholdDays = DEFAULT_TMP_MAX_AGE_DAYS;
    const excludes = readTmpExcludes();
    const globalDeadline = now + this.budgets.globalMs;

    // 1) Cheap top-level eligibility: one lstat per direct child, no recursion.
    const entries: Array<{ full: string; name: string; st: Stats }> = [];
    for (const root of roots) {
      if (entries.length >= HARD_MAX_CANDIDATES) break;
      let names: string[];
      try {
        names = await this.fsImpl.readdir(root);
      } catch {
        continue;
      }
      for (const name of names) {
        if (entries.length >= HARD_MAX_CANDIDATES) break;
        if (matchesNeverName(name) || matchesClaimedName(name)) continue;
        if (excludes.length && matchesNameExclude(name, excludes)) continue;
        const full = path.join(root, name);
        let st: Stats;
        try {
          st = await this.fsImpl.lstat(full);
        } catch {
          continue;
        }
        if (
          st.isSymbolicLink() ||
          st.isSocket() ||
          st.isFIFO() ||
          st.isBlockDevice() ||
          st.isCharacterDevice()
        ) {
          continue;
        }
        if (!st.isDirectory() && !st.isFile()) continue;
        if (!ownedByCurrentUser(st)) continue;
        entries.push({ full, name, st });
      }
    }

    // 2) Bounded subtree analysis, concurrent in chunks, globally time-capped.
    const analyzed: Array<{
      full: string;
      name: string;
      size: number;
      newest: number;
    }> = [];
    let droppedBudget = 0;
    for (let i = 0; i < entries.length; i += 32) {
      const chunk = entries.slice(i, i + 32);
      const results = await Promise.all(
        chunk.map(async (e) => {
          const budget: WalkBudget = {
            deadline: Math.min(
              Date.now() + this.budgets.perCandidateMs,
              globalDeadline,
            ),
            nodesLeft: MAX_NODES_PER_CANDIDATE,
          };
          const r = await analyzeTree(
            e.full,
            e.st,
            now,
            budget,
            this.fsImpl,
          ).catch(
            (): WalkResult => ({
              eligible: false,
              reason: "error",
              newestActivityMs: 0,
              size: 0,
            }),
          );
          return { e, r };
        }),
      );
      for (const { e, r } of results) {
        if (!r.eligible) {
          if (r.reason === "budget-exceeded") droppedBudget++;
          continue;
        }
        if (r.size <= 0) continue;
        analyzed.push({
          full: e.full,
          name: e.name,
          size: r.size,
          newest: r.newestActivityMs,
        });
      }
      if (Date.now() > globalDeadline) {
        const remaining = entries.length - (i + chunk.length);
        if (remaining > 0) {
          printVerbose(
            `tmp: global walk budget hit; skipped ${remaining} unverified candidate(s)`,
          );
        }
        break;
      }
    }
    if (droppedBudget > 0) {
      printVerbose(
        `tmp: ${droppedBudget} candidate(s) skipped (could not verify within time budget)`,
      );
    }

    // 3) Build tier-tagged categories.
    let categories: CacheCategory[] = analyzed.map((a) => {
      const ageInDays = Math.max(0, Math.floor((now - a.newest) / 86_400_000));
      return {
        id: makeTmpId(a.full),
        name: a.name,
        description: `Temporary item: ${a.full}`,
        paths: [a.full],
        size: a.size,
        lastModified: new Date(a.newest),
        ageInDays,
        priority: "normal",
        safety: tierForAgeDays(ageInDays, thresholdDays),
        useCase: "development",
      };
    });

    // 4) Keep the largest MAX_CANDIDATES so truncation never hides a big item.
    if (categories.length > MAX_CANDIDATES) {
      printVerbose(
        `tmp: keeping the ${MAX_CANDIDATES} largest of ${categories.length} temp items`,
      );
      categories = categories
        .slice()
        .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
        .slice(0, MAX_CANDIDATES);
    }

    return categories;
  }

  /**
   * Guarded deleter — replaces BaseCleaner.clearPath, which follows symlinks and
   * rm-rf's with no containment check. Per path: reject symlinks, canonicalize,
   * assert strict-descendant of a temp root, re-verify the subtree is still
   * inactive (TOCTOU shrink), then fully remove the entry. Any failure or guard
   * rejection skips the path and logs — it never crashes the run and never
   * deletes something it could not prove safe.
   */
  protected async clearPath(p: string): Promise<void> {
    try {
      const st = await this.fsImpl.lstat(p);
      if (st.isSymbolicLink()) {
        printVerbose(`tmp: refusing to follow symlink ${p}`);
        return;
      }
      const real = await this.fsImpl.realpath(p);
      if (!isWithinRoots(real, this.getRoots())) {
        printVerbose(`tmp: refusing path outside temp roots: ${p} -> ${real}`);
        return;
      }
      const budget: WalkBudget = {
        deadline: Date.now() + this.budgets.perCandidateMs,
        nodesLeft: MAX_NODES_PER_CANDIDATE,
      };
      const r = await analyzeTree(real, st, Date.now(), budget, this.fsImpl);
      if (!r.eligible) {
        printVerbose(`tmp: skipping ${p} (now active: ${r.reason})`);
        return;
      }
      await this.fsImpl.rm(real, { recursive: true, force: true });
    } catch (err) {
      printVerbose(
        `tmp: failed to clear ${p}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

export default new TmpCleaner();
