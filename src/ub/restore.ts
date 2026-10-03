import * as fs from "fs";
import * as path from "path";
import { codesignVerify } from "./exec";
import { backupFile } from "./backups";
import { listIncomplete, writeEntry, type JournalEntry, type JournalFile, type JournalPhase } from "./journal";
import { makeStagingDir, mountPointOf, resolveCandidate, type AgentHome } from "./paths";

export type RestoreStatus = "restored" | "nothing-to-do" | "superseded" | "restore-failed" | "unreachable";

export interface RestoreDeps {
  verify?: (app: string) => Promise<{ ok: boolean; errorText: string }>;
}

type FileOutcome = "restored" | "nothing" | "superseded" | "failed";

/** Backups are stored at `<entry.backupDir>/<rel>` (rel is bundle-root-relative). */
async function restoreFile(
  e: JournalEntry,
  f: JournalFile,
  bundleReal: string,
  stagingDir: string,
  notes: string[],
): Promise<FileOutcome> {
  let target: string;
  try {
    target = await resolveCandidate(bundleReal, f.rel);
  } catch (err) {
    notes.push(`${f.rel}: ${(err as Error).message}`);
    return "failed";
  }
  const cur = await fs.promises.lstat(target);
  if (f.thinIno === undefined || (cur.ino === f.origIno && cur.size === f.origSize)) return "nothing";
  if (cur.ino !== f.thinIno || cur.size !== f.thinSize) {
    notes.push(`${f.rel}: changed since it was thinned; not overwriting`);
    return "superseded";
  }
  try {
    const backup = path.join(e.backupDir, f.rel);
    const staged = path.join(stagingDir, f.rel + ".restore");
    const mode = (await fs.promises.stat(backup)).mode & 0o7777;
    await backupFile(backup, staged);
    if ((await fs.promises.stat(staged)).size !== f.origSize) throw new Error("backup size differs from the journaled original size");
    await fs.promises.rename(staged, target);
    await fs.promises.chmod(target, mode);
    return "restored";
  } catch (err) {
    notes.push(`${f.rel}: ${(err as Error).message}`);
    return "failed";
  }
}

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

  const stagingDir = await makeStagingDir(home, bundleReal, `${e.runId}-${e.seq}-restore-${Date.now().toString(36)}`);
  let status: RestoreStatus;
  try {
    const outcomes: FileOutcome[] = [];
    for (const f of e.files) outcomes.push(await restoreFile(e, f, bundleReal, stagingDir, notes));
    if (outcomes.includes("failed")) {
      status = "restore-failed";
    } else if (outcomes.length > 0 && outcomes.every((o) => o === "superseded")) {
      status = "superseded";
    } else if (outcomes.includes("restored")) {
      const v = await (deps.verify ?? codesignVerify)(bundleReal);
      if (v.ok) status = "restored";
      else {
        status = "restore-failed";
        notes.push(`codesign verify failed after restore: ${v.errorText}`);
      }
    } else {
      status = "nothing-to-do";
    }
  } catch (err) {
    status = "restore-failed";
    notes.push((err as Error).message);
  } finally {
    await fs.promises.rm(stagingDir, { recursive: true, force: true });
  }
  await setPhase(status === "nothing-to-do" ? "restored" : status);
  return { status, notes };
}

/** Journal entries are untrusted: only remove a staging dir that sits where we would have made it. */
async function removeStaging(home: AgentHome, e: JournalEntry): Promise<void> {
  const parent = path.dirname(e.stagingDir);
  let ok = parent === home.staging;
  if (!ok) ok = parent === (await mountPointOf(e.bundle).catch(() => null));
  if (!ok) {
    console.warn(`ub recover: leaving ${e.stagingDir} (not a squeaky staging location)`);
    return;
  }
  await fs.promises.rm(e.stagingDir, { recursive: true, force: true });
}

export async function recoverJournal(
  home: AgentHome,
  currentRunId: string,
  deps: RestoreDeps = {},
): Promise<Array<{ entry: JournalEntry; result: RestoreStatus | "cleaned" }>> {
  const out: Array<{ entry: JournalEntry; result: RestoreStatus | "cleaned" }> = [];
  for (const entry of await listIncomplete(home, currentRunId)) {
    if (entry.phase === "staged" || entry.phase === "backed-up") {
      await removeStaging(home, entry);
      // backupDirFor shape: <backups>/<hash>/<name>; refuse anything shallower (would take sibling backups with it)
      if (path.dirname(path.dirname(entry.backupDir)) === home.backups) {
        await fs.promises.rm(entry.backupDir, { recursive: true, force: true });
        await fs.promises.rmdir(path.dirname(entry.backupDir)).catch(() => {});
      }
      await writeEntry(home, { ...entry, phase: "superseded" });
      out.push({ entry, result: "cleaned" });
    } else {
      out.push({ entry, result: (await restoreEntry(home, entry, deps)).status });
    }
  }
  return out;
}
