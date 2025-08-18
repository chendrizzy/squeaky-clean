📄 Development Plan for squeaky-clean

Objective:

Implement squeaky-clean as a safe, modular, cross-ecosystem cache cleaner/manager with strong defaults, plugin support, and scheduling.

**⸻**

1\. Safety & Correctness

-  Make dry-run the default for any destructive action unless --force is explicitly passed.

-  For Docker/system cleaners, add an interactive confirmation prompt requiring the user to type a phrase before deletion proceeds.

-  Use Node's fs.rm for deletions with guardrails. Provide a --trash flag on macOS/Linux that moves items to system Trash instead of deleting permanently.

-  Add path guards: cleaners must not operate outside $HOME by default. Ignore symlinks unless --follow-symlinks is specified.

-  Handle Windows long-path support properly. Document PowerShell equivalents for shell commands.

**⸻**

2\. UX & CLI Polish

-  Add --json output for list, sizes, and clean commands to support scripting.

-  Implement profiles: e.g., --profile web, --profile mobile, which trigger sets of cleaners.

-  Add a "recently used" heuristic: skip caches touched in the last n days unless --force. Show warnings in output.

-  Support dual output modes: human-friendly tables and --quiet/--json for automation/CI.

**⸻**

3\. Architecture & Extensibility

-  Finalize and document the CleanerModule interface as the stable plugin API.

-  Implement auto-discovery of plugins: recognize packages named squeaky-cleaner-*.

-  Introduce a rules engine with JSON config schema (validate with ajv). Support extends for presets and allow environment variable expansion.

-  Add concurrency controls: cap parallel cleaners and show progress to avoid I/O storms.

-  Implement scheduling: generate launchd (macOS), systemd timers (Linux), and Task Scheduler (Windows) units from squeaky auto.

**⸻**

4\. Cleaner Coverage

-  Add dedicated cleaners for:

-  brew cleanup (Homebrew)

-  pnpm store prune

-  yarn cache clean

-  pip cache purge

-  npm cache clean --force / npm cache verify

-  nix-collect-garbage

-  JetBrains IDE caches (per IDE)

-  Android Gradle build cache

-  Ensure each cleaner supports size reporting before and after cleaning.

-  For Xcode DerivedData: show project-by-project sizes and default to skipping last 3 active projects.

-  For Docker: default to docker system prune --volumes --filter "until=168h" with --confirm required. Add --keep and --until flags.

**⸻**

5\. Testing & CI

-  Add e2e tests: create temp cache directories, run list/sizes/clean, and assert correct behavior.

-  Configure CI matrix for Ubuntu, macOS, and Windows:

-  Run unit + e2e + smoke tests (--dry-run).

-  Validate generated scheduler unit files.

-  Publish canary builds to npm under next tag for early testers.

**⸻**

6\. Performance & Ergonomics

-  Implement async size scanning with fs.lstat + a walker and pool concurrency.

-  Cache size results under ~/.squeaky-clean/state.json for fast lookups; refresh on demand.

-  Support path globs and allow include / exclude patterns in config.

-  Add per-cleaner hooks: optional pre and post scripts.

**⸻**

7\. Documentation & Releases

-  Expand README to include:

-  A safety matrix per cleaner (risk level, defaults).

-  A "never touch" guarantee (no $HOME/Documents, etc.).

-  Uninstall/rollback instructions.

-  Cut v0.1.0 GitHub Release and publish to npm.

-  Add usage examples for npx squeaky-clean@latest interactive.

**⸻**

8\. Future Enhancements

-  Implement config profiles that can be shared across teams/orgs.

-  Add recently used detection based on file access timestamps.

-  Provide an interactive TUI (optional) for exploring cache sizes visually.







2) Updated implementation plan (tight)

Phase 0 --- Compat Loader & Additive Features (v0.0.x)

-  Add files:

-  src/config/loadConfig.ts (above),

-  schemas/config.v0-old.schema.json,

-  schemas/config.v1-new.schema.json.

-  CLI: add --json, --quiet, --force; keep current behavior (not dry-run) for now.

-  Plugin discovery: load squeaky-cleaner-* (warn on failures).

-  Tests:

-  Old, new, mixed configs → all normalize to identical internal shape.

-  Env/tilde expansion, extends merge order, deprecation warnings.

Phase 1 --- Default Safety Flip (v0.1.0)

-  Flip default to dry-run; on first run show one-time notice & how to opt out.

-  Keep compat loader. Start generating launchd/systemd/Task Scheduler from squeaky auto.

Phase 2 --- Internal Shape Migration (v0.2.0)

-  Refactor code to consume new shape internally (cleaners/scheduler/defaults).

-  Loader still accepts old keys; new takes precedence.

Phase 3 --- Legacy Removal (v1.0.0)

-  Remove support for tools/auto/output. Provide squeaky config doctor to rewrite configs.

Acceptance criteria

-  Parity: Old vs New vs Mixed produce same operations.

-  CI matrix (Ubuntu/macOS/Windows) passes unit + e2e + smoke (--dry-run).

-  Scheduler units validate syntactically on each OS.







**3) Updated implementation plan (patched to include Doctor)**
==============================================================

**Phase 0 --- v0.0.x (NOW)**

-   Compat loader (loadConfig.ts) + dual schemas.

-   **NEW:** Config Doctor (squeaky config doctor) for one-shot migration; backup strategy.

-   Add --json, --quiet, --force; plugin discovery.

-   Tests & CI (unit/e2e/smoke). README docs for both schemas + Doctor usage.

**Phase 1 --- v0.1.0**

-   Flip default to dry-run (one-time notice).

-   squeaky auto generates launchd/systemd/Task Scheduler.

**Phase 2 --- v0.2.0**

-   Switch internal consumption to new schema; compat loader remains.

**Phase 3 --- v1.0.0**

-   Remove legacy keys; provide squeaky config doctor path in migration docs.