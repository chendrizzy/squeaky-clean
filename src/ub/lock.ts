import * as fs from "fs";
import * as path from "path";
import { run } from "./exec";
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

const lockPath = (home: AgentHome) => path.join(home.home, "agent.lock");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");

function parse(raw: string): LockInfo | null {
  try {
    const j = JSON.parse(raw) as Partial<LockInfo>;
    if (
      typeof j.runId === "string" &&
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

/** null when missing OR empty/unparseable (callers treat unparseable as held-alive). */
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

/** Stale ONLY on dead pid or start-time mismatch. Any uncertainty => alive. */
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

type Attempt = LockHandle | "busy" | "retry";

async function createLock(home: AgentHome, runId: string, start: string): Promise<LockHandle | "exists"> {
  const p = lockPath(home);
  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(p, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return "exists";
    throw e;
  }
  try {
    await fh.writeFile(JSON.stringify({ runId, pid: process.pid, processStart: start }));
  } finally {
    await fh.close();
  }
  return {
    runId,
    async release() {
      const cur = await readLock(home);
      if (cur && cur.runId === runId) await rmQuiet(p);
    },
  };
}

async function attempt(home: AgentHome, runId: string, start: string): Promise<Attempt> {
  const made = await createLock(home, runId, start);
  if (made !== "exists") return made;

  const p = lockPath(home);
  const seen = await readLock(home);
  if (!seen) {
    // Missing (released/taken over: retry now) or empty/unparseable (held-alive: wait).
    return fs.existsSync(p) ? "busy" : "retry";
  }
  if (!(await isStale(seen))) return "busy";

  // Takeover. Claim exclusivity per observed stale runId with a hard link to the
  // lock itself, so only one racer may displace that exact holder and nobody can
  // rename away a live lock that replaced it.
  const claim = `${p}.claim-${safeName(seen.runId)}`;
  const stale = `${p}.stale-${safeName(runId)}`;
  try {
    await fs.promises.link(p, claim);
  } catch (e) {
    const c = (e as NodeJS.ErrnoException).code;
    return c === "ENOENT" ? "retry" : c === "EEXIST" ? "busy" : Promise.reject(e);
  }
  try {
    const linked = parse(await fs.promises.readFile(claim, "utf8").catch(() => ""));
    if (!linked || linked.runId !== seen.runId) return "busy"; // lock changed under us
    try {
      await fs.promises.rename(p, stale);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "retry";
      throw e;
    }
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
    const r = await attempt(home, runId, start);
    if (typeof r === "object") return r;
    if (r === "retry" && retries++ < 20) continue;
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(poll, Math.max(1, deadline - Date.now())));
  }
}
