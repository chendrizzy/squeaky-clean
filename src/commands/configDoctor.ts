// src/commands/configDoctor.ts

import fs from "node:fs";
import path from "node:path";
import { isLegacyShape, legacyToNew, writeBackupAndSave } from "../config/migrateConfig.js";

export interface DoctorOptions {
  input?: string;      // path to config (default: ~/.squeaky-clean/config.json)
  output?: string;     // if set, write converted config here instead of overwriting input
  dryRun?: boolean;    // show conversion without writing
  quiet?: boolean;     // minimal output
}

function log(msg: string, quiet?: boolean) {
  if (!quiet) console.log(msg);
}

export async function runConfigDoctor(opts: DoctorOptions = {}) {
  const cfgPath = opts.input || path.join(process.env.HOME || process.env.USERPROFILE || ".", ".squeaky-clean", "config.json");

  if (!fs.existsSync(cfgPath)) {
    throw new Error(`Config not found at ${cfgPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  if (!isLegacyShape(raw)) {
    log("No legacy keys detected. Your config already uses the new schema.", opts.quiet);
    return { changed: false, input: cfgPath };
  }

  const converted = legacyToNew(raw);

  if (opts.dryRun) {
    log("=== Dry Run: Converted config (not written) ===", opts.quiet);
    console.log(JSON.stringify(converted, null, 2));
    return { changed: true, input: cfgPath, output: undefined, backup: undefined, dryRun: true };
  }

  const outPath = opts.output || cfgPath;
  let backup: string | undefined;

  if (!opts.output) {
    // in-place: write backup first
    backup = writeBackupAndSave(outPath, converted);
    log(`Saved backup: ${backup}`, opts.quiet);
    log(`Overwrote config with migrated schema: ${outPath}`, opts.quiet);
  } else {
    // to a new file: don’t overwrite input
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(converted, null, 2) + "\n", "utf8");
    log(`Wrote migrated config to: ${outPath}`, opts.quiet);
  }

  return { changed: true, input: cfgPath, output: outPath, backup, dryRun: false };
}