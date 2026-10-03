import * as fs from "fs";
import * as path from "path";
import { codesignVerify } from "./exec";
import { backupFile } from "./backups";
import { classifySlices, readMachOSlices } from "./bundle";
import { listIncomplete, writeEntry, type JournalEntry, type JournalFile, type JournalPhase } from "./journal";
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

/** Stage the backup on the bundle's device, prove it is the original, then rename it over our thin. */
async function swapBack(f: JournalFile, target: string, backup: string, staged: string, persist: () => Promise<void>): Promise<void> {
  await backupFile(backup, staged);
  const st = await fs.promises.lstat(staged);
  if (st.size !== f.origSize) throw new Error(`${f.rel}: backup size differs from the journaled original size`);
  // the journal has no arch set; every candidate was selected by exactly this predicate
  if (!classifySlices(await readMachOSlices(staged)).thinnable) throw new Error(`${f.rel}: backup is not a fat arm64+x86_64 Mach-O`);
  const cur = await fs.promises.lstat(target); // pass 1 was a while ago: still our thin?
  if (cur.ino !== f.thinIno || cur.size !== f.thinSize) throw new Error(`${f.rel}: changed during restore; not overwriting`);
  f.restoredIno = st.ino; // rename keeps the inode; journal it first so a retry knows this file is ours
  await persist();
  await fs.promises.rename(staged, target);
}

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
      const modes: number[] = [];
      for (const { f } of todo) modes.push(await checkBackup(backupsReal, f, path.join(e.backupDir, f.rel)));
      for (const [i, { f, thin }] of todo.entries()) {
        const target = path.join(bundleReal, f.rel);
        if (thin) {
          if (!stagingDir) stagingDir = await makeStagingDir(home, bundleReal, `${e.runId}-${e.seq}-restore-${Date.now().toString(36)}`, deps);
          await swapBack(f, target, path.join(e.backupDir, f.rel), path.join(stagingDir, f.rel + ".restore"), () => setPhase("restoring"));
        }
        await fs.promises.chmod(target, modes[i]);
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
    if (stagingDir) await fs.promises.rm(stagingDir, { recursive: true, force: true });
  }
  await setPhase(status === "nothing-to-do" ? "restored" : status);
  return { status, notes };
}

/** Journal entries are untrusted: only remove a staging dir that sits where we would have made it. Returns a note when it refuses. */
async function removeStaging(home: AgentHome, e: JournalEntry, deps: PathDeps): Promise<string | undefined> {
  const parent = path.dirname(e.stagingDir);
  const ok = parent === home.staging || parent === (await mountPointOf(e.bundle, deps).catch(() => null));
  if (!ok) return `left ${e.stagingDir} in place: not a squeaky staging location`;
  await fs.promises.rm(e.stagingDir, { recursive: true, force: true });
  return undefined;
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
    let result: RestoreStatus | "cleaned";
    if (entry.phase === "staged" || entry.phase === "backed-up") {
      const refused = await removeStaging(home, entry, deps);
      if (refused) notes.push(refused);
      // backupDirFor shape: <backups>/<hash>/<name>; refuse anything shallower (would take sibling backups with it)
      if (path.dirname(path.dirname(entry.backupDir)) === home.backups) {
        await fs.promises.rm(entry.backupDir, { recursive: true, force: true });
        await fs.promises.rmdir(path.dirname(entry.backupDir)).catch(() => {});
      } else notes.push(`left ${entry.backupDir} in place: not a squeaky backup location`);
      await writeEntry(home, { ...entry, phase: "superseded" });
      result = "cleaned";
    } else {
      const r = await restoreEntry(home, entry, deps);
      notes.push(...r.notes);
      if (TERMINAL.has(r.status)) {
        // the crashed thin run's own staging; the restore's own staging was already removed by restoreEntry
        const refused = await removeStaging(home, entry, deps);
        if (refused) notes.push(refused);
      }
      result = r.status;
    }
    out.push({ entry, result, notes });
  }
  return out;
}
