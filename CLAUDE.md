# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

squeaky-clean is a universal development cache cleaner CLI tool that manages caches for 25+ development tools. It features smart detection, interactive configuration, granular cache control, and plugin support. The tool helps developers reclaim disk space by intelligently cleaning caches from package managers, build tools, IDEs, browsers, and system tools.

## Essential Commands

### Development & Testing
```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Run in development mode (with hot reload)
npm run dev

# Run all tests
npm test

# Run specific test file
npx vitest src/__tests__/cleaners/docker.test.ts

# Run tests in watch mode
npm run test:watch

# Generate test coverage report
npm run test:coverage

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code with Prettier
npm run format
```

### Version Management
```bash
# Sync version across package.json and CLI
npm run version:sync

# Bump version (patch/minor/major)
npm run version:patch
npm run version:minor
npm run version:major
```

## Architecture & Key Patterns

### Modular Cleaner System
The project uses a plugin-based architecture where each development tool has its own cleaner module. All cleaners extend `BaseCleaner` class which implements the `CleanerModule` interface:

```typescript
interface CleanerModule {
  name: string;
  type: CacheType;
  description: string;
  isAvailable(): Promise<boolean>;
  getCacheInfo(): Promise<CacheInfo>;
  getCacheCategories(): Promise<CacheCategory[]>;
  clear(dryRun?: boolean, criteria?: CacheSelectionCriteria): Promise<ClearResult>;
  clearByCategory(categoryIds: string[], dryRun?: boolean): Promise<ClearResult>;
}
```

Key classes:
- `src/cleaners/BaseCleaner.ts` - Abstract base class with common functionality like directory size calculation, path filtering, and cache priority detection
- Individual cleaners in `src/cleaners/*.ts` - Each tool-specific implementation (npm, docker, vscode, etc.)
- `src/cleaners/index.ts` - Central registry for all cleaners

### Configuration System
The project supports both legacy and new configuration formats with automatic migration:

- **New format** (v0.2.0+): Uses `cleaners`, `scheduler`, and `defaults` keys
- **Legacy format**: Uses `tools`, `auto`, and `output` keys  
- **Migration**: `src/config/migrateConfig.ts` handles automatic conversion between formats
- **Loading**: `src/config/loadConfig.ts` manages config file discovery and validation

Configuration precedence:
1. Custom config path via `--config` flag
2. `~/.config/squeaky-clean/config.json` (new location)
3. `~/.squeaky-clean/config.json` (legacy location)
4. Built-in defaults

### Command Structure
Commands are modular and located in `src/commands/`:
- Each command is a separate module exporting an async function
- Commands receive options from Commander.js
- Commands can import and use cleaners, config, and utilities as needed

### Granular Cache Control
The system supports sophisticated cache filtering through `CacheSelectionCriteria`:
- Age-based: `--older-than`, `--newer-than`
- Size-based: `--larger-than`, `--smaller-than`
- Priority-based: critical, important, normal, low
- Use case-based: development, testing, production, experimental, archived
- Category-specific: Target individual cache categories by ID

### Testing Approach
- Uses Vitest for testing with Node environment
- Test files co-located with source in `src/__tests__/`
- **Integration tests** (`src/test/`) scan real filesystem with 30+ cleaners, requiring extended timeouts
- Mocks external commands (execa) in unit tests to avoid actual file system operations
- Coverage thresholds: 80% for branches, functions, lines, and statements

### Test Configuration (Long-Running Tests)
The project has both fast unit tests and slow integration tests that scan the real filesystem:

- **CacheManager.test.ts**: 21 tests, ~5-6 minutes, requires 60-120s timeouts per test
- **integration.test.ts**: 17 tests, ~11 minutes, requires 120-360s timeouts per test
- **Vitest Configuration** (`vitest.config.ts`):
  - `testTimeout: 120000` (2 minutes default)
  - `hookTimeout: 60000` (1 minute for setup/teardown)
  - `teardownTimeout: 30000` (30 seconds)
  - `pool: 'forks'` with `singleFork: true` - prevents IPC timeout errors during long runs
  - Individual tests override with longer timeouts as needed (e.g., `}, 360000)` for 6-minute tests)

**Best Practice**: When tests scan real filesystems or perform actual cache detection across 30+ tools, expect 10-15 minute total runtime and configure timeouts accordingly.

## Important Implementation Details

### Cross-Platform Compatibility
- File paths use Node.js `path` module for OS compatibility
- Home directory resolved via `os.homedir()`
- Docker and system commands wrapped with error handling for missing tools

### Error Handling
- All cleaners implement graceful degradation when tools aren't available
- `isAvailable()` method checks tool presence before attempting operations
- Commands use try-catch blocks with informative error messages

### Performance Considerations
- Directory sizes calculated using native `du` command for efficiency
- Parallel cleaning operations when multiple tools selected
- Caching of availability checks to avoid repeated command executions

### Safety Features
- Dry-run mode (`--dry-run`) previews operations without executing
- Recently used cache detection prevents cleaning active project caches
- Priority system protects critical caches by default
- Force flag (`--force`) required to skip confirmation prompts

## Configuration Migration Notes

When working on config migration (`config doctor` command):
- The migration preserves unknown fields for backward compatibility
- New format takes precedence when both old and new keys exist
- Migration is idempotent - can be run multiple times safely
- Dry-run mode allows preview without file changes

## Adding New Cleaners

To add support for a new development tool:
1. Create new file in `src/cleaners/[toolname].ts`
2. Extend `BaseCleaner` class
3. Implement required methods: `isAvailable()` and `getCacheInfo()`
4. Override `getCacheCategories()` if tool has multiple cache types
5. Register in `src/cleaners/index.ts`
6. Add tests in `src/__tests__/cleaners/[toolname].test.ts`

## Documentation Policy

### Directory Structure for Documentation
The project separates public-facing and internal documentation:

| Location | Purpose | Git Status |
|----------|---------|------------|
| `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` | Public user-facing docs | **Tracked** |
| `docs/` | Public guides (cli-reference, configuration-guide) | **Tracked** |
| `docs-dev/` | Internal planning, roadmaps, status, feasibility | **Ignored** |
| `CLAUDE.md`, `AGENTS.md` | AI assistant instructions | **Ignored** |

### Rules for New Documentation

**Always place in `docs-dev/` (auto-ignored):**
- Project status, roadmaps, planning docs
- Feasibility studies, architecture overviews
- Implementation plans, feature demos
- Pricing, internal reports, audits
- Any doc with `PLAN`, `STATUS`, `ROADMAP`, `FEASIBILITY`, `INTERNAL` in name

**Keep in root or `docs/` (tracked):**
- `README.md` - Main project overview
- `CHANGELOG.md` - Version history
- `CONTRIBUTING.md` - Contribution guidelines
- `SECURITY.md` - Security policy
- `docs/*.md` - User-facing guides

### Naming Conventions (Auto-Ignored by .gitignore)
Files matching these patterns are automatically ignored:
- `*_PLAN*.md`, `*_STATUS*.md`, `*_ROADMAP*.md`
- `*FEASIBILITY*.md`, `*PRICING*.md`, `*INTERNAL*.md`
- `docs-dev/**` (entire directory)

When creating new internal docs, **always place them in `docs-dev/`** to ensure they're never accidentally committed.

## Common Development Patterns

### Running the CLI Locally
```bash
# During development (TypeScript directly)
npm run dev -- clean --all --dry-run

# After building (compiled JavaScript)
npm run build
node dist/cli.js clean --all --dry-run
```

### Debugging Tests
```bash
# Run single test file with verbose output
npx vitest src/__tests__/config/migrateConfig.test.ts --reporter=verbose

# Debug specific test
npx vitest -t "should migrate auto to scheduler"
```

### Testing Config Migration
```bash
# Test migration with sample config
npm run dev -- config doctor --dry-run

# Test with custom paths
npm run dev -- config doctor --input test-config.json --output migrated.json --dry-run
```