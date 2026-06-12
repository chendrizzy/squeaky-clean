# 🧼squeaky-clean✨
<div align="center">

**Easy cross-system development cache cleaner/manager with interactive configuration**

Essentially a *"universal cachectl"*—**smart** *(sort of)*, **safe** (at least, I *think* it is...), and **configurable** cache cleaner/manager CLI-tool with support for *most* common development tools. Dsigned for easy integration expansion with additional tools *(forks **encouraged!**)*.

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Configuration](#configuration) • [Supported Tools](#supported-tools) • [Contributing](#contributing)

---

[![npm downloads](https://img.shields.io/npm/dm/squeaky-clean.svg)](https://www.npmjs.com/package/squeaky-clean) [![Node.js Version](https://img.shields.io/node/v/squeaky-clean.svg)](https://nodejs.org) [![npm version](https://img.shields.io/npm/v/squeaky-clean.svg)](https://www.npmjs.com/package/squeaky-clean) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

</div>

## Features

- **🎯 Smart Detection**: Automatically detects installed development tools and their cache locations
- **🎨 Interactive Wizard**: Beautiful CLI interface with progress bars and colored output
- **📡 Real-Time Progress**: Live parallel scanning status with animated indicators for 25+ tools simultaneously
- **🔧 Highly Configurable**: Choose exactly which caches to clean and when
- **📊 Size Analytics**: See how much space each cache is using before cleaning
- **🛡️ Safe by Default**: Dry-run mode to preview what will be cleaned (v0.1.0+ defaults to dry-run)
- **🚦 Safety Tiers & Cleaning Profiles**: Every cache classified `safe` → `manual`; pick a `conservative`, `balanced`, or `aggressive` profile
- **🔎 System-Wide App Cache Discovery**: Finds non-developer app caches (Electron, GPU/shader, sandboxed/Flatpak/Snap apps, logs) guarded by a built-in safety database
- **⚡ Performance**: Parallel cleaning operations for maximum speed
- **🔄 Auto-clean Mode**: Schedule automatic cache cleaning based on your preferences
- **📱 Cross-platform**: Works on macOS, Linux, and Windows
- **🔄 Config Migration**: Automatic migration from legacy to new configuration format
- **🔌 Plugin Support**: Discover and use community cleaners via npm packages
- **📋 JSON Output**: Machine-readable output for scripting and automation
- **🔄 Auto-Update**: Background update checking with easy self-update command

## 📦 Installation

### Global Installation (Recommended)

```bash
npm install -g squeaky-clean
```

Or using other package managers:

```bash
# Yarn
yarn global add squeaky-clean

# pnpm
pnpm add -g squeaky-clean

# Bun
bun add -g squeaky-clean
```

### Homebrew (macOS/Linux)

```bash
brew install chendrizzy/squeaky-clean/squeaky-clean
```

### Local Installation

```bash
npm install --save-dev squeaky-clean
```

### Updating

Squeaky Clean includes a built-in update command:

```bash
# Check for and install updates
squeaky update

# Only check for updates without installing
squeaky update --check
```

By default, squeaky-clean will automatically check for updates once every 24 hours when you run any command. You can disable this with:

```bash
squeaky update --disable-auto
```

## Usage

### Interactive Mode (Recommended)

Start the interactive configuration wizard:

```bash
squeaky interactive
```

This will guide you through:
- Selecting which tools to clean
- Configuring cleaning preferences
- Setting up automatic cleaning schedules

### Command Line

#### Clean all caches

```bash
squeaky clean --all
```

#### Clean specific cache types

```bash
# Clean only package manager caches
squeaky clean --types package-manager

# Clean multiple types
squeaky clean --types package-manager,build-tool

# Clean specific tools
squeaky clean npm yarn webpack
```

#### Dry run mode (preview without cleaning)

```bash
squeaky clean --all --dry-run
```

#### Show cache sizes

```bash
squeaky sizes
```

#### List available caches

```bash
squeaky list
# With sizes inline
squeaky list --sizes
```

#### 🎯 Granular Cache Management

```bash
# View detailed cache categories
squeaky categories --tool npm
squeaky categories --verbose  # Show all tools with details

# Clean caches older than 7 days
squeaky clean --older-than 7d

# Clean caches larger than 100MB
squeaky clean --larger-than 100MB

# Clean only low priority caches (preserve critical/important)
squeaky clean --priority low

# Clean archived/experimental caches
squeaky clean --use-case archived

# Combine multiple criteria
squeaky clean --older-than 14d --priority low --larger-than 50MB

# Clean specific categories by ID
squeaky categories --tool npm  # First, list categories to get IDs
squeaky clean --categories npm-logs,npm-metrics

# Use custom config file
squeaky clean --config my-config.json --dry-run
```

### Available Commands

| Command | Description | Aliases |
|---------|-------------|---------|
| `clean` | Clean development caches with granular control | - |
| `list` | List available caches and their status | `ls` |
| `sizes` | Show cache sizes without clearing | - |
| `categories` | Show detailed cache categories with usage patterns | `cats` |
| `config` | Manage configuration | - |
| `profile` | Show or set the active cleaning profile (`conservative`, `balanced`, `aggressive`) | - |
| `doctor` | Check system and diagnose issues | - |
| `auto` | Configure automatic cleaning | - |
| `update` | Check for and install updates | - |
| `interactive` | Start interactive configuration wizard | `i` |

### Command Options

#### `clean` Options

- `-a, --all` - Clean all configured caches
- `-t, --types <types>` - Comma-separated list of cache types
- `-e, --exclude <tools>` - Comma-separated list of tools to exclude
- `--include <tools>` - Comma-separated list of tools to include (overrides `--all` and `--exclude`)
- `-d, --dry-run` - Show what would be cleaned without actually cleaning
- `-f, --force` - Skip confirmation prompts
- `-s, --sizes` - Show cache sizes before cleaning

**🎯 Granular Selection Options:**
- `--older-than <age>` - Clean caches older than specified age (e.g., `7d`, `2w`, `1m`)
- `--newer-than <age>` - Clean caches newer than specified age
- `--larger-than <size>` - Clean caches larger than specified size (e.g., `100MB`, `1GB`)
- `--smaller-than <size>` - Clean caches smaller than specified size
- `--use-case <case>` - Target specific use cases (`development`, `testing`, `production`, `experimental`, `archived`)
- `--priority <level>` - Clean only specified priority (`critical`, `important`, `normal`, `low`)
- `--categories <ids>` - Clean specific category IDs (comma-separated)
- `--sub-caches <cleaner:category,...>` - Clean specific sub-caches within a cleaner (e.g., `xcode:DerivedData,npm:logs`)

**🚦 Safety & Profile Options:**
- `--profile <name>` - Cleaning profile to apply (`conservative`, `balanced`, `aggressive`)
- `--safety <tiers>` - Comma-separated safety tiers to clean (`safe`, `probably-safe`, `caution`, `manual`); overrides `--profile`
- `--allow-manual <ids>` - Comma-separated category IDs consenting to manual-tier cleaning

**🧹 App-Caches Breakdown:**
- `--group-by <hierarchy>` - Group the app-caches breakdown by a single axis or comma-list hierarchy (e.g. `tier,kind,app`) or `none`; default `tier → kind → app`
- `--summary` - Collapse the app-caches breakdown to one line (it is **expanded by default**); use `--json` for machine output
- `clean --dry-run` shows the full grouped breakdown; the collapsed summary looks like `5.2 GB · 18 caches · 6 apps · top: …`. Configure default grouping/expansion and per-app excludes under `toolSettings.app-caches` (see the [Configuration Guide](docs/configuration-guide.md))

#### `categories` Options

- `-t, --tool <tool>` - Show categories for specific tool
- `--type <type>` - Filter by cache type
- `-v, --verbose` - Show detailed information
- `--group-by <hierarchy>` - Group categories by a single axis or comma-list hierarchy (e.g. `tier,kind,app`) or none (default `tier → kind → app`)

#### `list` Options

- `-s, --sizes` - Include cache sizes inline with the list
- `-t, --type <type>` - Filter by cache type

#### `update` Options

- `-c, --check` - Only check for updates without installing
- `--auto-on` - Enable automatic update checks on startup (`--enable-auto`/`--enable-auto-update` aliases)
- `--auto-off` - Disable automatic update checks (`--disable-auto`/`--disable-auto-update` aliases)

#### Global Options

- `-v, --verbose` - Enable verbose output
- `--no-color` - Disable colored output
- `--config <path>` - Use custom configuration file
- `--version` - Show version number
- `-h, --help` - Display help

## 🚦 Safety Tiers & Cleaning Profiles

Every cache category is classified into one of four safety tiers, and the active cleaning profile decides which tiers get cleaned:

| Tier | Meaning |
|------|---------|
| `safe` | Regenerated transparently; no observable downside to cleaning |
| `probably-safe` | Regenerable; apps may start slower or re-download data once |
| `caution` | May lose useful state (offline content, large re-downloads) or upset running apps |
| `manual` | User-data adjacent; requires explicit per-item confirmation, never cleaned implicitly |

| Profile | Tiers cleaned | Description |
|---------|---------------|-------------|
| `conservative` | safe | Only caches that are definitely safe to clean |
| `balanced` (default) | safe, probably-safe | Safe caches plus regenerable ones that may cost a slower next launch |
| `aggressive` | safe, probably-safe, caution | Everything except manual-confirmation items |

```bash
# View the active profile (and all available profiles)
squeaky profile

# Persist a profile as the default for future runs
squeaky profile conservative

# Apply a profile for a single run
squeaky clean --all --profile aggressive

# Override with an explicit tier list (beats --profile)
squeaky clean --all --safety safe,caution
```

**Manual tier = explicit consent.** Manual-tier categories (e.g. 100GB+ ML model stores) are *never* cleaned implicitly—no profile includes them, and `--force` cannot bypass the consent gate. Consent per category interactively when prompted, or pass category IDs explicitly:

```bash
# Find category IDs first, then consent explicitly
squeaky categories --tool app-caches
squeaky clean --include app-caches --allow-manual <category-id>
```

### 🔎 System-Wide App Cache Discovery (`app-caches`)

The `app-caches` cleaner discovers *non-developer* application caches across the whole system:

- **macOS**: `~/Library/Caches`, Electron `Cache`/`GPUCache`/`Code Cache` dirs under `~/Library/Application Support`, sandboxed-app caches under `~/Library/Containers/*/Data/Library/Caches` and `~/Library/Group Containers/*/Library/Caches`, `~/Library/Logs`, and `~/.cache`
- **Linux**: `~/.cache` (XDG), Electron caches under `~/.config/*`, plus Flatpak (`~/.var/app/*/cache`) and Snap (`~/snap/*/{current,common}/.cache`) app caches
- **Windows**: `LOCALAPPDATA`/`APPDATA` (Electron `Cache`/`GPUCache`/`Code Cache`) and the user `Temp` directory

A built-in safety database:

- **Hard-excludes** dangerous lookalikes (iCloud/CloudKit sync state, Mail, Photos, device backups, Docker's VM disk, Signal, password managers)—never shown, never cleaned
- **Skips** paths already covered by the dedicated tool cleaners (no double counting)
- **Classifies** everything else by tier (GPU/shader caches = `safe`, chat app caches = `caution`, huge ML model stores = `manual`)

Heads-up: the full-system scan is heavier than the dev-only scan (tens of seconds on a large system, and more on Macs with many sandboxed apps). The largest caches are always surfaced even when the candidate list is capped. To keep the fast dev-only scan:

```bash
squeaky clean --all --exclude app-caches   # skip for one run
squeaky config --disable app-caches        # disable persistently
```

## 🛠️ Supported Tools

### Package Managers

| Tool | Caches Cleaned |
|------|----------------|
| **npm** | `~/.npm`, `node_modules/.cache` |
| **Yarn** | `~/.yarn/cache`, `.yarn/cache` |
| **pnpm** | `~/.pnpm-store`, `~/.cache/pnpm` |
| **Bun** | `~/.bun/install/cache` |
| **pip** | `~/.cache/pip` |
| **Homebrew** | `brew --cache`, old versions |
| **Nix** | `/nix/store` garbage, old generations |

### Build Tools

| Tool | Caches Cleaned |
|------|----------------|
| **Webpack** | `.webpack-cache`, `node_modules/.cache/webpack` |
| **Vite** | `node_modules/.vite`, `.vite-cache` |
| **Nx** | `node_modules/.cache/nx`, `.nx/cache` |
| **Turbo** | `.turbo`, `node_modules/.cache/turbo` |
| **Flutter** | `~/.pub-cache`, `build/` |

### IDEs & Editors

| Tool | Caches Cleaned |
|------|----------------|
| **VS Code** | `~/.config/Code/Cache*`, Extensions cache |
| **Xcode** | `~/Library/Developer/Xcode/DerivedData` |
| **Android Studio** | `~/.android/cache`, Build cache |
| **JetBrains IDEs** | `~/.cache/JetBrains/*/caches` |

### Browsers (Development)

| Tool | Caches Cleaned |
|------|----------------|
| **Chrome** | Dev tools cache, Service workers |
| **Firefox** | Dev tools cache, Temporary files |

### System Tools

| Tool | Caches Cleaned |
|------|----------------|
| **Docker** | Unused containers, images, volumes |
| **Gradle** | `~/.gradle/caches`, `.gradle/` |
| **App Caches** (`app-caches`) | System-wide discovered application caches, classified by [safety tier](#-safety-tiers--cleaning-profiles) |

## ⚙️ Configuration

Squeaky Clean can be configured through:

1. **Interactive wizard**: `squeaky interactive`
2. **Configuration file**: `~/.squeaky-clean/config.json`
3. **Environment variables**: `SQUEAKY_*`

### Configuration Migration (v0.2.0+)

Squeaky Clean now supports automatic migration from legacy configuration format to the new schema:

```bash
# Migrate your config automatically
squeaky config doctor

# Or use the doctor command
squeaky doctor --config

# Preview migration without changing files
squeaky config doctor --dry-run

# Migrate to a different file
squeaky config doctor --input old-config.json --output new-config.json
```

### Configuration File Examples

#### New Schema (v0.2.0+)
```json
{
  "cleaners": {
    "npm": { "enabled": true },
    "yarn": { "enabled": true },
    "webpack": { "enabled": false }
  },
  "scheduler": {
    "enabled": true,
    "interval": "weekly",
    "thresholds": {
      "size": "1GB",
      "age": "30d"
    }
  },
  "defaults": {
    "verbose": false,
    "colors": true,
    "format": "text"
  }
}
```

#### Legacy Schema (still supported)
```json
{
  "tools": {
    "npm": { "enabled": true },
    "yarn": { "enabled": true },
    "webpack": { "enabled": false }
  },
  "auto": {
    "enabled": true,
    "schedule": "weekly",
    "sizeThreshold": "1GB"
  },
  "output": {
    "verbose": false,
    "useColors": true
  }
}
```

### Environment Variables

- `SQUEAKY_AUTO_CLEAN` - Enable automatic cleaning
- `SQUEAKY_DRY_RUN` - Always run in dry-run mode
- `SQUEAKY_VERBOSE` - Enable verbose output
- `SQUEAKY_NO_COLOR` - Disable colored output

## 🔄 Automatic Cleaning

Configure automatic cache cleaning based on:

- **Schedule**: Daily, weekly, or monthly
- **Size threshold**: Clean when caches exceed a certain size
- **Smart detection**: Clean only when tools haven't been used recently

```bash
# Configure automatic cleaning
squeaky auto

# Enable with weekly schedule
squeaky auto --enable --schedule weekly

# Set size threshold
squeaky auto --size-threshold 5GB
```

## 🏗️ Architecture

Squeaky Clean is built with a modular architecture:

```
src/
├── cli.ts              # CLI entry point
├── commands/           # Command implementations
│   ├── clean.ts       # Main cleaning logic
│   ├── interactive.ts # Interactive wizard
│   ├── config.ts      # Configuration management
│   └── ...
├── cleaners/          # Tool-specific cleaners
│   ├── npm.ts
│   ├── docker.ts
│   └── ...
├── config/            # Configuration system
├── utils/             # Utility functions
└── types/             # TypeScript definitions
```

Each cleaner module implements the `CleanerModule` interface:

```typescript
interface CleanerModule {
  name: string;
  type: CacheType;
  description: string;
  getCacheInfo(): Promise<CacheInfo>;
  clear(dryRun?: boolean): Promise<ClearResult>;
}
```

## 🧪 Development

### Prerequisites

- Node.js >= 16.0.0
- npm, yarn, pnpm, or bun

### Setup

```bash
# Clone the repository
git clone https://github.com/justinchen/squeaky-clean.git
cd squeaky-clean

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev
```

### Scripts

- `npm run build` - Build the TypeScript source
- `npm run dev` - Run in development mode with hot reload
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage report
- `npm run lint` - Lint the codebase
- `npm run format` - Format code with Prettier
- `npm run release` - Run tests/build, publish to npm, and sync the GitHub release (requires the `gh` CLI + `GH_TOKEN` or `GITHUB_TOKEN` to be set)

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Adding a New Cleaner

To add support for a new tool:

1. Create a new cleaner module in `src/cleaners/`
2. Implement the `CleanerModule` interface
3. Register it in `src/cleaners/index.ts`
4. Add tests in `src/__tests__/cleaners/`
5. Update the README with the new tool

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

**Built with**:
- *[Commander.js](https://github.com/tj/commander.js)* for CLI parsing
- *[Chalk](https://github.com/chalk/chalk)* for puuurrrtty terminal output
- *[Inquirer.js](https://github.com/SBoudrias/Inquirer.js)* for interactive prompts
- *[Ora](https://github.com/sindresorhus/ora)* for elegant terminal spinners

## 📮 Support

- 🐛 [Report bugs](https://github.com/chendrizzy/squeaky-clean/issues)
- 💡 [Request features](https://github.com/chendrizzy/squeaky-clean/issues)
- 📖 [Read the docs](https://github.com/chendrizzy/squeaky-clean#readme)
- ⭐ Star the project on GitHub!

---

<div align="center">
Made with ❤️ by and for developers
</div>
