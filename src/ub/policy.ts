import { promises as fs } from "fs";
import * as path from "path";
import type { BundleInfo } from "./bundle";

export type AppClass = "mac-app-store" | "apple" | "chrome" | "microsoft" | "adobe" | "ilok-pace";
export interface AppProbe {
  hasMasReceipt: boolean;
  frameworkNames: string[];
}

// Bundle data is untrusted: only startsWith and this fixed regex, never a RegExp built from it.
const PACE_RE = /pace|ilok|eden/i;

const PREFIX_CLASSES: Array<[string, AppClass]> = [
  ["com.apple.", "apple"],
  ["com.google.Chrome", "chrome"],
  ["com.microsoft.", "microsoft"],
  ["com.adobe.", "adobe"],
  ["com.paceap.", "ilok-pace"],
];

export function classifyApp(info: BundleInfo, probe: AppProbe): { cls: AppClass } | null {
  if (probe.hasMasReceipt) return { cls: "mac-app-store" };
  const id = info.bundleId;
  if (id !== null) {
    for (const [prefix, cls] of PREFIX_CLASSES) if (id.startsWith(prefix)) return { cls };
  }
  if (probe.frameworkNames.some((n) => PACE_RE.test(n))) return { cls: "ilok-pace" };
  return null;
}

/** fs-only, read-only. */
export async function probeApp(realpath: string): Promise<AppProbe> {
  const contents = path.join(realpath, "Contents");
  const hasMasReceipt = await fs.lstat(path.join(contents, "_MASReceipt")).then(
    () => true,
    () => false,
  );
  const frameworkNames = await fs.readdir(path.join(contents, "Frameworks")).then(
    (names) => names.map(String),
    () => [] as string[],
  );
  return { hasMasReceipt, frameworkNames };
}
