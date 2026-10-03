import * as fs from "fs";
import * as path from "path";
import { run } from "./exec";
import { RUN_ID_RE } from "./journal";
import type { AgentHome } from "./paths";

export interface LockHandle {
  runId: string;
  release(): Promise<void>;
}

interface LockInfo {
  runId: string;
  pid: number;
  processStart: string;
}

let counter = 0;
/** `${base36 ms}-${pid}-${per-process counter}`; separator-free (ruling R1a). */
export function newRunId(): string {
  return `${Date.now().toString(36)}-${process.pid}-${counter++}`;
}

/** The run lock. "agent busy" errors name it so a user can see what is held. */
export const lockPath = (home: AgentHome) => path.join(home.home, "agent.lock");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parse(raw: string): LockInfo | null {
  try {
    const j = JSON.parse(raw) as Partial<LockInfo>;
    if (
      typeof j.runId === "string" &&
      RUN_ID_RE.test(j.runId) &&
      typeof j.processStart === "string" &&
      Number.isInteger(j.pid) &&
      (j.pid as number) > 0
    ) {
      return { runId: j.runId, pid: j.pid as number, processStart: j.processStart };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

/** null when missing OR empty/unparseable/invalid. */
export async function readLock(home: AgentHome): Promise<LockInfo | null> {
  try {
    return parse(await fs.promises.readFile(lockPath(home), "utf8"));
  } catch {
    return null;
  }
}

// Fixed locale/zone: lstart is %c in local time, so writer and checker must agree.
const PS_ENV = { LC_ALL: "C", TZ: "UTC0" };

async function processStartOf(pid: number): Promise<string | null> {
  try {
    const r = await run("/bin/ps", ["-o", "lstart=", "-p", String(pid)], 10_000, { env: PS_ENV });
    const s = r.stdout.trim();
    return r.code === 0 && s ? s : null;
  } catch {
    return null;
  }
}

/** Dead pid or start-time mismatch. Any uncertainty => alive. */
async function isStale(l: LockInfo): Promise<boolean> {
  try {
    process.kill(l.pid, 0);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
  const start = await processStartOf(l.pid);
  return start !== null && start !== l.processStart;
}

async function rmQuiet(p: string): Promise<void> {
  await fs.promises.unlink(p).catch(() => undefined);
}

/** A lock or claim file as read: its inode, raw text and holder (null when it does not parse). */
interface Seen {
  ino: number;
  raw: string;
  holder: LockInfo | null;
}

async function look(p: string): Promise<Seen | null> {
  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(p, "r");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  try {
    const raw = await fh.readFile("utf8");
    return { ino: (await fh.stat()).ino, raw, holder: parse(raw) };
  } finally {
    await fh.close();
  }
}

/**
 * A file that does not parse gets one full poll to become valid: its writer is between O_EXCL create
 * and write for microseconds, but a crash there (or power loss before the data reached disk) leaves it
 * empty or torn for good. Returned with `holder: null` when still unparseable after the poll (stale);
 * null when it is gone or was replaced meanwhile (the caller retries).
 */
async function settle(p: string, pollMs: number): Promise<Seen | null> {
  const first = await look(p);
  if (!first || first.holder) return first;
  await sleep(pollMs);
  const again = await look(p);
  return again && again.ino === first.ino ? again : null;
}

const same = (a: Seen, b: Seen) => a.ino === b.ino && a.raw === b.raw;
const dead = async (s: Seen) => !s.holder || (await isStale(s.holder));

/** O_EXCL create, write, fsync. The inode, or null when the name exists. */
async function writeExcl(p: string, content: string): Promise<number | null> {
  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(p, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw e;
  }
  try {
    await fh.writeFile(content);
    await fh.sync(); // without it a crash can persist the create but not the content: an empty lock
    return (await fh.stat()).ino;
  } finally {
    await fh.close();
  }
}

type Attempt = LockHandle | "busy" | "retry";

async function createLock(home: AgentHome, runId: string, start: string): Promise<LockHandle | "exists"> {
  const p = lockPath(home);
  const ino = await writeExcl(p, JSON.stringify({ runId, pid: process.pid, processStart: start }));
  // a writer stalled for a full poll before its write may have been judged stale and displaced
  if (ino === null || (await look(p))?.ino !== ino) return "exists";
  return {
    runId,
    async release() {
      const cur = await readLock(home);
      if (cur && cur.runId === runId) await rmQuiet(p);
    },
  };
}

/**
 * rename(p, aside), then confirm the moved file is the one judged; one replaced since is linked back
 * and `aside` removed. "gone": nothing at p. "moved": the judged file is now at `aside`.
 */
async function moveAside(p: string, judged: Seen, aside: string): Promise<"gone" | "moved" | "changed"> {
  try {
    await fs.promises.rename(p, aside);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "gone";
    throw e;
  }
  const moved = await look(aside);
  if (moved && same(moved, judged)) return "moved";
  // ponytail: POSIX has no compare-and-swap rename, so a file created at p inside this put-back window
  // loses the link and two takeovers can overlap (needs 3 racers in one interleaving). flock(2) closes it; needs a native addon.
  await fs.promises.link(aside, p).catch(() => undefined);
  await rmQuiet(aside);
  return "changed";
}

async function attempt(home: AgentHome, runId: string, start: string, pollMs: number): Promise<Attempt> {
  const made = await createLock(home, runId, start);
  if (made !== "exists") return made;

  const p = lockPath(home);
  const seen = await settle(p, pollMs);
  if (!seen) return "retry";
  if (!(await dead(seen))) return "busy";

  // Takeover, one racer at a time. The claim is an O_EXCL file naming its claimer, so a claimer that
  // died mid-takeover is judged like a lock holder and its claim cleared instead of wedging every later run.
  const claim = `${p}.claim`;
  const claimIno = await writeExcl(claim, JSON.stringify({ runId, pid: process.pid, processStart: start }));
  if (claimIno === null) {
    const c = await settle(claim, pollMs);
    if (!c) return "retry";
    if (!(await dead(c))) return "busy";
    const r = await moveAside(claim, c, `${p}.dead-${runId}`);
    if (r === "moved") await rmQuiet(`${p}.dead-${runId}`);
    return r === "changed" ? "busy" : "retry";
  }
  // same guard as createLock: stalled for a poll before its write, this claim may have been cleared as
  // dead and replaced; then it is not ours to act on, nor to unlink
  if ((await look(claim))?.ino !== claimIno) return "retry";
  const stale = `${p}.stale-${runId}`;
  try {
    // the claim does not pin which lock was judged: a racer may have replaced it since
    const now = await look(p);
    if (!now) return "retry";
    if (!same(now, seen)) return "busy";
    // ...and again across the rename: a lock replaced inside that window is put back, never displaced
    if ((await moveAside(p, seen, stale)) !== "moved") return "retry";
    const got = await createLock(home, runId, start);
    return got === "exists" ? "retry" : got;
  } finally {
    await rmQuiet(claim);
    await rmQuiet(stale);
  }
}

export async function acquireLock(
  home: AgentHome,
  opts: { waitMs: number; pollMs?: number },
): Promise<LockHandle | null> {
  const runId = newRunId();
  const start = await processStartOf(process.pid);
  if (!start) throw new Error("cannot determine own process start time");
  const deadline = Date.now() + opts.waitMs;
  const poll = opts.pollMs ?? 250;
  for (let retries = 0; ; ) {
    const r = await attempt(home, runId, start, poll);
    if (typeof r === "object") return r;
    if (r === "retry" && retries++ < 20) continue;
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(poll, Math.max(1, deadline - Date.now())));
  }
}
