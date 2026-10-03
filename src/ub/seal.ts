import * as path from "path";
import { readPlistFile, type PlistValue } from "./plist";

export interface Seal {
  files2: Record<string, { cdhash?: string; hash2?: string; hash?: string } | string>;
  nestedRules: RegExp[];
}

export type SealClass = "main" | "cdhash-nested" | "data-sealed" | "unsealed" | "excluded";

const NESTED_DIRS = new Set(["MacOS", "Frameworks", "Helpers", "XPCServices"]);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isDict = (v: unknown): v is { [k: string]: PlistValue } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Build a Seal from a parsed CodeResources plist; null if it has no files2 dict. */
export function sealFromPlist(plist: PlistValue | null): Seal | null {
  if (!isDict(plist) || !own(plist, "files2") || !isDict(plist.files2)) return null;
  const nestedRules: RegExp[] = [];
  const rules = own(plist, "rules2") ? plist.rules2 : undefined;
  if (isDict(rules)) {
    for (const key of Object.keys(rules)) {
      const v = rules[key];
      if (!isDict(v) || !own(v, "nested") || v.nested !== true) continue;
      try {
        nestedRules.push(new RegExp(key));
      } catch {
        /* skip uncompilable rule */
      }
    }
  }
  return { files2: plist.files2 as Seal["files2"], nestedRules };
}

/** null when CodeResources is missing, binary, malformed or lacks files2 (never throws). */
export async function loadSeal(bundleReal: string): Promise<Seal | null> {
  try {
    const p = path.join(bundleReal, "Contents", "_CodeSignature", "CodeResources");
    return sealFromPlist(await readPlistFile(p, { allowSpawn: false }));
  } catch {
    return null;
  }
}

export function classifyFile(
  seal: Seal,
  relFromContents: string,
  mainExecRelFromContents: string,
): SealClass {
  if (relFromContents === mainExecRelFromContents) return "main";
  if (relFromContents.startsWith("Library/SystemExtensions/")) return "excluded";
  const entry = own(seal.files2, relFromContents) ? seal.files2[relFromContents] : undefined;
  if (typeof entry === "string") return "data-sealed";
  if (!isDict(entry)) return "unsealed";
  if (
    own(entry, "cdhash") &&
    typeof entry.cdhash === "string" &&
    NESTED_DIRS.has(relFromContents.split("/")[0]) &&
    seal.nestedRules.some((r) => r.test(relFromContents))
  )
    return "cdhash-nested";
  if (
    (own(entry, "hash2") && typeof entry.hash2 === "string") ||
    (own(entry, "hash") && typeof entry.hash === "string")
  )
    return "data-sealed";
  return "unsealed";
}
