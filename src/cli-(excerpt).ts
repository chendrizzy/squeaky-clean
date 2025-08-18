// src/cli.ts (excerpt)
// Ajv wiring in CLI entry

import { loadAndValidateConfig } from "./config/loadConfig.js";
import { discoverPlugins } from "./plugins/discovery.js";
import { loadConfig } from "./config/loadConfig.js";

const cfgPath = process.env.SQUEAKY_CONFIG || `${process.env.HOME}/.squeaky-clean/config.json`;
const config = await loadConfig(cfgPath);
// use config.tools / config.auto / config.output (plus config.__new for progressive adoption)

async function main() {
  const cfgPath = process.env.SQUEAKY_CONFIG || `${process.env.HOME}/.squeaky-clean/config.json`;
  const config = await loadAndValidateConfig(cfgPath);

  if (config.plugins?.enabled !== false) {
    const plugins = discoverPlugins(config.plugins?.prefixes ?? ["squeaky-cleaner-"], config.plugins?.scopes ?? []);
    // Dynamically import each plugin's default export which should register itself or return a CleanerModule[]
    for (const p of plugins) {
      try {
        const mod = await import(p.path);
        // register cleaners here, e.g., registry.add(mod.default || mod.cleaners)
      } catch (e) {
        console.warn(`[squeaky] Failed to load plugin ${p.name}:`, (e as Error).message);
      }
    }
  }

  // ... proceed with command routing (list/sizes/clean/auto)
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});



// Example: adding a 'doctor' subcommand (or config doctor) that calls the function @src/commands/configDoctor.ts
import { runConfigDoctor } from "./commands/configDoctor.js";

async function main() {
  const [,, cmd, ...args] = process.argv;
  // ... your existing routing
  
  if (cmd === "config" && args[0] === "doctor") {
    // parse flags: --input, --output, --dry-run, --quiet
    const parsed = parseArgs(args.slice(1)); // your existing flag parser
    await runConfigDoctor({
      input: parsed.input,
      output: parsed.output,
      dryRun: !!parsed["dry-run"],
      quiet: !!parsed.quiet
    });
    return;
  }
  
  if (cmd === "doctor") {
    const parsed = parseArgs(args);
    await runConfigDoctor({
      input: parsed.input,
      output: parsed.output,
      dryRun: !!parsed["dry-run"],
      quiet: !!parsed.quiet
    });
    return;
  }
  
  // ...
}