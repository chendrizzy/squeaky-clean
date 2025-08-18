Updated implementation plan (tight)

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