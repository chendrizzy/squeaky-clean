// src/plugins/discovery.ts
// finds squeaky packages (+ optional scoped prefixes) installed in current project or globally

import path from "node:path";
import fs from "node:fs";

export interface PluginInfo {
  name: string;
  path: string;
}

function listNodeModulesRoots(): string[] {
  const roots = new Set<string>();
  const cwd = process.cwd();

  // Walk up looking for node_modules
  let dir = cwd;
  for (;;) {
    const nm = path.join(dir, "node_modules");
    if (fs.existsSync(nm)) roots.add(nm);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Add global npm prefix if present
  if (process.env.npm_config_prefix) {
    roots.add(path.join(process.env.npm_config_prefix, "lib", "node_modules"));
  }
  return Array.from(roots);
}

export function discoverPlugins(
  prefixes: string[] = ["squeaky-cleaner-"],
  scopes: string[] = [],
): PluginInfo[] {
  const roots = listNodeModulesRoots();
  const found: PluginInfo[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      // scoped packages
      if (entry.startsWith("@")) {
        if (scopes.length && !scopes.includes(entry)) continue;
        const scopeDir = path.join(root, entry);
        if (!fs.existsSync(scopeDir)) continue;
        for (const pkg of fs.readdirSync(scopeDir)) {
          if (prefixes.some((p) => pkg.startsWith(p))) {
            const pkgPath = path.join(scopeDir, pkg);
            found.push({ name: `${entry}/${pkg}`, path: pkgPath });
          }
        }
      } else {
        if (prefixes.some((p) => entry.startsWith(p))) {
          const pkgPath = path.join(root, entry);
          found.push({ name: entry, path: pkgPath });
        }
      }
    }
  }

  // De-dup by name
  const map = new Map(found.map((p) => [p.name, p]));
  return Array.from(map.values());
}
