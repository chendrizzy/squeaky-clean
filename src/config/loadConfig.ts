// src/config/loadConfig.ts
// uses Ajv for schema validation

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { DefinedError } from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SqueakyConfig = Record<string, any>;

export async function loadJson(filePath: string): Promise<any> {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function expandEnv(str: string): string {
  // Supports ${VAR} and tilde
  const tilde = str.startsWith("~") ? str.replace(/^~(?=\/|$)/, process.env.HOME || "~") : str;
  return tilde.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
}

export function deepMerge<T>(base: T, next: Partial<T>): T {
  if (Array.isArray(base) && Array.isArray(next)) return next as unknown as T;
  if (typeof base === "object" && base && typeof next === "object" && next) {
    const out: any = { ...base };
    for (const [k, v] of Object.entries(next)) {
      out[k] = k in out ? deepMerge(out[k], v as any) : v;
    }
    return out;
  }
  return (next as T) ?? base;
}

async function resolveMaybePackage(idOrPath: string, cwd: string): Promise<string> {
  if (idOrPath.startsWith(".") || idOrPath.startsWith("/") || idOrPath.startsWith("~")) {
    const expanded = expandEnv(idOrPath);
    return path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded);
  }
  // Try resolve from node_modules
  const pkgPath = require.resolve(idOrPath, { paths: [cwd] });
  return pkgPath;
}

export async function resolveExtendsChain(
  entries: string | string[] | undefined,
  fromPath: string
): Promise<any[]> {
  if (!entries) return [];
  const cwd = path.dirname(fromPath);
  const arr = Array.isArray(entries) ? entries : [entries];
  const resolved: any[] = [];
  for (const entry of arr) {
    const target = await resolveMaybePackage(entry, cwd);
    const json = await loadJson(target);
    resolved.push({ json, source: target });
  }
  return resolved;
}

export async function loadAndValidateConfig(configPath: string): Promise<SqueakyConfig> {
  const schemaPath = path.join(__dirname, "../../schemas/config.schema.json");
  const schema = await loadJson(schemaPath);
  const validate = ajv.compile(schema);

  const root = await loadJson(configPath);

  // Expand env in string leafs (shallow pass; paths/args/etc)
  function expandLeaves(obj: any): any {
    if (typeof obj === "string") return expandEnv(obj);
    if (Array.isArray(obj)) return obj.map(expandLeaves);
    if (obj && typeof obj === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) out[k] = expandLeaves(v);
      return out;
    }
    return obj;
  }

  // Resolve extends -> merge left-to-right, then merge root last
  const chain = await resolveExtendsChain(root.extends, configPath);
  let merged: any = {};
  for (const link of chain) merged = deepMerge(merged, expandLeaves(link.json));
  merged = deepMerge(merged, expandLeaves(root));

  // Validate final object
  const ok = validate(merged);
  if (!ok) {
    const errors = (validate.errors as DefinedError[]).map(e => `${e.instancePath} ${e.message}`).join("\n");
    const err = new Error(`Invalid config: \n${errors}`);
    (err as any).errors = validate.errors;
    throw err;
  }
  return merged;
}