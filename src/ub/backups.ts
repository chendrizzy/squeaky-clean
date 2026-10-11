import * as fs from "fs";
import * as path from "path";
import { listIncomplete, rejectedDir } from "./journal";
import { bundleHash, type AgentHome } from "./paths";

export async function backupFile(
  src: string,
  dest: string,
  deps: { copyFile?: typeof fs.promises.copyFile } = {},
): Promise<void> {
  const copyFile = deps.copyFile ?? fs.promises.copyFile;
  const tmp = dest + ".tmp";
  await fs.promises.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
  try {
    await copyFile(src, tmp, fs.constants.COPYFILE_FICLONE);
    const fh = await fs.promises.open(tmp, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    const [a, b] = await Promise.all([
      fs.promises.stat(src),
      fs.promises.stat(tmp),
    ]);
    if (a.size !== b.size)
      throw new Error(
        `backup size mismatch for ${src}: ${b.size} != ${a.size}`,
      );
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

async function treeBytes(p: string): Promise<number> {
  const st = await fs.promises.lstat(p);
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const c of await fs.promises.readdir(p))
    n += await treeBytes(path.join(p, c));
  return n;
}

export interface PruneResult {
  removedDirs: string[];
  freedBytes: number;
  /** kept because an incomplete journal entry still references them */
  heldDirs: string[];
}

/**
 * Removes `backups/<h>/<name>` dirs (real dirs only) that `remove` accepts and no incomplete journal entry references.
 * Fails closed (c3): a quarantined journal record may be the one holding a backup, so while `journal/rejected/` holds
 * anything nothing is removed and this throws, saying where the records are.
 */
async function pruneWhere(
  home: AgentHome,
  remove: (st: fs.Stats) => boolean,
  onlyHash?: string,
): Promise<PruneResult> {
  const held = new Set(
    (await listIncomplete(home, "")).map((e) => e.backupDir),
  );
  const dir = rejectedDir(home);
  const rejected = await fs.promises
    .readdir(dir)
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
  if (rejected.length > 0) {
    throw new Error(
      `${rejected.length} quarantined journal record(s) in ${dir}; inspect them, then remove them to re-enable pruning`,
    );
  }
  const out: PruneResult = { removedDirs: [], freedBytes: 0, heldDirs: [] };
  const hashes =
    onlyHash === undefined
      ? await fs.promises.readdir(home.backups)
      : [onlyHash];
  for (const h of hashes) {
    const hd = path.join(home.backups, h);
    const hst = await fs.promises
      .lstat(hd)
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (!hst?.isDirectory()) continue;
    for (const v of await fs.promises.readdir(hd)) {
      const d = path.join(hd, v);
      const st = await fs.promises.lstat(d);
      if (!st.isDirectory() || !remove(st)) continue;
      if (held.has(d)) {
        out.heldDirs.push(d);
        continue;
      }
      const bytes = await treeBytes(d);
      await fs.promises.rm(d, { recursive: true, force: true });
      out.removedDirs.push(d);
      out.freedBytes += bytes;
    }
    if ((await fs.promises.readdir(hd)).length === 0)
      await fs.promises.rmdir(hd).catch(() => {});
  }
  return out;
}

export async function pruneExpiredBackups(
  home: AgentHome,
  keepDays: number,
  nowMs: number,
): Promise<{ removedDirs: string[]; freedBytes: number }> {
  const cutoff = nowMs - keepDays * 86_400_000;
  const { removedDirs, freedBytes } = await pruneWhere(
    home,
    (st) => st.mtimeMs < cutoff,
  );
  return { removedDirs, freedBytes };
}

/**
 * `squeaky ub prune`: releases backups early regardless of age. With `appPath`, only that app's
 * backups (keyed by its realpath, or the resolved path when the app is gone); without it, every app's.
 */
export async function pruneBackups(
  home: AgentHome,
  appPath?: string,
): Promise<PruneResult> {
  if (appPath === undefined) return pruneWhere(home, () => true);
  const real = await fs.promises
    .realpath(appPath)
    .catch(() => path.resolve(appPath));
  return pruneWhere(home, () => true, bundleHash(real));
}
