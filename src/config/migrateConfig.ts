// src/config/migrateConfig.ts
// Drop-in for: migrate/doctor

import fs from "node:fs";
import path from "node:path";

export type LegacyConfig = {
  tools?: Record<string, any>;
  auto?: { enabled?: boolean; schedule?: "daily"|"weekly"|"monthly"; dayOfWeek?: string|number; time?: string; sizeThreshold?: string; args?: string[]; };
  output?: { verbose?: boolean; useColors?: boolean };
  extends?: string | string[];
  [k: string]: any;
};

export type NewConfig = {
  cleaners?: Record<string, any>;
  scheduler?: { enabled?: boolean; frequency?: "daily"|"weekly"|"monthly"; dayOfWeek?: string|number; time?: string; args?: string[] };
  defaults?: { dryRun?: boolean; followSymlinks?: boolean; restrictToHome?: boolean; trash?: boolean; concurrency?: number; recentDays?: number; sizeScan?: { enableCache?: boolean; cachePath?: string; maxParallelFs?: number } };
  plugins?: { enabled?: boolean; scopes?: string[]; prefixes?: string[] };
  profiles?: Record<string, { description?: string; include?: string[]; exclude?: string[] }>;
  extends?: string | string[];
  [k: string]: any;
};

export function isLegacyShape(json: any): boolean {
  return !!(json && (json.tools || json.auto || json.output));
}

export function legacyToNew(json: LegacyConfig): NewConfig {
  const out: NewConfig = {};

  // 1) tools -> cleaners
  if (json.tools && typeof json.tools === "object") {
    out.cleaners = { ...(json.tools as object) } as Record<string, any>;
  }

  // 2) auto -> scheduler
  if (json.auto && typeof json.auto === "object") {
    out.scheduler = {
      enabled: json.auto.enabled,
      frequency: json.auto.schedule as any,
      dayOfWeek: json.auto.dayOfWeek,
      time: json.auto.time,
      args: json.auto.args
    };
    // If old configs used sizeThreshold, keep it as a hint flag on args
    if (json.auto.sizeThreshold && out.scheduler) {
      out.scheduler.args = [...(out.scheduler.args ?? []), "--size-threshold", String(json.auto.sizeThreshold)];
    }
  }

  // 3) output -> defaults (map what reasonably translates)
  if (json.output && typeof json.output === "object") {
    out.defaults = {
      // dryRun remains user-controlled; don’t infer from verbose/useColors
      // Carry nothing by default—these were UI prefs. If you prefer, you can stash them:
      // @ts-expect-error keep legacy UI hints
      _legacyOutput: json.output
    } as any;
  }

  // 4) passthrough: extends/plugins/profiles if already present
  if (json.extends) out.extends = json.extends;
  if ((json as any).plugins) out.plugins = (json as any).plugins;
  if ((json as any).profiles) out.profiles = (json as any).profiles;

  // 5) bring forward unknown top-level keys as-is (non-invasive)
  for (const [k, v] of Object.entries(json)) {
    if (["tools","auto","output","extends","plugins","profiles"].includes(k)) continue;
    if (!(k in out)) (out as any)[k] = v;
  }

  return out;
}

export function writeBackupAndSave(targetPath: string, newJson: object): string {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(dir, `${base}.backup.${stamp}.json`);
  const pretty = (o: any) => JSON.stringify(o, null, 2);

  // Backup original if exists
  if (fs.existsSync(targetPath)) {
    const src = fs.readFileSync(targetPath, "utf8");
    fs.writeFileSync(backup, src, "utf8");
  }

  fs.writeFileSync(targetPath, pretty(newJson) + "\n", "utf8");
  return backup;
}