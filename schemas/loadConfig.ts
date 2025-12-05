// schemas/loadConfig.ts
// Config loader using zod for schema validation

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateOldConfig, validateNewConfig, type MixedConfig as MixedConfigType } from "../src/config/configSchema";

/** ---------- Types ---------- */
export type OldConfig = {
  tools?: Record<string, any>;
  auto?: { enabled?: boolean; schedule?: "daily"|"weekly"|"monthly"; dayOfWeek?: string|number; time?: string; sizeThreshold?: string; args?: string[]; };
  output?: { verbose?: boolean; useColors?: boolean };
};

export type NewConfig = {
  cleaners?: Record<string, any>;
  scheduler?: { enabled?: boolean; frequency?: "daily"|"weekly"|"monthly"; dayOfWeek?: string|number; time?: string; args?: string[] };
  defaults?: { dryRun?: boolean; followSymlinks?: boolean; restrictToHome?: boolean; trash?: boolean; concurrency?: number; recentDays?: number; sizeScan?: { enableCache?: boolean; cachePath?: string; maxParallelFs?: number } };
  plugins?: { enabled?: boolean; scopes?: string[]; prefixes?: string[] };
  profiles?: Record<string, { description?: string; include?: string[]; exclude?: string[] }>;
  extends?: string | string[];
};

export type MixedConfig = OldConfig & NewConfig;

export type InternalConfig = {
  tools: Record<string, any>;
  auto: { enabled?: boolean; schedule?: "daily"|"weekly"|"monthly"; dayOfWeek?: string|number; time?: string; args?: string[]; };
  output: { verbose?: boolean; useColors?: boolean };
  __new?: Pick<NewConfig, "defaults"|"plugins"|"profiles"|"scheduler"|"cleaners">;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function readJson(p: string) {
  const raw = await fs.promises.readFile(p, "utf8");
  return JSON.parse(raw);
}

function expandEnv(str: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const withTilde = str.startsWith("~") ? str.replace(/^~/, home) : str;
  return withTilde.replace(/\$\{([^}]+)\}/g, (_, k) => process.env[k] ?? "");
}

function expandLeaves<T>(v: T): T {
  if (typeof v === "string") return expandEnv(v) as unknown as T;
  if (Array.isArray(v)) return v.map(expandLeaves) as unknown as T;
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, val] of Object.entries(v as any)) out[k] = expandLeaves(val);
    return out;
  }
  return v;
}

function deepMerge<T>(a: T, b: Partial<T>): T {
  if (Array.isArray(a) && Array.isArray(b)) return b as unknown as T;
  if (a && typeof a === "object" && b && typeof b === "object") {
    const out: any = { ...(a as any) };
    for (const [k, v] of Object.entries(b)) {
      out[k] = k in out ? deepMerge(out[k], v as any) : v;
    }
    return out;
  }
  return (b as T) ?? a;
}

async function resolveMaybePackage(idOrPath: string, baseDir: string): Promise<string> {
  const expanded = expandEnv(idOrPath);
  if (expanded.startsWith(".") || expanded.startsWith("/") || expanded.startsWith("~")) {
    return path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded);
  }
  return require.resolve(expanded, { paths: [baseDir] });
}

async function loadExtendsChain(root: any, fromPath: string) {
  const ex = root.extends;
  if (!ex) return [];
  const baseDir = path.dirname(fromPath);
  const arr = Array.isArray(ex) ? ex : [ex];
  const chain: any[] = [];
  for (const entry of arr) {
    const target = await resolveMaybePackage(entry, baseDir);
    const json = await readJson(target);
    chain.push(expandLeaves(json));
  }
  return chain;
}

type Shape = "old" | "new" | "mixed" | "empty";

function detectShape(raw: MixedConfig): Shape {
  const hasOld = !!(raw.tools || raw.auto || raw.output);
  const hasNew = !!(raw.cleaners || raw.scheduler || raw.defaults || raw.plugins || raw.profiles);
  if (hasOld && hasNew) return "mixed";
  if (hasNew) return "new";
  if (hasOld) return "old";
  return "empty";
}

function mapNewToOld(raw: NewConfig): OldConfig {
  const auto: OldConfig["auto"] = raw.scheduler
    ? {
        enabled: raw.scheduler.enabled,
        schedule: raw.scheduler.frequency as any,
        dayOfWeek: raw.scheduler.dayOfWeek,
        time: raw.scheduler.time,
        args: raw.scheduler.args
      }
    : undefined;

  return {
    tools: raw.cleaners ? { ...raw.cleaners } : undefined,
    auto,
    output: undefined
  };
}

function normalize(raw: MixedConfig): InternalConfig {
  const oldPart: OldConfig = {
    tools: raw.tools ?? {},
    auto: raw.auto ?? {},
    output: raw.output ?? {}
  };
  const newAsOld = mapNewToOld(raw as NewConfig);

  const mergedOld: OldConfig = {
    tools: deepMerge(oldPart.tools ?? {}, newAsOld.tools ?? {}),
    auto: deepMerge(oldPart.auto ?? {}, newAsOld.auto ?? {}),
    output: oldPart.output ?? {}
  };

  const internal: InternalConfig = {
    tools: mergedOld.tools ?? {},
    auto: mergedOld.auto ?? {},
    output: mergedOld.output ?? {},
    __new: {
      defaults: (raw as NewConfig).defaults,
      plugins: (raw as NewConfig).plugins,
      profiles: (raw as NewConfig).profiles,
      scheduler: (raw as NewConfig).scheduler,
      cleaners: (raw as NewConfig).cleaners
    }
  };
  return internal;
}

function warn(msg: string) {
  console.warn(`\x1b[33m[squeaky][config] ${msg}\x1b[0m`);
}

function emitDeprecations(raw: MixedConfig) {
  const shape = detectShape(raw);
  if (shape === "old") {
    warn("Config uses legacy keys `tools/auto/output`. These will be removed in v1.0.0. Prefer `cleaners/scheduler/defaults/plugins/profiles`.");
  }
  if (shape === "mixed") {
    warn("Both legacy and new keys detected. New keys take precedence where overlapping.");
  }
}

export async function loadConfig(configPath: string): Promise<InternalConfig> {
  const rawFile = await readJson(configPath);
  const chain = await loadExtendsChain(rawFile, configPath);

  let merged: MixedConfig = {} as any;
  for (const link of chain) merged = deepMerge(merged, link);
  merged = deepMerge(merged, rawFile);
  merged = expandLeaves(merged);

  // Validate with zod (non-fatal if only one passes)
  const okOld = validateOldConfig(merged);
  const okNew = validateNewConfig(merged);

  if (!okOld.success && !okNew.success) {
    const eOld = (okOld.errors || []).join("\n");
    const eNew = (okNew.errors || []).join("\n");
    throw new Error(`Config failed validation.\n— old schema errors —\n${eOld}\n\n— new schema errors —\n${eNew}`);
  }

  emitDeprecations(merged);
  return normalize(merged);
}
