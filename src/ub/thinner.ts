import * as fs from "fs";
import * as path from "path";
import { classifySlices, readBundleInfo, readMachOSlices, type BundleInfo } from "./bundle";
import { classifyFile, loadSeal, type Seal } from "./seal";
import { codesignVerify, ExecTimeoutError, lipoArchs, lipoThin, processSnapshot } from "./exec";
import { backupDirFor, makeStagingDir, resolveCandidate, UnsafePathError, type AgentHome } from "./paths";
import { backupFile } from "./backups";
import { writeEntry, type JournalEntry, type JournalPhase } from "./journal";
import { restoreEntry } from "./restore";

export interface Candidate {
  /** relative to the bundle root, e.g. `Contents/MacOS/App` */
  rel: string;
  abs: string;
  size: number;
  ino: number;
  mtimeMs: number;
  /** round(size * x86SliceCount / sliceCount) */
  savings: number;
}
export interface Skipped {
  rel: string;
  reason: string;
}

export type ThinStatus = "thinned" | "rolled-back" | "skipped" | "blocked" | "aborted" | "restore-failed";
export interface ThinOutcome {
  app: string;
  status: ThinStatus;
  reason?: string;
  /** error message / restore notes behind an aborted, blocked or restore-failed outcome */
  detail?: string;
  heldBytes: number;
  candidates: Candidate[];
  skipped: Skipped[];
  backupDir?: string;
}

/** Test seams. Production passes none. `verify` replaces only thinBundle's own baseline and post-swap checks. */
export interface ThinDeps {
  copyFile?: typeof fs.promises.copyFile;
  snapshot?: () => Promise<Set<string>>;
  verify?: (app: string) => Promise<{ ok: boolean; errorText: string }>;
  afterSwap?: (filesSwapped: number) => void;
}

const WALK_DIRS = ["MacOS", "Frameworks", "Helpers", "XPCServices"];
/** v1 ceiling: nested bundles are not descended into. */
const NESTED_BUNDLE = /\.(framework|app|xpc|bundle)$/;
const MIN_FILE_SAVINGS = 65536;
export const DEFAULT_MIN_SAVINGS = 5 * 1024 * 1024;

/** Regular files below `dir` (no symlinks followed, nested bundles skipped). */
async function walk(bundleReal: string, rel: string, out: string[]): Promise<void> {
  let ents: fs.Dirent[];
  try {
    ents = await fs.promises.readdir(path.join(bundleReal, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory() && !NESTED_BUNDLE.test(e.name)) await walk(bundleReal, r, out);
    else if (e.isFile()) out.push(r);
  }
}

export async function selectCandidates(info: BundleInfo, seal: Seal): Promise<{ candidates: Candidate[]; skipped: Skipped[] }> {
  const bundleReal = info.realpath;
  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  const files: string[] = [];
  for (const d of WALK_DIRS) {
    // a symlinked top-level dir is not walked: it could lead anywhere
    const st = await fs.promises.lstat(path.join(bundleReal, "Contents", d)).catch(() => null);
    if (st?.isDirectory()) await walk(bundleReal, `Contents/${d}`, files);
  }
  const mainRel = `MacOS/${info.executable}`;
  for (const rel of files) {
    const cls = classifyFile(seal, rel.slice("Contents/".length), mainRel);
    if (cls !== "main" && cls !== "cdhash-nested") {
      skipped.push({ rel, reason: cls });
      continue;
    }
    const abs = path.join(bundleReal, rel);
    const slices = await readMachOSlices(abs);
    const c = classifySlices(slices);
    if (!c.thinnable) {
      skipped.push({ rel, reason: c.reason });
      continue;
    }
    let st: fs.Stats;
    try {
      await resolveCandidate(bundleReal, rel);
      st = await fs.promises.lstat(abs);
    } catch {
      skipped.push({ rel, reason: "unsafe-path" });
      continue;
    }
    const x86 = slices.filter((s) => s.arch === "x86_64" || s.arch === "i386").length;
    const savings = Math.round((st.size * x86) / slices.length);
    if (savings < MIN_FILE_SAVINGS) {
      skipped.push({ rel, reason: "below-min-savings" });
      continue;
    }
    candidates.push({ rel, abs, size: st.size, ino: st.ino, mtimeMs: st.mtimeMs, savings });
  }
  return { candidates, skipped };
}

/** A decided outcome thrown from deep in the pipeline. */
class Stop extends Error {
  constructor(
    readonly status: ThinStatus,
    readonly reason: string,
  ) {
    super(`${status}:${reason}`);
  }
}

function failure(err: unknown): [ThinStatus, string] {
  if (err instanceof Stop) return [err.status, err.reason];
  if (err instanceof ExecTimeoutError) return ["blocked", "timeout"];
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "EPERM" || code === "EACCES") return ["blocked", "app-management"];
  if (code === "ENOSPC") return ["aborted", "no-space"];
  return ["aborted", "error"];
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** lstat of a candidate through resolveCandidate; one that vanished or was swapped for a symlink/non-file since selection is a changed-during-thin stop, not an error. */
async function lstatCandidate(bundleReal: string, rel: string): Promise<fs.Stats> {
  try {
    return await fs.promises.lstat(await resolveCandidate(bundleReal, rel));
  } catch (err) {
    if (err instanceof UnsafePathError || (err as NodeJS.ErrnoException)?.code === "ENOENT") throw new Stop("skipped", "changed-during-thin");
    throw err;
  }
}

export async function thinBundle(
  appPath: string,
  ctx: { home: AgentHome; runId: string; seq: number; dryRun?: boolean; minSavingsBytes?: number; deps?: ThinDeps },
): Promise<ThinOutcome> {
  const { home, deps = {} } = ctx;
  const verify = deps.verify ?? codesignVerify;
  const snapshot = deps.snapshot ?? processSnapshot;
  const out: ThinOutcome = { app: appPath, status: "skipped", heldBytes: 0, candidates: [], skipped: [] };
  const end = (status: ThinStatus, reason?: string): ThinOutcome => Object.assign(out, { status, reason });

  let entry: JournalEntry | undefined;
  let stagingDir: string | undefined;
  let renamed = 0;
  const journal = async (phase: JournalPhase) => {
    entry!.phase = phase;
    await writeEntry(home, entry!);
  };

  try {
    // 1. bundle
    let bundleReal: string;
    try {
      bundleReal = await fs.promises.realpath(appPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return end("aborted", "bundle-missing");
      throw err;
    }
    const info = await readBundleInfo(bundleReal, { allowSpawn: true });
    if (!info) return end("skipped", "not-a-bundle");
    // 2-3. only a validly signed bundle with a readable seal is ever touched
    if (!(await verify(bundleReal)).ok) return end("skipped", "baseline-invalid");
    const seal = await loadSeal(bundleReal);
    if (!seal) return end("skipped", "unsigned");
    // 4. candidates
    const { candidates, skipped } = await selectCandidates(info, seal);
    out.candidates = candidates;
    out.skipped = skipped;
    const total = candidates.reduce((n, c) => n + c.savings, 0);
    if (candidates.length === 0 || total < (ctx.minSavingsBytes ?? DEFAULT_MIN_SAVINGS)) return end("skipped", "below-threshold");
    // 5. running gate
    const watched = [path.join(bundleReal, "Contents", "MacOS", info.executable), ...candidates.map((c) => c.abs)];
    const running = async () => {
      const ps = await snapshot();
      return watched.some((p) => ps.has(p));
    };
    if (await running()) return end("skipped", "running");
    // 6.
    if (ctx.dryRun) {
      out.heldBytes = total;
      return end("skipped", "dry-run");
    }

    // 7. stage thin copies on the bundle's device
    const id = `${ctx.runId}-${ctx.seq}`;
    try {
      stagingDir = await makeStagingDir(home, bundleReal, id);
    } catch (err) {
      out.detail = msg(err);
      return end("blocked", "no-staging");
    }
    const backupDir = backupDirFor(home, bundleReal, info.build, id);
    out.backupDir = backupDir;
    entry = {
      runId: ctx.runId, seq: ctx.seq, bundle: bundleReal, bundleId: info.bundleId, version: info.version, build: info.build,
      backupDir, stagingDir, phase: "staged",
      files: candidates.map((c) => ({ rel: c.rel, origIno: c.ino, origSize: c.size, origMtimeMs: c.mtimeMs })),
    };
    await journal("staged");
    const staged = (c: Candidate) => path.join(stagingDir!, c.rel + ".thin");
    for (const c of candidates) {
      await fs.promises.mkdir(path.dirname(staged(c)), { recursive: true, mode: 0o700 });
      await lipoThin(c.abs, staged(c));
      const st = await fs.promises.lstat(staged(c));
      if (!st.isFile() || st.uid !== process.getuid!()) throw new Stop("aborted", "lipo-verify");
      const archs = await lipoArchs(staged(c));
      if (archs.length !== 1 || archs[0] !== "arm64") throw new Stop("aborted", "lipo-verify");
    }

    // 8. back up originals (journaled only after ALL are final)
    for (const c of candidates) await backupFile(c.abs, path.join(backupDir, c.rel), { copyFile: deps.copyFile });
    await journal("backed-up");

    // 9. gate re-check: an app launched or updated since selection aborts before any in-bundle write
    if (await running()) throw new Stop("skipped", "running");
    const modes: number[] = [];
    for (const c of candidates) {
      const st = await lstatCandidate(bundleReal, c.rel);
      if (st.ino !== c.ino || st.size !== c.size || st.mtimeMs !== c.mtimeMs) throw new Stop("skipped", "changed-during-thin");
      modes.push(st.mode & 0o7777);
    }

    // 10. swap: the staged file is complete (mode set) and journaled by inode before it enters the bundle
    for (const [i, c] of candidates.entries()) {
      const s = staged(c);
      await fs.promises.chmod(s, modes[i]);
      const st = await fs.promises.lstat(s);
      entry.files[i].thinIno = st.ino; // rename keeps the inode
      entry.files[i].thinSize = st.size;
      await journal("swapping");
      const cur = await lstatCandidate(bundleReal, c.rel); // a parent swapped for a symlink must not redirect the rename
      const target = path.join(bundleReal, c.rel); // resolveCandidate (inside lstatCandidate) proved this path has no symlink component
      if (cur.ino !== c.ino || cur.size !== c.size) throw new Stop("skipped", "changed-during-thin");
      await fs.promises.rename(s, target);
      renamed++;
      deps.afterSwap?.(i + 1);
    }

    // 11. verify the whole bundle
    if ((await verify(bundleReal)).ok) {
      await journal("done");
      out.heldBytes = total;
      return end("thinned");
    }
    const r = await restoreEntry(home, entry);
    if (r.status === "restored") return end("rolled-back", "verify-failed");
    out.detail = r.notes.join("; ");
    return end("restore-failed", r.status);
  } catch (err) {
    const [status, reason] = failure(err);
    out.detail = msg(err);
    if (renamed > 0 && entry) {
      // the bundle has thin files in it: put the originals back (identity-checked)
      const r = await restoreEntry(home, entry).catch((e: unknown) => ({ status: "restore-failed" as const, notes: [msg(e)] }));
      if (r.status === "restored") return end(status, reason);
      out.detail = [msg(err), ...r.notes].join("; ");
      return end("restore-failed", r.status);
    }
    // nothing in the bundle was touched: drop this run's backups and retire the journal entry
    if (out.backupDir) {
      await fs.promises.rm(out.backupDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rmdir(path.dirname(out.backupDir)).catch(() => {}); // the per-bundle dir, if now empty
      out.backupDir = undefined;
    }
    if (entry) await journal("superseded").catch(() => {});
    return end(status, reason);
  } finally {
    if (stagingDir) {
      const dir = stagingDir;
      await fs.promises.rm(dir, { recursive: true, force: true }).catch((e: unknown) => {
        out.detail = [out.detail, `could not remove ${dir}: ${msg(e)}`].filter(Boolean).join("; ");
      });
    }
  }
}
