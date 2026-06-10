import { promises as fs, constants as fsConstants } from "fs";
import path from "path";
import { cacheManager } from "./cache";

const isWindows = process.platform === "win32";

/**
 * Check whether an executable exists on PATH without spawning a process.
 *
 * Spawning `tool --version` costs 50ms-10s per tool (gradle boots a JVM,
 * npx may hit the network). Scanning PATH entries with fs.access costs
 * ~1ms total and answers the same question for availability purposes.
 */
async function findOnPath(command: string): Promise<boolean> {
  // Explicit paths (contain a separator) are checked directly
  if (command.includes("/") || command.includes(path.sep)) {
    return isExecutable(command);
  }

  const pathEnv = process.env.PATH || "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);

  // On Windows, executables need one of the PATHEXT extensions
  const extensions = isWindows
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter(Boolean)
    : [""];

  const candidates: string[] = [];
  for (const dir of dirs) {
    for (const ext of extensions) {
      candidates.push(path.join(dir, command + ext));
    }
  }

  // Check in PATH order, a bounded chunk at a time: most hits are in the
  // first few entries, and this caps concurrent fs.access calls per lookup.
  const chunkSize = 16;
  for (let i = 0; i < candidates.length; i += chunkSize) {
    const chunk = candidates.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map(isExecutable));
    if (results.some(Boolean)) return true;
  }
  return false;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    // Must be a regular file: directories also pass X_OK on POSIX (they
    // need the execute bit for traversal), so access() alone would treat
    // a directory named like the command as an executable.
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return false;

    // X_OK is meaningless on Windows; existence is enough there
    await fs.access(filePath, isWindows ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cached executable lookup (5-minute TTL, shared availability cache).
 */
export async function commandExists(command: string): Promise<boolean> {
  return cacheManager.getCachedAvailability(`cmd:${command}`, () =>
    findOnPath(command),
  );
}

/**
 * Check several commands at once; true if any exists.
 */
export async function anyCommandExists(
  ...commands: string[]
): Promise<boolean> {
  const results = await Promise.all(commands.map((c) => commandExists(c)));
  return results.some(Boolean);
}
