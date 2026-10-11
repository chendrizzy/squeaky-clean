import { promises as fs, realpathSync } from "fs";
import * as os from "os";
import * as path from "path";
import {
  CacheInfo,
  ClearResult,
  CleanerModule,
  CacheSelectionCriteria,
  CacheCategory,
} from "../types";
import { formatSizeWithColor, printVerbose } from "../utils/cli";
import {
  classifySlices,
  readBundleInfo,
  readMachOSlices,
  type BundleInfo,
} from "../ub/bundle";
import { loadSeal, type Seal } from "../ub/seal";
import {
  DEFAULT_MIN_SAVINGS,
  selectCandidates,
  thinBundle,
  type Candidate,
  type ThinOutcome,
} from "../ub/thinner";
import { classifyApp, probeApp, type AppClass } from "../ub/policy";
import { ensureAgentHome } from "../ub/paths";
import { acquireLock, lockPath } from "../ub/lock";
import { recoverJournal } from "../ub/restore";
import { pruneExpiredBackups } from "../ub/backups";
import { matchesProtectedPath } from "./BaseCleaner";

/** Until Plan 2 adds `universalBinary.keepBackupsDays` to config. */
export const DEFAULT_KEEP_BACKUP_DAYS = 3;
export type RecoveryItem = Awaited<ReturnType<typeof recoverJournal>>[number];

const LIPO = "/usr/bin/lipo";
const SCAN_DEPTH = 3;
export const LOCK_WAIT_MS = 150_000;
/** Plan 1 has no background job: expired backups go only when squeaky runs again, or on `ub prune`. */
export const BACKUP_RELEASE = `freed by the next squeaky run after ${DEFAULT_KEEP_BACKUP_DAYS} days, or now with \`squeaky ub prune\``;
/** With no readable seal only the main executable is estimated (classifyFile: main first, everything else unsealed). */
const NO_SEAL: Seal = { files2: Object.create(null) };
const SIGNAL_EXIT: Record<string, number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

interface ScannedApp {
  id: string;
  info: BundleInfo;
  /** every path the scan found it at, unresolved from its root: protected globs may be written against these (c2) */
  foundAt: string[];
  cls: AppClass | null;
  candidates: Candidate[];
  savings: number;
}
/** A selected app headed for the engine; a tick beats the per-app floor. */
interface Work {
  app: ScannedApp;
  ticked: boolean;
}

/** Outcomes clear() decides itself, before the engine; their detail is part of the error text. */
const DETAIL_IN_ERROR = new Set(["not-attempted", "auto-ignored", "stale-id"]);

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

/** Bundle-derived text (names, paths, tool stderr) may hold terminal escapes (c10): every C0/C1 control char and DEL prints as `\xNN`. */
export const printable = (s: string): string =>
  s.replace(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f-\x9f]/g,
    (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
const appName = (p: string) => printable(path.basename(p, ".app"));
const underSystem = (real: string) =>
  real === "/System" || real.startsWith("/System/");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Protected patterns as given, plus the realpath of every plain (non-glob) one: apps are identified by realpath,
 * so a protected folder reached through a symlink must still protect what it points to. Spawn-free.
 */
async function withRealpaths(patterns: string[]): Promise<string[]> {
  const plain = patterns.filter((p) => !p.includes("*") && !p.includes("?"));
  const reals = await Promise.all(
    plain.map((p) => fs.realpath(p).catch(() => null)),
  );
  return [...patterns, ...reals.filter((r): r is string => r !== null)];
}

/** Dry-run estimate for one selected app, under the same floor thinBundle applies (a tick removes it). */
function estimate({ app: a, ticked }: Work): ThinOutcome {
  const out: ThinOutcome = {
    app: a.info.realpath,
    status: "skipped",
    heldBytes: 0,
    candidates: a.candidates,
    skipped: [],
  };
  if (
    a.candidates.length === 0 ||
    a.savings < (ticked ? 0 : DEFAULT_MIN_SAVINGS)
  )
    out.reason = "below-threshold";
  else Object.assign(out, { reason: "dry-run", heldBytes: a.savings });
  return out;
}

/** The binary macOS attributes App Management to: the realpath of the running node. */
function grantTarget(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

/** One line per app outcome; `squeaky ub` and the signal-exit report both print these. */
export function outcomeLine(o: ThinOutcome): string {
  const name = appName(o.app);
  const why = `${o.status}${o.reason ? `:${o.reason}` : ""}`;
  if (o.status === "thinned") {
    return `✓ ${name} — ${formatSizeWithColor(o.heldBytes)} will be ${BACKUP_RELEASE} (backup kept for safe rollback)`;
  }
  if (why === "rolled-back:verify-failed")
    return `↩ ${name} rolled back (verify failed) — unchanged`;
  if (why === "skipped:running")
    return `⏸ ${name} skipped: running — quit it and re-run`;
  if (why === "blocked:app-management") {
    return `⛔ ${name} blocked: app-management — grant App Management to ${grantTarget()} in System Settings → Privacy & Security`;
  }
  const mark = o.status === "skipped" ? "•" : "✗";
  return `${mark} ${name} ${why}${o.detail ? ` — ${printable(o.detail)}` : ""}`;
}

/** One line per interrupted earlier run that this run recovered under the lock. */
export function recoveryLine(r: RecoveryItem): string {
  return printable(
    `↻ Recovered interrupted run for ${path.basename(r.entry.bundle, ".app")}: ${r.result}${r.notes.length ? ` (${r.notes.join("; ")})` : ""}`,
  );
}

export class UniversalBinaryCleaner implements CleanerModule {
  name = "universal-binary";
  type = "system" as const;
  description =
    "Thin Universal Binaries on Apple Silicon to remove unused x86_64 code";

  /** Engine outcomes of the last clear(), one per app handed to the engine (dry run: estimates). */
  lastOutcomes: ThinOutcome[] = [];
  /** Journal recovery results of the last non-dry clear(), unfiltered. */
  lastRecovery: RecoveryItem[] = [];
  /** Housekeeping failures of the last non-dry clear() that did not stop it (`prune: <msg>`, `thin: <msg>`). */
  lastNotes: string[] = [];
  private scanned = new Map<string, ScannedApp>();

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "darwin") {
      printVerbose("Universal Binary cleaner only available on macOS");
      return false;
    }
    if (os.arch() !== "arm64") {
      printVerbose(
        `Universal Binary cleaner requires Apple Silicon (arm64), found: ${os.arch()}`,
      );
      return false;
    }
    // the engine runs /usr/bin/lipo by absolute path; a PATH lipo (e.g. conda's) is irrelevant
    return (await fs.stat(LIPO).catch(() => null))?.isFile() ?? false;
  }

  /** `SQUEAKY_AGENT_ROOTS` (colon-separated) is honoured only under tests, like `SQUEAKY_AGENT_HOME`. */
  scanRoots(): string[] {
    const override = process.env.SQUEAKY_AGENT_ROOTS;
    if (override && (process.env.VITEST || process.env.NODE_ENV === "test"))
      return override.split(":").filter(Boolean);
    return [
      "/Applications",
      "/Applications/Utilities",
      path.join(os.homedir(), "Applications"),
    ];
  }

  /** Category id -> auto-ignore class from the last scan (§6.2 row 5), or null. */
  autoIgnoredClass(categoryId: string): AppClass | null {
    return this.scanned.get(categoryId)?.cls ?? null;
  }

  /**
   * `.app` realpaths under the roots, sorted, each with the paths it was found at (unresolved, joined from the root):
   * depth 3 through non-.app folders, symlinks followed. A folder is read again only when reached at a strictly
   * shallower depth than before, so entry order never decides what is found (a folder first met deep through a
   * symlink is re-read when met shallow); that also cuts cycles.
   */
  private async findApps(): Promise<Map<string, string[]>> {
    const depthOf = new Map<string, number>(); // folder realpath -> shallowest depth it was read at
    const apps = new Map<string, string[]>();
    const visit = async (dir: string, depth: number): Promise<void> => {
      const real = await fs.realpath(dir).catch(() => null);
      if (
        !real ||
        underSystem(real) ||
        (depthOf.get(real) ?? Infinity) <= depth
      )
        return;
      depthOf.set(real, depth);
      const names = await fs.readdir(real).catch(() => [] as string[]);
      for (const n of names) {
        const p = path.join(dir, n);
        if (!(await fs.stat(p).catch(() => null))?.isDirectory()) continue;
        if (n.endsWith(".app")) {
          const r = await fs.realpath(p).catch(() => null);
          if (r && !underSystem(r)) apps.set(r, [...(apps.get(r) ?? []), p]);
        } else if (depth < SCAN_DEPTH) await visit(p, depth + 1);
      }
    };
    for (const root of this.scanRoots()) await visit(root, 0);
    return new Map([...apps].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  /** Spawn-free: in-process plist (bplist -> bundleId null), header reads, seal and policy probes. */
  private async scanApp(
    real: string,
  ): Promise<Omit<ScannedApp, "id" | "foundAt"> | null> {
    const info = await readBundleInfo(real, { allowSpawn: false });
    if (!info) return null;
    const main = path.join(real, "Contents", "MacOS", info.executable);
    if (!classifySlices(await readMachOSlices(main)).thinnable) return null;
    const { candidates } = await selectCandidates(
      info,
      (await loadSeal(real)) ?? NO_SEAL,
    );
    const cls = classifyApp(info, await probeApp(real))?.cls ?? null;
    return {
      info,
      cls,
      candidates,
      savings: sum(candidates.map((c) => c.savings)),
    };
  }

  private async scan(): Promise<ScannedApp[]> {
    const foundAt = await this.findApps();
    const paths = [...foundAt.keys()];
    const found: Array<Omit<ScannedApp, "id">> = [];
    let next = 0;
    // bounded: each app is a few header reads; unbounded would risk EMFILE on big /Applications
    const workers = Array.from(
      { length: Math.min(8, paths.length) },
      async () => {
        while (next < paths.length) {
          const p = paths[next++];
          const s = await this.scanApp(p).catch((e: unknown) => {
            printVerbose(printable(`Skipping ${p}: ${errText(e)}`));
            return null;
          });
          if (s) found.push({ ...s, foundAt: foundAt.get(p)! });
        }
      },
    );
    await Promise.all(workers);
    found.sort((a, b) =>
      a.info.realpath < b.info.realpath
        ? -1
        : a.info.realpath > b.info.realpath
          ? 1
          : 0,
    );

    const used = new Set<string>();
    const apps = found.map((s) => {
      const base = `universal-${s.info.name.toLowerCase().replace(/\s+/g, "-")}`;
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      return { id, ...s };
    });
    this.scanned = new Map(apps.map((a) => [a.id, a]));
    return apps;
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const apps = await this.scan();
    return apps.map((a) => ({
      id: a.id,
      name: a.info.name,
      description:
        `Universal binary: ${(a.savings / (1024 * 1024)).toFixed(1)} MB of x86_64 code` +
        (a.cls ? `; auto-ignored: ${a.cls}` : ""),
      paths: [a.info.realpath],
      size: a.savings,
      priority: "low" as const,
      useCase: "archived" as const,
      isProjectSpecific: false,
      appKey: a.info.bundleId ?? undefined,
    }));
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const base = {
      name: this.name,
      type: this.type,
      description: this.description,
    };
    if (!(await this.isAvailable()))
      return { ...base, paths: [], isInstalled: false, size: 0 };
    const categories = await this.getCacheCategories();
    return {
      ...base,
      paths: categories.map((c) => c.paths[0]),
      isInstalled: true,
      // auto-ignored apps are never thinned by default, so they are not counted as reclaimable
      size: sum(
        categories
          .filter((c) => !this.autoIgnoredClass(c.id))
          .map((c) => c.size ?? 0),
      ),
      categories,
    };
  }

  /**
   * Splits a selection into apps for the engine and outcomes decided here (spec §6.2).
   * - No `criteria.categories`: every scanned app minus auto-ignored ones (not selected at all), under the engine floor.
   * - `categories` only narrows: an auto-ignored app is skipped (`skipped:auto-ignored`) and the 5 MB floor applies.
   *   An id in `criteria.tickedIds` (interactive tick) beats both.
   * - Stale ids (T11-R4): an id whose re-scanned realpath differs from the path the caller showed is `skipped:stale-id`.
   *   The shown path is `criteria.expectedPaths[id]` (an id missing there is stale too), else the caller's own
   *   `cacheInfo.categories` paths[0]; with neither, the rescan is accepted.
   * - Protected (round 3): an app whose realpath, or any path the scan found it at, is at or inside a protected path
   *   (`protectedPaths`, already widened by `withRealpaths`) is `skipped:protected` in every mode, ticked or not.
   */
  private select(
    scanned: ScannedApp[],
    criteria: CacheSelectionCriteria | undefined,
    cacheInfo: CacheInfo | undefined,
    protectedPaths: string[],
  ): { work: Work[]; skips: ThinOutcome[] } {
    const skips: ThinOutcome[] = [];
    const work: Work[] = [];
    const skip = (app: string, reason: string, detail?: string) =>
      skips.push({
        app,
        status: "skipped",
        reason,
        detail,
        heldBytes: 0,
        candidates: [],
        skipped: [],
      });
    // the realpath and every path it was found at: a glob through a symlinked folder only matches the latter (c2)
    const isProtected = (a: ScannedApp) =>
      [a.info.realpath, ...a.foundAt].some((p) =>
        matchesProtectedPath(p, protectedPaths),
      );
    if (!criteria?.categories) {
      for (const a of scanned.filter((x) => !x.cls)) {
        if (isProtected(a)) skip(a.info.realpath, "protected");
        else work.push({ app: a, ticked: false });
      }
      return { work, skips };
    }
    const byId = new Map(scanned.map((a) => [a.id, a]));
    const ticked = new Set(criteria.tickedIds ?? []);
    const strict = criteria.expectedPaths !== undefined;
    const shown = new Map<string, string | undefined>(
      Object.entries(
        criteria.expectedPaths ??
          Object.fromEntries(
            (cacheInfo?.categories ?? []).map((c) => [c.id, c.paths[0]]),
          ),
      ),
    );
    for (const id of new Set(criteria.categories)) {
      const a = byId.get(id);
      const want = shown.get(id);
      if (want === undefined ? strict : a?.info.realpath !== want) {
        skip(
          want ?? a?.info.realpath ?? id,
          "stale-id",
          want === undefined
            ? "no path was shown for it"
            : a
              ? `now ${a.info.realpath}`
              : "no longer found",
        );
      } else if (!a) {
        continue; // unknown id and nothing shown for it: nothing to thin
      } else if (isProtected(a)) {
        skip(a.info.realpath, "protected");
      } else if (a.cls && !ticked.has(id)) {
        skip(a.info.realpath, "auto-ignored", a.cls);
      } else {
        work.push({ app: a, ticked: ticked.has(id) });
      }
    }
    return { work, skips };
  }

  /**
   * What clear() would decide for this selection, from the last scan: no rescan, no spawn, nothing written.
   * `skipped:dry-run` outcomes (heldBytes = estimate) are what a real run would thin; every other outcome is a skip.
   */
  async preview(
    criteria?: CacheSelectionCriteria,
    protectedPaths: string[] = [],
  ): Promise<ThinOutcome[]> {
    const { work, skips } = this.select(
      [...this.scanned.values()],
      criteria,
      undefined,
      await withRealpaths(protectedPaths),
    );
    return [...skips, ...work.map(estimate)];
  }

  /**
   * Selection: see `select`. Nothing is freed yet: originals are held as backups, so sizeAfter === sizeBefore and
   * heldBytes says what will be freed. `cacheInfo` (what `squeaky clean` passes) supplies the paths the caller saw;
   * `protectedPaths` is the config list CacheManager passes as the 4th argument.
   */
  async clear(
    dryRun = false,
    criteria?: CacheSelectionCriteria,
    cacheInfo?: CacheInfo,
    protectedPaths: string[] = [],
  ): Promise<ClearResult> {
    this.lastOutcomes = [];
    this.lastRecovery = [];
    this.lastNotes = [];
    const result: ClearResult = {
      name: this.name,
      success: false,
      clearedPaths: [],
      sizeBefore: 0,
      sizeAfter: 0,
      heldBytes: 0,
    };
    if (!(await this.isAvailable())) {
      return {
        ...result,
        error:
          "Universal Binary cleaner requires macOS on Apple Silicon (arm64)",
      };
    }
    const { work, skips } = this.select(
      await this.scan(),
      criteria,
      cacheInfo,
      await withRealpaths(protectedPaths),
    );
    let thinThrew = false;

    if (dryRun) {
      // estimate only: no lock, no agent home, no spawns (so no baseline or running checks)
      this.lastOutcomes.push(...skips, ...work.map(estimate));
    } else {
      const home = await ensureAgentHome();
      const lock = await acquireLock(home, { waitMs: LOCK_WAIT_MS });
      if (!lock)
        return {
          ...result,
          error: `agent busy: another squeaky run holds ${lockPath(home)}`,
        };
      // SIGTERM/SIGINT/SIGHUP (a closed terminal): let the app in flight reach a terminal state, start no other,
      // release the lock, then exit
      let stopSignal: NodeJS.Signals | undefined;
      const onSignal = (s: NodeJS.Signals) => {
        stopSignal = s;
      };
      const signals = Object.keys(SIGNAL_EXIT) as NodeJS.Signals[];
      for (const s of signals) process.on(s, onSignal);
      try {
        // §6.2 row 5 for binary-plist apps (k1): the scan could not read their bundle id without spawning plutil
        const engine: Work[] = [];
        for (const w of work) {
          if (w.ticked || w.app.info.bundleId !== null) {
            engine.push(w);
            continue;
          }
          const info = await readBundleInfo(w.app.info.realpath, {
            allowSpawn: true,
          }).catch(() => null);
          // an identity that cannot be read fails closed: it could be any auto-ignored vendor (F2)
          const cls = info
            ? (classifyApp(info, await probeApp(info.realpath))?.cls ?? null)
            : "identity unreadable";
          if (cls) {
            skips.push({
              app: w.app.info.realpath,
              status: "skipped",
              reason: "auto-ignored",
              detail: cls,
              heldBytes: 0,
              candidates: [],
              skipped: [],
            });
          } else engine.push(w);
        }
        this.lastOutcomes.push(...skips);
        this.lastRecovery = await recoverJournal(home, lock.runId);
        // housekeeping: a prune failure is reported, never fatal, so the recovery results above still reach the caller
        await pruneExpiredBackups(
          home,
          DEFAULT_KEEP_BACKUP_DAYS,
          Date.now(),
        ).catch((e: unknown) => {
          this.lastNotes.push(`prune: ${errText(e)}`);
        });
        try {
          for (const [seq, { app: a, ticked }] of engine.entries()) {
            if (stopSignal) break;
            const o = await thinBundle(a.info.realpath, {
              home,
              runId: lock.runId,
              seq,
              minSavingsBytes: ticked ? 0 : undefined,
            });
            this.lastOutcomes.push(o);
            // spec §10 EPERM: stop attempting other bundles this pass; each attempt is an App Management write probe
            if (o.status === "blocked" && o.reason === "app-management") {
              for (const { app: rest } of engine.slice(seq + 1)) {
                this.lastOutcomes.push({
                  app: rest.info.realpath,
                  status: "skipped",
                  reason: "not-attempted",
                  detail: "app-management",
                  heldBytes: 0,
                  candidates: [],
                  skipped: [],
                });
              }
              break;
            }
          }
        } catch (e) {
          // thinBundle never throws by contract; if it does, still report recovery and the outcomes so far
          this.lastNotes.push(`thin: ${errText(e)}`);
          thinThrew = true;
        }
      } finally {
        for (const s of signals) process.off(s, onSignal);
        try {
          await lock.release();
        } finally {
          if (stopSignal) {
            // the caller never regains control: report this pass here (stderr keeps --json stdout clean), then exit
            // even if releasing the lock threw
            for (const line of [
              ...this.lastRecovery.map(recoveryLine),
              ...this.lastNotes,
              ...this.lastOutcomes.map(outcomeLine),
            ]) {
              console.error(`  ${line}`);
            }
            process.exit(SIGNAL_EXIT[stopSignal] ?? 1);
          }
        }
      }
    }

    const done = this.lastOutcomes.filter(
      (o) => o.status === "thinned" || o.reason === "dry-run",
    );
    const problems = [
      ...this.lastRecovery
        .filter(
          (r) =>
            r.result === "restore-failed" ||
            r.result === "unreachable" ||
            r.notes.length > 0,
        )
        .map(
          (r) =>
            `recovery ${appName(r.entry.bundle)}: ${r.result}${r.notes.length ? ` (${r.notes.join("; ")})` : ""}`,
        ),
      ...this.lastNotes,
      ...this.lastOutcomes
        .filter((o) => !done.includes(o))
        .map(
          (o) =>
            `${appName(o.app)}: ${o.status}${o.reason ? `:${o.reason}` : ""}${DETAIL_IN_ERROR.has(o.reason ?? "") && o.detail ? ` (${o.detail})` : ""}`,
        ),
    ];
    const sizeBefore = sum(
      done.flatMap((o) => o.candidates.map((c) => c.size)),
    );
    return {
      ...result,
      success:
        !thinThrew &&
        !this.lastOutcomes.some(
          (o) =>
            o.status === "aborted" ||
            o.status === "blocked" ||
            o.status === "restore-failed",
        ) &&
        !this.lastRecovery.some((r) => r.result === "restore-failed"),
      sizeBefore,
      sizeAfter: sizeBefore,
      heldBytes: sum(this.lastOutcomes.map((o) => o.heldBytes)),
      clearedPaths: done.map((o) => o.app),
      error: problems.length ? printable(problems.join("; ")) : undefined,
    };
  }

  /** `cacheInfo` is the caller's own scan (squeaky clean passes it); its paths guard against stale ids. */
  async clearByCategory(
    categoryIds: string[],
    dryRun = false,
    cacheInfo?: CacheInfo,
    protectedPaths: string[] = [],
  ): Promise<ClearResult> {
    return this.clear(
      dryRun,
      { categories: categoryIds },
      cacheInfo,
      protectedPaths,
    );
  }

  static create(): UniversalBinaryCleaner {
    return new UniversalBinaryCleaner();
  }
}

export default UniversalBinaryCleaner.create();
