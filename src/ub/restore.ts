import * as fs from "fs";
import * as path from "path";
import { codesignVerify } from "./exec";
import { backupFile } from "./backups";
import { classifySlices, readBundleInfo, readMachOSlices } from "./bundle";
import { listEntries, listIncomplete, writeEntry, type JournalEntry, type JournalFile, type JournalPhase } from "./journal";
import { isInside, makeStagingDir, mountPointOf, resolveCandidate, type AgentHome, type PathDeps } from "./paths";

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

/** runId is `<base36 ms>-<pid>-<counter>` (newRunId): order by time, then counter, then seq. Unparseable sorts oldest. */
function age(e: JournalEntry): number[] {
  const [ms, , n] = e.runId.split("-");
  return [parseInt(ms, 36) || 0, Number(n) || 0, e.seq];
}
const newer = (a: JournalEntry, b: JournalEntry) => {
  const [x, y] = [age(a), age(b)];
  const i = x.findIndex((v, k) => v !== y[k]);
  return i >= 0 && x[i] > y[i];
};

/** What an app we never thinned, or fully restored, looks like: its main executable is still universal. */
async function mainIsFat(bundleReal: string): Promise<boolean> {
  const info = await readBundleInfo(bundleReal, { allowSpawn: true });
  if (!info) return false;
  return classifySlices(await readMachOSlices(path.join(bundleReal, "Contents", "MacOS", info.executable))).thinnable;
}

/**
 * `squeaky ub restore <app>` (spec §5.2): restores from the thin's own persisted record, never from
 * "the newest backup". The record is the newest valid `done` journal entry for this bundle whose
 * backupDir still exists; it goes to restoreEntry unchanged, so the identity checks compare the app's
 * files with the thinIno/thinSize journaled at swap time (a vendor update is `superseded`, nothing written).
 * With no record nothing is written, not even the journal:
 * - `nothing-to-do` when the main executable is universal and the app was restored before or never journaled;
 * - otherwise `no-record`: squeaky cannot prove what is in the app now is what it left there.
 * Callers run recoverJournal first (ubRestoreCommand does), so an interrupted run is finished by its own entry.
 */
export async function restoreAppFromJournal(
  home: AgentHome,
  appPath: string,
  deps: RestoreDeps = {},
): Promise<{ status: RestoreStatus | "no-record"; notes: string[] }> {
  let bundleReal: string;
  try {
    bundleReal = await fs.promises.realpath(appPath);
  } catch {
    return { status: "unreachable", notes: [`bundle not found: ${appPath}`] };
  }
  const mine = (await listEntries(home)).filter((e) => e.bundle === bundleReal);
  let record: JournalEntry | undefined;
  for (const e of mine) {
    if (e.phase !== "done" || (record && !newer(e, record))) continue;
    const st = await fs.promises.lstat(e.backupDir).catch(() => null);
    if (st?.isDirectory()) record = e;
  }
  if (record) return restoreEntry(home, record, deps);

  if ((mine.length === 0 || mine.some((e) => e.phase === "restored")) && (await mainIsFat(bundleReal))) {
    return { status: "nothing-to-do", notes: [] };
  }
  return {
    status: "no-record",
    notes: [`squeaky has no completed thin of ${bundleReal} with a kept backup (backups are released after a few days, or by \`squeaky ub prune\`); nothing was changed`],
  };
}
