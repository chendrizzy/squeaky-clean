# CLI Reference

Complete reference for all Squeaky Clean commands and options.

## Table of Contents

- [Global Options](#global-options)
- [Commands Overview](#commands-overview)
- [Configuration Commands](#configuration-commands)
- [Cache Management Commands](#cache-management-commands)
- [Utility Commands](#utility-commands)
- [Update Command](#squeaky-update)
- [Universal Binary Command](#squeaky-ub)
- [Examples](#examples)

---

## Global Options

These options are available for all commands:

### `-v, --verbose`
Enable verbose output with detailed information about operations.

```bash
squeaky clean --verbose
squeaky config --verbose
```

### `--no-color`
Disable colored output (useful for CI/CD environments or terminals that don't support colors).

```bash
squeaky clean --no-color
squeaky list --no-color
```

### `--help`
Show help information for any command.

```bash
squeaky --help
squeaky config --help
squeaky clean --help
```

### `--version`
Display the current version of Squeaky Clean.

```bash
squeaky --version
```

---

## Commands Overview

### Core Commands
- [`config`](#squeaky-config) - Configuration management with interactive wizard
- [`profile`](#squeaky-profile) - Show or set the active cleaning profile
- [`clean`](#squeaky-clean) - Clean development caches
- [`list`](#squeaky-list) - List available caches
- [`sizes`](#squeaky-sizes) - Show cache sizes

### Utility Commands
- [`doctor`](#squeaky-doctor) - Diagnose issues
- [`auto`](#squeaky-auto) - Smart automatic cleaning
- [`interactive`](#squeaky-interactive) - Interactive cache selection
- [`update`](#squeaky-update) - Check for and install updates
- [`ub`](#squeaky-ub) - Thin Universal Binaries on Apple Silicon

---

## Configuration Commands

### `squeaky config`

Manage configuration settings for Squeaky Clean.

**Default Behavior**: Shows current configuration when no options are provided.

```bash
# Show current configuration
squeaky config
```

#### Options

##### `-i, --interactive`
Launch the interactive configuration wizard with step-by-step setup.

```bash
squeaky config --interactive
squeaky config -i
```

**Wizard Steps:**
1. **📝 Output Preferences** - Verbose output, colors
2. **🔒 Safety Settings** - Confirmation requirements
3. **🔧 Tool Configuration** - Enable/disable tools by category
4. **📋 Review & Apply** - Preview and confirm changes

##### `-p, --path`
Show the location of the configuration file.

```bash
squeaky config --path
```

##### `-l, --list`
List all available configuration options and commands.

```bash
squeaky config --list
```

Includes auto-update status (enabled/disabled, interval, last check), safety settings, output preferences, and tool enablement by category.

##### `-g, --get <key>`
Get a specific configuration value.

```bash
# Get verbose setting
squeaky config --get verbose

# Get color setting  
squeaky config --get colors

# Get nested values
squeaky config --get output.verbose
```

##### `-s, --set <key=value>`
Set a specific configuration value.

```bash
# Enable verbose output
squeaky config --set verbose=true

# Disable colors
squeaky config --set colors=false

# Boolean values are automatically parsed
squeaky config --set verbose=false
```

##### `-e, --enable <tool...>`
Enable one or more cache cleaner tools (space-separated).

```bash
# Enable Docker cleaner
squeaky config --enable docker

# Enable multiple tools at once
squeaky config --enable xcode chrome universal-binary
```

##### `-d, --disable <tool...>`
Disable one or more cache cleaner tools (space-separated).

```bash
# Disable Docker cleaner
squeaky config --disable docker

# Disable browser cleaners together
squeaky config --disable chrome firefox
```

##### `-r, --reset`
Reset configuration to default settings.

```bash
squeaky config --reset
```

**⚠️ Warning**: This will restore all settings to defaults and re-enable all tools.

#### Available Tools

**Package Managers**: `npm`, `yarn`, `pnpm`, `bun`, `pip`
**Build Tools**: `webpack`, `vite`, `nx`, `turbo`, `flutter`, `gradle`
**IDEs**: `vscode`, `xcode`, `androidstudio`, `jetbrains`
**Browsers**: `chrome`, `firefox`
**System Tools**: `docker`, `app-caches`

---

### `squeaky profile`

Show or set the active cleaning profile. The profile decides which [safety tiers](#safety--profile-options) are cleaned without per-item confirmation.

```bash
# Show the active profile and all available profiles
squeaky profile

# Persist a profile (stored as activeProfile in your config)
squeaky profile conservative
squeaky profile balanced
squeaky profile aggressive
```

**Available Profiles:**

| Profile | Tiers cleaned | Description |
|---------|---------------|-------------|
| `conservative` | safe | Only caches that are definitely safe to clean |
| `balanced` (default) | safe, probably-safe | Safe caches plus regenerable ones that may cost a slower next launch |
| `aggressive` | safe, probably-safe, caution | Everything except manual-confirmation items |

The persisted profile applies to every `squeaky clean` run unless overridden per run with `clean --profile <name>` or `clean --safety <tiers>`.

---

## Cache Management Commands

### `squeaky clean`

Clean development caches based on configuration and options.

```bash
# Basic usage - clean all configured caches
squeaky clean

# Clean all with confirmation
squeaky clean --all
```

#### Options

##### `-a, --all`
Clean all configured caches (respects enable/disable settings).

```bash
squeaky clean --all
```

##### `--group-by <app|tier|kind|none>`
Group the system-wide app-caches breakdown. Default `app`. Add `-v` to expand the full grouped tree; use `--json` for a machine-readable object. Configure the default via `toolSettings.app-caches.display.groupBy`.

```bash
# Expand app-caches grouped by safety tier
squeaky clean --dry-run --include app-caches -v --group-by tier

# Machine-readable output (banners suppressed)
squeaky clean --dry-run --json
```

##### `-t, --types <types>`
Clean only specific cache types (comma-separated).

**Available Types:**
- `package-manager` - npm, yarn, pnpm, bun, pip
- `build-tool` - webpack, vite, nx, turbo, flutter, gradle  
- `ide` - VS Code, Xcode, Android Studio, JetBrains
- `browser` - Chrome, Firefox
- `system` - Docker

```bash
# Clean only package managers
squeaky clean --types package-manager

# Clean package managers and build tools
squeaky clean --types package-manager,build-tool

# Clean all types except browsers
squeaky clean --types package-manager,build-tool,ide,system
```

##### `-e, --exclude <tools>`
Exclude specific tools from cleaning (comma-separated).

```bash
# Clean all except Chrome
squeaky clean --exclude chrome

# Clean all except Chrome and Docker
squeaky clean --exclude chrome,docker

# Clean package managers except yarn
squeaky clean --types package-manager --exclude yarn
```

##### `--include <tools>`
Clean only the listed tools (comma-separated). Overrides `--all` and `--exclude`.

```bash
# Run only the system-wide app cache discovery cleaner
squeaky clean --include app-caches

# Only npm and docker
squeaky clean --include npm,docker
```

##### `-d, --dry-run`
Preview what would be cleaned without actually cleaning.

```bash
# Safe preview of all operations
squeaky clean --all --dry-run

# Preview specific types
squeaky clean --types build-tool --dry-run
```

##### `-f, --force`
Skip confirmation prompts (use with caution).

```bash
# Clean without confirmation
squeaky clean --all --force

# Useful for automation/CI
squeaky clean --types package-manager --force
```

##### `-s, --sizes`
Show cache sizes before cleaning (slower but more informative).

```bash
# Show sizes during cleaning
squeaky clean --all --sizes

# Combine with dry-run for size reports
squeaky clean --all --sizes --dry-run
```

#### Granular Selection Options

These options filter *which* cache categories get cleaned:

##### `--older-than <age>` / `--newer-than <age>`
Filter by cache age (e.g., `7d`, `2w`, `1m`).

```bash
squeaky clean --older-than 7d
```

##### `--larger-than <size>` / `--smaller-than <size>`
Filter by cache size (e.g., `100MB`, `1GB`).

```bash
squeaky clean --larger-than 500MB
```

##### `--use-case <case>`
Target specific use cases: `development`, `testing`, `production`, `experimental`, `archived`.

##### `--priority <level>`
Clean only the specified priority: `critical`, `important`, `normal`, `low`.

##### `--categories <ids>`
Clean specific category IDs (comma-separated). Use `squeaky categories` to discover IDs.

```bash
squeaky categories --tool npm
squeaky clean --categories npm-logs,npm-metrics
```

##### `--sub-caches <cleaner:category,...>`
Clean specific sub-caches within a cleaner.

```bash
squeaky clean --sub-caches xcode:DerivedData,npm:logs
```

#### Safety & Profile Options

Every cache category carries one of four safety tiers:

| Tier | Meaning |
|------|---------|
| `safe` | Regenerated transparently; no observable downside to cleaning |
| `probably-safe` | Regenerable; apps may start slower or re-download data once |
| `caution` | May lose useful state (offline content, large re-downloads) or upset running apps |
| `manual` | User-data adjacent; requires explicit per-item confirmation, never cleaned implicitly |

##### `--profile <name>`
Cleaning profile to apply for this run: `conservative`, `balanced`, or `aggressive`. Overrides the persisted profile (see [`squeaky profile`](#squeaky-profile)).

```bash
squeaky clean --all --profile conservative
```

##### `--safety <tiers>`
Comma-separated safety tiers to clean (`safe`, `probably-safe`, `caution`, `manual`). Overrides `--profile` and the persisted profile.

```bash
squeaky clean --all --safety safe,caution
```

##### `--allow-manual <ids>`
Comma-separated category IDs consenting to manual-tier cleaning.

Manual-tier categories are **never cleaned implicitly**: no profile includes them, and `--force` cannot bypass the consent gate. Consent per category interactively when prompted, or pass IDs explicitly:

```bash
# Find manual-tier category IDs first
squeaky categories --tool app-caches

# Then consent explicitly
squeaky clean --include app-caches --allow-manual <category-id>
```

---

### `squeaky list`

List available caches and their status.

```bash
# Basic list
squeaky list

# List with aliases
squeaky ls
```

#### Options

##### `-s, --sizes`
Include cache sizes (slower due to directory scanning).

```bash
squeaky list --sizes
squeaky ls -s
```

##### `-t, --type <type>`
Filter by specific cache type.

```bash
# Show only package managers
squeaky list --type package-manager

# Show only build tools
squeaky list --type build-tool
```

---

### `squeaky sizes`

Show cache sizes without cleaning anything.

```bash
# Show all cache sizes
squeaky sizes
```

#### Options

##### `-t, --type <type>`
Filter by specific cache type.

```bash
squeaky sizes --type package-manager
```

##### `--json`
Output sizes in JSON format (useful for scripting).

```bash
squeaky sizes --json
squeaky sizes --type build-tool --json
```

---

## Utility Commands

### `squeaky doctor`

Diagnose potential issues with cache detection and cleaning.

```bash
squeaky doctor

# Alias
squeaky dr
```

**Checks performed:**
- Tool detection and availability
- Cache directory accessibility
- Permission issues
- Configuration validity
- Common installation problems

---

### `squeaky auto`

Smart automatic cache cleaning based on detection.

```bash
squeaky auto
```

#### Options

##### `-s, --safe`
Only clean caches that are definitely safe to clear.

```bash
squeaky auto --safe
```

##### `-a, --aggressive`
Include more cache types in automatic cleaning.

```bash
squeaky auto --aggressive
```

---

### `squeaky interactive`

Interactive cache selection and cleaning with guided prompts.

```bash
squeaky interactive

# Alias
squeaky i
```

#### Options

##### `-v, --verbose`
Enable verbose output during interactive mode.

```bash
squeaky interactive --verbose
```

**Features:**
- Visual cache selection
- Size information
- Category-based organization
- Safe preview before cleaning

---

### `squeaky update`

Check for and install updates, or manage background update checks.

```bash
# Check for updates and install if available
squeaky update

# Only check without installing
squeaky update --check

# Re-enable background update checks (every 24h by default)
squeaky update --auto-on
```

#### Options

##### `-c, --check`
Only check for updates without installing.

##### `--auto-on`
Enable automatic update checks on startup. (aliases: `--enable-auto`, `--enable-auto-update`)

##### `--auto-off`
Disable automatic update checks. (aliases: `--disable-auto`, `--disable-auto-update`)

---

### `squeaky ub`

Thin Universal Binaries on Apple Silicon by removing unused x86_64 code.

```bash
# List Universal Binaries without modifying
squeaky ub --list

# Thin all detected binaries without prompts
squeaky ub --all --force

# Safe preview
squeaky ub --dry-run
```

#### Options

##### `-a, --all`
Thin all detected Universal Binaries without prompting.

##### `-l, --list`
List Universal Binaries without thinning.

##### `-d, --dry-run`
Show what would be thinned without making changes.

##### `-f, --force`
Skip confirmation prompts when thinning.

---

## Examples

### Configuration Examples

```bash
# First-time setup
squeaky config --interactive

# Quick enable/disable
squeaky config --enable docker chrome
squeaky config --disable chrome firefox

# Bulk configuration
squeaky config --set verbose=true
squeaky config --set colors=true

# Check current settings
squeaky config
squeaky config --get verbose
```

### Cleaning Examples

```bash
# Safe exploration
squeaky list --sizes
squeaky clean --dry-run

# Targeted cleaning
squeaky clean --types package-manager
squeaky clean --types build-tool --exclude nx

# Full cleanup
squeaky clean --all --force

# Size-aware cleaning
squeaky clean --all --sizes
```

### Safety & Profile Examples

```bash
# View or persist the active cleaning profile
squeaky profile
squeaky profile conservative

# Per-run profile override
squeaky clean --all --profile aggressive

# Explicit tier list (beats --profile)
squeaky clean --all --safety safe,caution

# System-wide app cache discovery only, with manual-tier consent
squeaky clean --include app-caches --allow-manual <category-id>

# Keep the fast dev-only scan (skip system-wide discovery)
squeaky clean --all --exclude app-caches
```

### Automation Examples

```bash
# CI/CD safe cleaning
squeaky clean --types package-manager,build-tool --force --no-color

# Scripting with JSON
SIZES=$(squeaky sizes --json)
echo "Current cache sizes: $SIZES"

# Conditional cleaning
if [ $(squeaky sizes --type package-manager --json | jq '.totalSize') -gt 1000000000 ]; then
  squeaky clean --types package-manager --force
fi
```

### Troubleshooting Examples

```bash
# Diagnose issues
squeaky doctor

# Check specific tools
squeaky list --type package-manager
which npm yarn pnpm

# Permission fixes (macOS/Linux)
sudo chown -R $(whoami) ~/.npm ~/.yarn

# Reset configuration
squeaky config --reset
```

---

## Exit Codes

Squeaky Clean uses standard exit codes:

- `0` - Success
- `1` - General error (permission issues, invalid arguments, etc.)
- `2` - Configuration error
- `130` - Interrupted by user (Ctrl+C)

---

## Configuration File Location

- **macOS**: `~/Library/Preferences/squeaky-clean-nodejs/config.json`
- **Linux**: `~/.config/squeaky-clean/config.json`
- **Windows**: `%APPDATA%/squeaky-clean/config.json`

Use `squeaky config --path` to see the exact location on your system.

---

## Getting Help

```bash
# General help
squeaky --help

# Command-specific help
squeaky config --help
squeaky clean --help
squeaky list --help

# Check version
squeaky --version

# Diagnose issues
squeaky doctor
```
