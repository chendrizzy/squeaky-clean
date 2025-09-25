# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Quickstart

### Prerequisites
- **Node.js 22.18.0** (preferred per user rules; project supports >=16.0.0)
- **npm** (detected package manager via `package-lock.json`)

### Setup
```bash
# Install dependencies
npm install

# Build and verify
npm run build
npm run dev -- --help  # Test CLI works
```

## Essential Commands

### Development
```bash
npm run dev                    # Run CLI in development mode (tsx)
npm run build                  # Compile TypeScript to dist/
npm run build:watch            # Compile with watch mode
npm start                      # Run compiled CLI from dist/
```

### Testing
```bash
npm test                       # Run Vitest tests (watch mode)
npm run test:coverage          # Generate coverage report (80% threshold)
npx vitest run                 # Run tests once (no watch)

# Test etiquette: After tests finish, wait 5-10 seconds, then exit with 'q' or Ctrl+C
# Use 'h' for debugging if needed
```

### Code Quality
```bash
npm run format                 # Format with Prettier
npm run lint                   # ESLint (config needs fixing)
npm run lint:fix               # Auto-fix ESLint issues
npm run clean                  # Remove dist/ directory
```

### Version Management
```bash
npm run version:patch          # Bump patch version
npm run version:minor          # Bump minor version
npm run version:major          # Bump major version
npm run version:sync           # Sync version across files
```

## Architecture Overview: Modular Cleaner System

### Core Flow
1. **CLI Entry** (`src/cli.ts`) → Commander.js parsing → Command modules (`src/commands/`)
2. **Cache Manager** (`src/cleaners/index.ts`) → Registry of all cleaner modules
3. **Base Cleaner** (`src/cleaners/BaseCleaner.ts`) → Abstract class with common functionality
4. **Individual Cleaners** (`src/cleaners/*.ts`) → Tool-specific implementations (npm, docker, xcode, etc.)
5. **Execution Pipeline** → Detection → Categorization → Filtering → Cleaning → Reporting

### Key Components
- **Registry Pattern**: `CacheManager` maintains a Map of all cleaner modules
- **Strategy Pattern**: Each cleaner implements `CleanerModule` interface with tool-specific behavior
- **Template Method**: `BaseCleaner` provides common functionality, subclasses override specifics
- **Command Pattern**: Commands in `src/commands/` handle CLI operations independently
- **Configuration System**: Supports both legacy and new formats with automatic migration

### Architecture Diagram
```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│   CLI       │───▶│   Commands   │───▶│  Cache Manager  │
│ src/cli.ts  │    │src/commands/ │    │src/cleaners/    │
└─────────────┘    └──────────────┘    │    index.ts     │
                                       └─────────┬───────┘
                                                 ▼
                   ┌─────────────────────────────────────────┐
                   │           Individual Cleaners           │
                   │  npm.ts │ docker.ts │ xcode.ts │ ...    │
                   │         (extends BaseCleaner)           │
                   └─────────────────────────────────────────┘
```

## Key Patterns & Concepts

### Adding a New Cleaner
1. Create `src/cleaners/[tool].ts` extending `BaseCleaner`
2. Implement `isAvailable()` and `getCacheInfo()` methods
3. Override `getCacheCategories()` for granular cache control
4. Register in `src/cleaners/index.ts` Map
5. Add tests in `src/__tests__/cleaners/[tool].test.ts`

### Configuration Migration
- **New format** (v0.2.0+): `cleaners`, `scheduler`, `defaults` keys
- **Legacy format**: `tools`, `auto`, `output` keys
- Migration handled automatically by `src/config/migrateConfig.ts`
- Test migration: `npm run dev -- config doctor --dry-run`

### Granular Cache Control
- **Age-based**: `--older-than 7d`, `--newer-than 2w`
- **Size-based**: `--larger-than 100MB`, `--smaller-than 1GB`
- **Priority-based**: `critical`, `important`, `normal`, `low`
- **Use-case**: `development`, `testing`, `production`, `experimental`, `archived`

## Testing Structure

### Framework & Configuration
- **Vitest** with Node environment (`vitest.config.ts`)
- Tests co-located in `src/__tests__/` and `src/test/`
- **Coverage threshold**: 80% for branches, functions, lines, statements
- **Mocking**: Uses `memfs` for file system operations, mocks `execa` for commands

### Test Commands & Etiquette
```bash
npx vitest src/__tests__/cleaners/docker.test.ts  # Run specific test
npx vitest -t "should migrate"                    # Run tests matching pattern

# IMPORTANT: After tests complete, wait 5-10 seconds, then exit with 'q' or Ctrl+C
# Use 'h' for debugging if needed (per user rules)
```

### CI Integration
- **GitHub Actions**: Tests on Ubuntu, macOS, Windows with Node 16, 18, 20
- **Coverage**: Upload to Codecov (ubuntu-latest + Node 20 only)
- **Security**: npm audit, license checks, basic security pattern scanning
- **Config Migration**: Dedicated test job for config doctor command

## Configuration

### Application Config
- **Precedence**: Custom `--config` flag → `~/.config/squeaky-clean/config.json` → `~/.squeaky-clean/config.json` → defaults
- **Migration**: Automatic legacy-to-new format conversion via `config doctor`
- **Schema validation**: JSON Schema in `schemas/` directory

### Environment Variables
```bash
# Search for env usage: 
grep -r "process\.env" src/
# Primary usage in config loading and home directory detection
```

### Tooling Configuration
- **TypeScript**: `tsconfig.json` with path aliases (`@/` → `src/`)
- **ESLint**: `eslint.config.mts` (currently has configuration issues)
- **Prettier**: Configured in `package.json` scripts
- **Vitest**: `vitest.config.ts` with coverage settings and path resolution

## Developer Workflow

### Archon Integration
This project follows **Archon task-driven development**:

1. **Check Current Task** → Review task requirements in Archon
2. **Research for Task** → Search docs and examples
3. **Implement the Task** → Write code based on research  
4. **Update Task Status** → Move task "todo" → "doing" → "review"
5. **Get Next Task** → Check for next priority task
6. **Repeat Cycle**

### Common Development Flow
```bash
# 1. Check task requirements, move to "doing"
# 2. Start development
npm run dev -- clean --dry-run    # Test CLI changes

# 3. Run tests and wait 5-10s before exiting
npm test

# 4. Format and build
npm run format
npm run build

# 5. Update task status to "review"
```

## Troubleshooting

### Common Issues
- **Node version**: Ensure Node >=16.0.0 (prefer 22.18.0 per user rules)
- **ESLint config**: Currently has parsing issues with `eslint.config.mts`
- **Test watch mode**: Remember to wait 5-10 seconds after completion, then exit with 'q'
- **Package manager**: Uses npm (detected by `package-lock.json`)

### Cache & Build Issues
```bash
npm run clean               # Clear dist/ directory
rm -rf node_modules && npm install  # Full dependency refresh
npm run build               # Rebuild TypeScript
```

## Pointers

### Key Documentation
- [`README.md`](README.md) - User-facing documentation and usage examples
- [`CLAUDE.md`](CLAUDE.md) - Detailed architecture and implementation patterns
- [`CHANGELOG.md`](CHANGELOG.md) - Feature history and breaking changes
- [`docs/`](docs/) - Additional configuration guides
- [`.github/workflows/`](.github/workflows/) - CI/CD pipeline definitions

### Key Source Directories
- [`src/cleaners/`](src/cleaners/) - All cache cleaner implementations
- [`src/commands/`](src/commands/) - CLI command handlers  
- [`src/config/`](src/config/) - Configuration loading and migration
- [`src/types/`](src/types/) - TypeScript interfaces and type definitions
- [`src/__tests__/`](src/__tests__/) - Test files co-located with source
- [`schemas/`](schemas/) - JSON schemas for configuration validation