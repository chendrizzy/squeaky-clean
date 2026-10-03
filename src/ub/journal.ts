import * as fs from "fs";
import * as path from "path";
import { isInside, type AgentHome } from "./paths";

export type JournalPhase = "staged" | "backed-up" | "swapping" | "done" | "restoring" | "restored" | "superseded" | "restore-failed";

export interface JournalFile {
  rel: string;
  origIno: number;
  origSize: number;
  origMtimeMs: number;
  thinIno?: number;
  thinSize?: number;
  /** inode of the staged restore copy, journaled before its rename so a retry recognises its own result */
  restoredIno?: number;
}

export interface JournalEntry {
  runId: string;
  seq: number;
  bundle: string;
  bundleId: string | null;
  version: string;
  build: string;
  backupDir: string;
  stagingDir: string;
  files: JournalFile[];
  phase: JournalPhase;
}

const PHASES: ReadonlySet<string> = new Set<JournalPhase>([
  "staged", "backed-up", "swapping", "done", "restoring", "restored", "superseded", "restore-failed",
]);
const FINISHED: ReadonlySet<string> = new Set<JournalPhase>(["done", "restored", "superseded"]);
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isCleanAbs = (p: unknown): p is string => typeof p === "string" && path.isAbsolute(p) && path.resolve(p) === p;

function validFile(f: unknown): boolean {
  if (!isObj(f)) return false;
  const rel = f.rel;
  if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel) || rel.includes("\0")) return false;
  if (rel.split("/").some((s) => s === ".." || s === "." || s === "")) return false;
  if (!isNat(f.origIno) || !isNat(f.origSize)) return false;
  if (typeof f.origMtimeMs !== "number" || !Number.isFinite(f.origMtimeMs)) return false;
  if (f.thinIno !== undefined && !isNat(f.thinIno)) return false;
  if (f.thinSize !== undefined && !isNat(f.thinSize)) return false;
  if (f.restoredIno !== undefined && !isNat(f.restoredIno)) return false;
  return true;
}

/** Journal files are read from disk and therefore untrusted: nothing is acted on unless this passes. */
export function validateEntry(home: AgentHome, e: unknown): e is JournalEntry {
  if (!isObj(e)) return false;
  if (typeof e.runId !== "string" || !RUN_ID_RE.test(e.runId) || e.runId === "." || e.runId === "..") return false;
  if (!isNat(e.seq)) return false;
  if (typeof e.phase !== "string" || !PHASES.has(e.phase)) return false;
  if (!isCleanAbs(e.bundle) || !e.bundle.endsWith(".app")) return false;
  if (e.bundleId !== null && typeof e.bundleId !== "string") return false;
  if (typeof e.version !== "string" || typeof e.build !== "string") return false;
  if (!isCleanAbs(e.backupDir) || !isInside(e.backupDir, home.backups)) return false;
  if (!isCleanAbs(e.stagingDir)) return false;
  const crossVolume = path.basename(e.stagingDir).startsWith(`.squeaky-ub-staging-${process.getuid!()}-`);
  if (!isInside(e.stagingDir, home.staging) && !crossVolume) return false;
  if (!Array.isArray(e.files) || !e.files.every(validFile)) return false;
  return true;
}

const entryPath = (home: AgentHome, e: Pick<JournalEntry, "runId" | "seq">) => path.join(home.journal, `${e.runId}-${e.seq}.json`);

export async function writeEntry(home: AgentHome, e: JournalEntry): Promise<void> {
  const id = `${e.runId}-${e.seq}`;
  if (!validateEntry(home, e as unknown)) throw new Error(`refusing to journal an invalid entry ${id}`);
  const dest = entryPath(home, e);
  const tmp = dest + ".tmp";
  try {
    const fh = await fs.promises.open(tmp, "w", 0o600);
    try {
      await fh.writeFile(JSON.stringify(e));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.promises.rename(tmp, dest);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function removeEntry(home: AgentHome, e: JournalEntry): Promise<void> {
  await fs.promises.rm(entryPath(home, e), { force: true });
}

async function reject(home: AgentHome, name: string, why: string): Promise<void> {
  console.warn(`ub journal: rejecting ${name}: ${why}`);
  const dir = path.join(home.journal, "rejected");
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.promises.rename(path.join(home.journal, name), path.join(dir, `${Date.now().toString(36)}-${name}`)).catch(() => {});
}

export async function listIncomplete(home: AgentHome, exceptRunId: string): Promise<JournalEntry[]> {
  const names = (await fs.promises.readdir(home.journal)).filter((n) => n.endsWith(".json")).sort();
  const out: JournalEntry[] = [];
  for (const name of names) {
    const p = path.join(home.journal, name);
    let parsed: unknown;
    try {
      const st = await fs.promises.lstat(p);
      if (!st.isFile() || st.size > 16 * 1024 * 1024) throw new Error("not a regular file or too large");
      parsed = JSON.parse(await fs.promises.readFile(p, "utf8"));
    } catch (err) {
      await reject(home, name, `unreadable: ${(err as Error).message}`);
      continue;
    }
    if (!validateEntry(home, parsed) || name !== `${parsed.runId}-${parsed.seq}.json`) {
      await reject(home, name, "failed validation");
      continue;
    }
    if (parsed.runId !== exceptRunId && !FINISHED.has(parsed.phase)) out.push(parsed);
  }
  return out;
}
