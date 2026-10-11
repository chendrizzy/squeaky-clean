import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

export interface AgentHome {
  home: string;
  staging: string;
  backups: string;
  journal: string;
}

export class AgentHomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentHomeError";
  }
}
export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}
export class NoStagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoStagingError";
  }
}

export function agentHomeDir(): string {
  const override = process.env.SQUEAKY_AGENT_HOME;
  if (override && (process.env.VITEST || process.env.NODE_ENV === "test")) return override;
  return path.join(os.homedir(), "Library", "Application Support", "squeaky-clean");
}

async function ensureSecureDir(dir: string): Promise<void> {
  let st = await fs.promises.lstat(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (!st) {
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(dir, 0o700); // mkdir mode is subject to umask
    st = await fs.promises.lstat(dir);
  }
  if (st.isSymbolicLink()) throw new AgentHomeError(`${dir} is a symlink`);
  if (!st.isDirectory()) throw new AgentHomeError(`${dir} is not a directory`);
  if (st.uid !== process.getuid!()) throw new AgentHomeError(`${dir} is not owned by the current user`);
  if ((st.mode & 0o077) !== 0) throw new AgentHomeError(`${dir} is accessible by group/other (mode ${(st.mode & 0o777).toString(8)})`);
}

export async function ensureAgentHome(): Promise<AgentHome> {
  const home = agentHomeDir();
  const h: AgentHome = {
    home,
    staging: path.join(home, "staging"),
    backups: path.join(home, "backups"),
    journal: path.join(home, "journal"),
  };
  for (const d of [h.home, h.staging, h.backups, h.journal]) await ensureSecureDir(d);
  return h;
}

export function isInside(child: string, parent: string): boolean {
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep) && child !== parent;
}

export async function resolveCandidate(bundleReal: string, rel: string): Promise<string> {
  if (path.isAbsolute(rel)) throw new UnsafePathError(`absolute path: ${rel}`);
  const segs = rel.split(path.sep);
  if (segs.some((s) => s === ".." || s === "." || s === "")) throw new UnsafePathError(`unsafe segment in: ${rel}`);
  let cur = bundleReal;
  let st: fs.Stats | undefined;
  for (const seg of segs) {
    cur = path.join(cur, seg);
    try {
      st = await fs.promises.lstat(cur);
    } catch {
      throw new UnsafePathError(`cannot stat ${cur}`);
    }
    if (st.isSymbolicLink()) throw new UnsafePathError(`symlink component: ${cur}`);
  }
  if (!st || !st.isFile()) throw new UnsafePathError(`not a regular file: ${cur}`);
  const real = await fs.promises.realpath(cur).catch(() => {
    throw new UnsafePathError(`cannot resolve ${cur}`);
  });
  if (!isInside(real, bundleReal)) throw new UnsafePathError(`escapes bundle: ${real}`);
  return cur;
}

/**
 * Opens a path from an untrusted bundle for reading, never blocking: O_NONBLOCK keeps a FIFO from hanging the open, and
 * the HANDLE must fstat as a regular file of at most maxBytes (a symlink to a regular file is fine). A FIFO, device,
 * socket or directory throws UnsafePathError. The caller closes the handle.
 */
export async function openRegularFile(p: string, maxBytes = Infinity): Promise<{ fh: fs.promises.FileHandle; st: fs.Stats }> {
  const fh = await fs.promises.open(p, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new UnsafePathError(`not a regular file: ${p}`);
    if (st.size > maxBytes) throw new UnsafePathError(`larger than ${maxBytes} bytes: ${p}`);
    return { fh, st };
  } catch (e) {
    await fh.close().catch(() => {});
    throw e;
  }
}

/** The whole of a regular file (see openRegularFile), read from the checked handle and never past its fstat size. */
export async function readRegularFile(p: string, maxBytes: number): Promise<Buffer> {
  const { fh, st } = await openRegularFile(p, maxBytes);
  try {
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    return buf.subarray(0, n);
  } finally {
    await fh.close();
  }
}

export function sanitizeComponent(s: string): string {
  const r = s.replace(/[^A-Za-z0-9._-]/g, "_");
  return r === "" || r === "." || r === ".." ? "_" : r;
}

export interface PathDeps {
  stat?: typeof fs.promises.stat;
}

/** Walk up from p until the parent is on another device or p is "/". */
export async function mountPointOf(p: string, deps: PathDeps = {}): Promise<string> {
  const stat = deps.stat ?? fs.promises.stat;
  let cur = path.resolve(p);
  let dev = (await stat(cur)).dev;
  for (;;) {
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    if ((await stat(parent)).dev !== dev) return cur;
    cur = parent;
  }
}

export async function makeStagingDir(
  home: AgentHome,
  bundleReal: string,
  runId: string,
  deps: PathDeps = {},
): Promise<string> {
  const stat = deps.stat ?? fs.promises.stat;
  const [a, b] = await Promise.all([stat(home.staging), stat(bundleReal)]);
  if (a.dev === b.dev) {
    const dir = path.join(home.staging, runId);
    await fs.promises.mkdir(dir, { mode: 0o700 });
    await fs.promises.chmod(dir, 0o700);
    return dir;
  }
  const uid = process.getuid!();
  try {
    const mount = await mountPointOf(bundleReal, deps);
    const dir = await fs.promises.mkdtemp(path.join(mount, `.squeaky-ub-staging-${uid}-`));
    const st = await fs.promises.lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid) throw new Error(`unsafe staging dir ${dir}`);
    await fs.promises.chmod(dir, 0o700);
    return dir;
  } catch (e) {
    throw new NoStagingError(`cannot create staging dir on the bundle's volume: ${(e as Error).message}`);
  }
}

/** Name of a bundle's per-app directory under backups/. */
export function bundleHash(bundleReal: string): string {
  return crypto.createHash("sha256").update(bundleReal).digest("hex").slice(0, 16);
}

export function backupDirFor(home: AgentHome, bundleReal: string, build: string, runId: string): string {
  return path.join(home.backups, bundleHash(bundleReal), `${sanitizeComponent(build)}-${runId}`);
}
