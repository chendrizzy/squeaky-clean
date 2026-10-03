import * as fs from "fs";
import * as path from "path";
import { codesignVerify } from "./exec";
import { backupFile } from "./backups";
import { classifySlices, readBundleInfo, readMachOSlices } from "./bundle";
import { listIncomplete, writeEntry, type JournalEntry, type JournalFile, type JournalPhase } from "./journal";
import { newRunId } from "./lock";
import {
  bundleHash, isInside, makeStagingDir, mountPointOf, resolveCandidate, sanitizeComponent, type AgentHome, type PathDeps,
} from "./paths";

export type RestoreStatus = "restored" | "nothing-to-do" | "superseded" | "restore-failed" | "unreachable";

export interface RestoreDeps extends PathDeps {
  verify?: (app: string) => Promise<{ ok: boolean; errorText: string }>;
}

/** ours = our restored copy from an earlier attempt; thin = what the thinner left; orig = never swapped. */
type FileClass = "ours" | "thin" | "orig" | "foreign" | "error";

const msg = (err: unknown) => (err as Error).message;

/** Pass 1, no writes: what is at this file's path now, against what the journal says we left there. */
async function classify(bundleReal: string, f: JournalFile, notes: string[]): Promise<FileClass> {
  let st: fs.Stats;
  try {
    // own lstat first: resolveCandidate does not keep the errno, and only "provably gone" may supersede
    st = await fs.promises.lstat(path.join(bundleReal, f.rel));
  } catch (err) {
    notes.push(`${f.rel}: ${msg(err)}`);
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "foreign" : "error";
  }
  if (!st.isFile()) {
    notes.push(`${f.rel}: no longer a regular file`);
    return "foreign";
  }
  try {
    await resolveCandidate(bundleReal, f.rel);
  } catch (err) {
    notes.push(`${f.rel}: ${msg(err)}`);
    return "error";
  }
  if (f.restoredIno !== undefined && st.ino === f.restoredIno && st.size === f.origSize) return "ours";
  if (f.thinIno !== undefined && st.ino === f.thinIno && st.size === f.thinSize) return "thin";
  if (st.ino === f.origIno && st.size === f.origSize) return "orig";
  notes.push(`${f.rel}: changed since it was thinned; not overwriting`);
  return "foreign";
}

/** Only a regular file whose realpath is inside backups/ is ever read. Returns its mode. */
async function checkBackup(backupsReal: string, f: JournalFile, backup: string): Promise<number> {
  const st = await fs.promises.lstat(backup);
  if (!st.isFile()) throw new Error(`${f.rel}: backup is not a regular file`);
  if (!isInside(await fs.promises.realpath(backup), backupsReal)) throw new Error(`${f.rel}: backup resolves outside the backups dir`);
  return st.mode & 0o7777;
}

/** Stage the backup on the bundle's device and prove it is the original. Nothing in the bundle is touched. */
async function stageOriginal(f: JournalFile, backup: string, staged: string, mode: number): Promise<void> {
  await backupFile(backup, staged);
  const st = await fs.promises.lstat(staged);
  if (st.size !== f.origSize) throw new Error(`${f.rel}: backup size differs from the journaled original size`);
  // the journal has no arch set; every candidate was selected by exactly this predicate
  if (!classifySlices(await readMachOSlices(staged)).thinnable) throw new Error(`${f.rel}: backup is not a fat arm64+x86_64 Mach-O`);
  await fs.promises.chmod(staged, mode); // complete before it ever appears in the bundle
  f.restoredIno = st.ino; // rename keeps the inode; journaled before the first rename so a retry knows this file is ours
}

/** Rename a staged original over our thin. Pass 1 was a while ago, so containment and identity are re-checked first. */
async function swapIn(bundleReal: string, f: JournalFile, staged: string): Promise<void> {
  const target = await resolveCandidate(bundleReal, f.rel); // a parent swapped for a symlink must not redirect the rename
  const cur = await fs.promises.lstat(target);
  if (cur.ino !== f.thinIno || cur.size !== f.thinSize) throw new Error(`${f.rel}: changed during restore; not overwriting`);
  await fs.promises.rename(staged, target);
}

/** rm -rf that reports instead of throwing: one stuck dir must not abort recovery of the other entries. */
const rmNote = (dir: string): Promise<string | undefined> =>
  fs.promises.rm(dir, { recursive: true, force: true }).then(
    () => undefined,
    (err: unknown) => `could not remove ${dir}: ${msg(err)}`,
  );

/** Backups are stored at `<entry.backupDir>/<rel>` (rel is bundle-root-relative). */
export async function restoreEntry(
  home: AgentHome,
  e: JournalEntry,
  deps: RestoreDeps = {},
): Promise<{ status: RestoreStatus; notes: string[] }> {
  const notes: string[] = [];
  let bundleReal: string;
  try {
    bundleReal = await fs.promises.realpath(e.bundle);
  } catch {
    return { status: "unreachable", notes: [`bundle not found: ${e.bundle}`] };
  }
  const setPhase = (phase: JournalPhase) => writeEntry(home, { ...e, phase });
  await setPhase("restoring");

  let stagingDir: string | undefined;
  let status: RestoreStatus;
  try {
    const classes: FileClass[] = [];
    for (const f of e.files) classes.push(await classify(bundleReal, f, notes));
    const todo = e.files.flatMap((f, i) => (classes[i] === "thin" || classes[i] === "ours" ? [{ f, thin: classes[i] === "thin" }] : []));
    // an unclassifiable file blocks the decision: superseded is terminal and makes the backup pruneable
    if (classes.includes("error")) status = "restore-failed";
    else if (classes.includes("foreign")) status = "superseded";
    else if (todo.length === 0) status = "nothing-to-do";
    else {
      const backupsReal = await fs.promises.realpath(home.backups);
      // stage and prove every original before the first rename: a bad backup leaves the bundle untouched
      const jobs: Array<{ f: JournalFile; mode: number; staged?: string }> = [];
      for (const { f, thin } of todo) {
        const backup = path.join(e.backupDir, f.rel);
        const mode = await checkBackup(backupsReal, f, backup);
        let staged: string | undefined;
        if (thin) {
          if (!stagingDir) stagingDir = await makeStagingDir(home, bundleReal, `${e.runId}-${e.seq}-restore-${Date.now().toString(36)}`, deps);
          staged = path.join(stagingDir, f.rel + ".restore");
          await stageOriginal(f, backup, staged, mode);
        }
        jobs.push({ f, mode, staged });
      }
      await setPhase("restoring"); // journals every restoredIno before the first rename
      for (const { f, mode, staged } of jobs) {
        if (staged) await swapIn(bundleReal, f, staged);
        else await fs.promises.chmod(await resolveCandidate(bundleReal, f.rel), mode); // ours: renamed by an earlier attempt
      }
      const v = await (deps.verify ?? codesignVerify)(bundleReal);
      if (v.ok) status = "restored";
      else {
        status = "restore-failed";
        notes.push(`codesign verify failed after restore: ${v.errorText}`);
      }
    }
  } catch (err) {
    status = "restore-failed";
    notes.push(msg(err));
  } finally {
    const failed = stagingDir && (await rmNote(stagingDir));
    if (failed) notes.push(failed);
  }
  await setPhase(status === "nothing-to-do" ? "restored" : status);
  return { status, notes };
}

/** Journal entries are untrusted: only remove a staging dir that sits where we would have made it. Returns a note when it refuses. */
async function removeStaging(home: AgentHome, e: JournalEntry, deps: PathDeps): Promise<string | undefined> {
  const parent = path.dirname(e.stagingDir);
  const ok = parent === home.staging || parent === (await mountPointOf(e.bundle, deps).catch(() => null));
  if (!ok) return `left ${e.stagingDir} in place: not a squeaky staging location`;
  return rmNote(e.stagingDir);
}

const TERMINAL: ReadonlySet<RestoreStatus> = new Set<RestoreStatus>(["restored", "superseded", "nothing-to-do"]);

export async function recoverJournal(
  home: AgentHome,
  currentRunId: string,
  deps: RestoreDeps = {},
): Promise<Array<{ entry: JournalEntry; result: RestoreStatus | "cleaned"; notes: string[] }>> {
  const out: Array<{ entry: JournalEntry; result: RestoreStatus | "cleaned"; notes: string[] }> = [];
  for (const entry of await listIncomplete(home, currentRunId)) {
    const notes: string[] = [];
    const note = (n: string | undefined) => n && notes.push(n);
    let result: RestoreStatus | "cleaned";
    if (entry.phase === "staged" || entry.phase === "backed-up") {
      note(await removeStaging(home, entry, deps));
      // backupDirFor shape: <backups>/<hash>/<name>; refuse anything shallower (would take sibling backups with it)
      if (path.dirname(path.dirname(entry.backupDir)) === home.backups) {
        note(await rmNote(entry.backupDir));
        await fs.promises.rmdir(path.dirname(entry.backupDir)).catch(() => {});
      } else note(`left ${entry.backupDir} in place: not a squeaky backup location`);
      await writeEntry(home, { ...entry, phase: "superseded" });
      result = "cleaned";
    } else {
      const r = await restoreEntry(home, entry, deps);
      notes.push(...r.notes);
      if (TERMINAL.has(r.status)) {
        // the crashed thin run's own staging; the restore's own staging was already removed by restoreEntry
        note(await removeStaging(home, entry, deps));
      }
      result = r.status;
    }
    out.push({ entry, result, notes });
  }
  return out;
}

/** The most recently written `backups/<h>/<name>` dir for this bundle; symlinks are never followed. */
async function newestBackupDir(home: AgentHome, bundleReal: string): Promise<string | null> {
  const hd = path.join(home.backups, bundleHash(bundleReal));
  const hst = await fs.promises.lstat(hd).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (!hst?.isDirectory()) return null;
  let best: { dir: string; mtimeMs: number } | null = null;
  for (const name of await fs.promises.readdir(hd)) {
    const dir = path.join(hd, name);
    const st = await fs.promises.lstat(dir);
    if (st.isDirectory() && (!best || st.mtimeMs > best.mtimeMs)) best = { dir, mtimeMs: st.mtimeMs };
  }
  return best?.dir ?? null;
}

/** Regular files under dir as `/`-joined relative paths; symlinks and other node types are ignored, never followed. */
async function listBackupFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await fs.promises.readdir(dir)).sort()) {
    const st = await fs.promises.lstat(path.join(dir, name));
    const rel = prefix ? `${prefix}/${name}` : name;
    if (st.isDirectory()) out.push(...(await listBackupFiles(path.join(dir, name), rel)));
    else if (st.isFile()) out.push(rel);
  }
  return out;
}

/**
 * `squeaky ub restore <app>`: puts back the originals from the app's newest backup. The journal entry
 * of that thin may be long gone, so a synthetic one is built and handed to restoreEntry, whose identity
 * checks then hold: thinIno/thinSize are the CURRENT file's, and only when it is arm64-only (what the
 * thinner leaves); origIno is the backup's own inode, which cannot be the current file. A missing file,
 * a file that is not arm64-only, or a build that differs from the one the backup was taken of means the
 * app changed since → `superseded`, nothing written (not even the journal).
 * Callers run recoverJournal first (ubRestoreCommand does), so an interrupted run is finished by its own entry.
 */
export async function restoreAppFromNewestBackup(
  home: AgentHome,
  appPath: string,
  deps: RestoreDeps = {},
): Promise<{ status: RestoreStatus; notes: string[] }> {
  let bundleReal: string;
  try {
    bundleReal = await fs.promises.realpath(appPath);
  } catch {
    return { status: "unreachable", notes: [`bundle not found: ${appPath}`] };
  }
  const backupDir = await newestBackupDir(home, bundleReal);
  if (!backupDir) return { status: "nothing-to-do", notes: [`no backup found for ${bundleReal}`] };

  const info = await readBundleInfo(bundleReal, { allowSpawn: true });
  if (!info || !path.basename(backupDir).startsWith(`${sanitizeComponent(info.build)}-`)) {
    return { status: "superseded", notes: [`the app's build changed since ${backupDir} was taken; not restoring`] };
  }

  const notes: string[] = [];
  const files: JournalFile[] = [];
  let foreign = false;
  let error = false;
  for (const rel of await listBackupFiles(backupDir)) {
    const backup = await fs.promises.lstat(path.join(backupDir, rel));
    let cur: fs.Stats;
    try {
      cur = await fs.promises.lstat(path.join(bundleReal, rel));
    } catch (err) {
      notes.push(`${rel}: ${msg(err)}`);
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") foreign = true;
      else error = true;
      continue;
    }
    if (!cur.isFile()) {
      notes.push(`${rel}: no longer a regular file`);
      foreign = true;
      continue;
    }
    let abs: string;
    try {
      abs = await resolveCandidate(bundleReal, rel);
    } catch (err) {
      notes.push(`${rel}: ${msg(err)}`);
      error = true;
      continue;
    }
    const slices = await readMachOSlices(abs);
    if (slices.length !== 1 || slices[0].arch !== "arm64") {
      notes.push(`${rel}: not the arm64-only file the thinner leaves; not overwriting`);
      foreign = true;
      continue;
    }
    files.push({ rel, origIno: backup.ino, origSize: backup.size, origMtimeMs: backup.mtimeMs, thinIno: cur.ino, thinSize: cur.size });
  }
  // same precedence as restoreEntry: an unreadable file blocks the decision rather than superseding
  if (error) return { status: "restore-failed", notes };
  if (foreign) return { status: "superseded", notes };
  if (files.length === 0) return { status: "nothing-to-do", notes: [`${backupDir} holds no files`] };

  const runId = newRunId();
  const entry: JournalEntry = {
    runId, seq: 0, bundle: bundleReal, bundleId: info.bundleId, version: info.version, build: info.build,
    backupDir, stagingDir: path.join(home.staging, `${runId}-0`), files, phase: "restoring",
  };
  return restoreEntry(home, entry, deps);
}
