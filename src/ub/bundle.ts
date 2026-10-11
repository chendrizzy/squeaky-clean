import { promises as fs } from "fs";
import * as path from "path";
import { readPlistFile } from "./plist";
import { openRegularFile } from "./paths";

export type Arch = "arm64" | "arm64e" | "x86_64" | "i386" | "other";

export interface Slice {
  arch: Arch;
  cputype: number;
  cpusubtype: number;
}

const CPU_ARM64 = 0x0100000c;
const CPU_X86_64 = 0x01000007;
const CPU_I386 = 0x00000007;

function sliceOf(cputype: number, rawSub: number): Slice {
  const cpusubtype = rawSub & 0x00ffffff;
  let arch: Arch = "other";
  if (cputype === CPU_ARM64) arch = cpusubtype === 2 ? "arm64e" : "arm64";
  else if (cputype === CPU_X86_64) arch = "x86_64";
  else if (cputype === CPU_I386) arch = "i386";
  return { arch, cputype, cpusubtype };
}

/**
 * Read Mach-O slices straight from the header bytes (no spawn). Returns []
 * for non-Mach-O files (including Java class files sharing CAFEBABE), for
 * anything that is not a regular file (a FIFO is refused without blocking),
 * and for dataless files (iCloud-offloaded: no allocated blocks but a nonzero
 * size), which are never opened because opening one faults its data back in.
 */
export async function readMachOSlices(p: string): Promise<Slice[]> {
  let file;
  // ponytail: blocks==0 also matches tiny decmpfs-compressed files; skipping them is safe (never thinned)
  const dataless = (st: { blocks: number; size: number }) => st.blocks === 0 && st.size > 0;
  try {
    if (dataless(await fs.stat(p))) return []; // checked before the open: the open itself would fault it in
    const opened = await openRegularFile(p);
    file = opened.fh;
    if (dataless(opened.st)) return [];
    const buf = Buffer.alloc(1024);
    const { bytesRead } = await file.read(buf, 0, 1024, 0);
    if (bytesRead < 8) return [];
    const be = buf.readUInt32BE(0);

    if (be === 0xcafebabe || be === 0xcafebabf) {
      const count = buf.readUInt32BE(4);
      // Java .class files: their version field is far above any real count.
      if (count === 0 || count > 30) return [];
      const size = be === 0xcafebabf ? 32 : 20;
      const out: Slice[] = [];
      for (let i = 0; i < count; i++) {
        const o = 8 + i * size;
        if (o + 8 > bytesRead) break;
        out.push(sliceOf(buf.readUInt32BE(o), buf.readUInt32BE(o + 4)));
      }
      return out;
    }

    if (bytesRead < 12) return [];
    const le = buf.readUInt32LE(0);
    if (le === 0xfeedface || le === 0xfeedfacf) {
      return [sliceOf(buf.readUInt32LE(4), buf.readUInt32LE(8))];
    }
    if (be === 0xfeedface || be === 0xfeedfacf) {
      return [sliceOf(buf.readUInt32BE(4), buf.readUInt32BE(8))];
    }
    return [];
  } catch {
    return [];
  } finally {
    await file?.close().catch(() => {});
  }
}

export function classifySlices(
  s: Slice[],
):
  | { thinnable: true }
  | {
      thinnable: false;
      reason:
        | "not-mach-o"
        | "not-universal"
        | "no-arm64"
        | "no-x86"
        | "other-slice";
    } {
  if (s.length === 0) return { thinnable: false, reason: "not-mach-o" };
  if (s.length < 2) return { thinnable: false, reason: "not-universal" };
  if (s.some((x) => x.arch === "arm64e" || x.arch === "other")) {
    return { thinnable: false, reason: "other-slice" };
  }
  if (!s.some((x) => x.arch === "arm64")) {
    return { thinnable: false, reason: "no-arm64" };
  }
  if (!s.some((x) => x.arch === "x86_64")) {
    return { thinnable: false, reason: "no-x86" };
  }
  return { thinnable: true };
}

export interface BundleInfo {
  appPath: string;
  realpath: string;
  bundleId: string | null;
  version: string;
  build: string;
  executable: string;
  name: string;
}

/** Own-property string value, or undefined. */
function str(d: object, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(d, key)) return undefined;
  const v = (d as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Read an app bundle's Info.plist. Returns null when the plist is missing or
 * unparseable, or CFBundleExecutable is not a plain basename. A binary plist
 * with `allowSpawn: false` falls back to bundleId null and executable = name.
 */
export async function readBundleInfo(
  appPath: string,
  opts: { allowSpawn: boolean },
): Promise<BundleInfo | null> {
  const name = path.basename(appPath, ".app");
  let plist;
  try {
    plist = await readPlistFile(path.join(appPath, "Contents", "Info.plist"), opts);
  } catch {
    return null;
  }
  let executable = name;
  let bundleId: string | null = null;
  let version = "";
  let build = "";
  if (plist !== null) {
    if (typeof plist !== "object" || Array.isArray(plist)) return null;
    const exe = str(plist, "CFBundleExecutable");
    if (!exe || exe.includes("/") || exe === "." || exe === "..") return null;
    executable = exe;
    bundleId = str(plist, "CFBundleIdentifier") ?? null;
    version = str(plist, "CFBundleShortVersionString") ?? "";
    build = str(plist, "CFBundleVersion") ?? "";
  }
  let real = appPath;
  try {
    real = await fs.realpath(appPath);
  } catch {
    // keep appPath
  }
  return { appPath, realpath: real, bundleId, version, build, executable, name };
}
