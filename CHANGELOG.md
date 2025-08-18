# Changelog

All notable changes to Squeaky Clean will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-01-18

### 🎉 Major Features Added

#### 🧙‍♂️ Interactive Configuration Wizard
- **NEW**: Complete interactive configuration wizard with step-by-step setup
- **Step 1**: Output preferences (verbose output, colored output)
- **Step 2**: Safety settings (confirmation requirements)  
- **Step 3**: Tool configuration organized by categories:
  - 📦 Package managers (npm, yarn, pnpm, bun, pip)
  - 🔨 Build tools (webpack, vite, nx, turbo, flutter, gradle)
  - 💻 IDEs (VS Code, Xcode, Android Studio, JetBrains)
  - 🌐 Browsers (Chrome, Firefox development caches)
  - ⚙️ System tools (Docker)
- **Step 4**: Configuration review and confirmation before applying changes
- Launch with: `squeaky config --interactive` or `squeaky config -i`

#### ⚡ Quick Configuration Commands
- **NEW**: `squeaky config --get <key>` - Get specific configuration values
- **NEW**: `squeaky config --set <key=value>` - Set configuration values quickly
- **NEW**: `squeaky config --enable <tool>` - Enable specific cache cleaners
- **NEW**: `squeaky config --disable <tool>` - Disable specific cache cleaners
- **NEW**: `squeaky config --path` - Show configuration file location
- **ENHANCED**: `squeaky config --list` - List all available configuration options

### 🔧 Improvements

#### Configuration Management
- **IMPROVED**: Better default behavior - `squeaky config` shows current configuration
- **IMPROVED**: More intuitive CLI option structure with short and long forms
- **IMPROVED**: Configuration organized by logical categories for easier management
- **ENHANCED**: Comprehensive help text for all configuration commands

#### User Experience
- **IMPROVED**: More informative error messages for configuration commands
- **IMPROVED**: Better validation of configuration keys and values
- **ENHANCED**: Color-coded output for enabled/disabled tools in configuration display
- **ENHANCED**: Clear indication of configuration file existence and location

### 🐛 Bug Fixes

#### CLI Interface
- **FIXED**: `squeaky config -i` flag now properly launches interactive wizard
- **FIXED**: Configuration command now properly handles all option combinations
- **FIXED**: Help documentation now accurately reflects available options

### 📖 Documentation

#### README Updates
- **ENHANCED**: Complete documentation of interactive configuration wizard
- **ADDED**: Step-by-step guide for using the configuration wizard
- **ADDED**: Examples of all new CLI configuration commands
- **IMPROVED**: Better organization of configuration documentation

### 🔄 Migration Guide

#### From v1.x to v2.0
- **No breaking changes** - All existing functionality remains the same
- **Enhanced**: Configuration is now more powerful and user-friendly
- **Recommended**: Run `squeaky config --interactive` to explore new configuration options
- **Note**: Configuration file format remains compatible

### ⚠️ Breaking Changes
- None - This release maintains full backward compatibility

---

## [1.0.0] - 2025-08-17

### ✨ Initial Release

**Squeaky Clean 1.0.0** is a comprehensive developer cache cleaning tool that helps you reclaim disk space by intelligently clearing caches from your development environment.

### 🚀 Features

#### Cache Cleaners (18 Total)
- **Package Managers** (5 cleaners)
  - `npm` - NPM package manager cache and temporary files
  - `yarn` - Yarn package manager caches and global store  
  - `pnpm` - PNPM package manager store and caches
  - `bun` - Bun runtime and package manager caches
  - `pip` - Python pip package manager caches and temporary files

- **Build Tools** (6 cleaners)  
  - `webpack` - Webpack build caches and temporary files
  - `vite` - Vite build tool caches and temporary files
  - `nx` - NX monorepo build tool caches
  - `turbo` - Turborepo build system caches
  - `gradle` - Gradle build cache, daemon logs, wrapper distributions, and temporary files
  - `flutter` - Flutter SDK caches, pub cache, and project build artifacts

- **IDEs & Development Environments** (4 cleaners)
  - `vscode` - VS Code extensions cache, workspace storage, logs, and temporary files
  - `xcode` - Xcode cache, derived data, archives, simulators, and device support files  
  - `androidstudio` - Android Studio IDE caches, build files, and gradle wrapper
  - `jetbrains` - JetBrains IDEs (WebStorm, IntelliJ, PhpStorm, etc.) caches and logs

- **Browsers** (2 cleaners)
  - `chrome` - Chrome development tools cache and temporary files
  - `firefox` - Firefox development tools cache and temporary files

- **System Tools** (1 cleaner)
  - `docker` - Docker images, containers, volumes, networks, and build cache

#### CLI Commands
- `squeaky clean` - Clean development caches with flexible filtering options
- `squeaky list` - List available caches and their status with size information
- `squeaky sizes` - Show cache sizes without cleaning
- `squeaky config` - Manage configuration settings interactively
- `squeaky auto` - Automatically clear caches based on smart detection
- `squeaky doctor` - Diagnose potential issues with cache clearing

#### Core Features
- **Smart Detection** - Automatically detects installed tools and available caches
- **Dry Run Mode** - Preview what will be cleaned before making changes (`--dry-run`)
- **Flexible Filtering** - Clean by type (`--types`), include/exclude specific tools
- **Size Reporting** - Shows cache sizes and space that would be freed
- **Cross-Platform** - Works on macOS, Windows, and Linux
- **Safe Operation** - Respects tool-specific cleaning mechanisms when available
- **Beautiful CLI** - Emoji-enhanced output with progress indicators
- **Configuration** - Persistent settings stored in `~/.config/squeaky-clean/config.json`

### 🛠️ Technical Highlights
- **162 Tests** with 87.5% pass rate covering all major functionality
- **Type-Safe** - Full TypeScript implementation with comprehensive type definitions
- **Modular Architecture** - Extensible cleaner system for easy addition of new tools
- **Error Handling** - Graceful handling of permissions, missing tools, and edge cases
- **Performance** - Efficient directory scanning with size estimation for large caches
- **Documentation** - Comprehensive README, testing guide, and inline help

### 🎯 Usage Examples

```bash
# Clean all configured caches
squeaky clean --all

# Clean only package manager caches  
squeaky clean --types package-manager

# Clean all except Chrome cache
squeaky clean --exclude chrome

# Show all caches with sizes
squeaky list --sizes

# Preview what would be cleaned (safe)
squeaky clean --dry-run

# Configure cache preferences interactively
squeaky config --interactive

# Smart automatic cleaning (safe mode)
squeaky auto --safe
```

### 🔧 Installation

```bash
# Install globally via npm
npm install -g squeaky-clean

# Or use directly with npx
npx squeaky-clean clean --all
```

### 📊 Project Stats
- **Package Size**: 70.1 kB compressed, 484.3 kB unpacked
- **Dependencies**: 9 runtime dependencies, all well-maintained
- **Node.js**: Requires Node.js >=16.0.0
- **Files**: 123 files included in package

### 🏗️ Architecture
- **CacheManager**: Orchestrates all cleaning operations
- **CleanerModule Interface**: Consistent API across all cleaners
- **Configuration System**: Type-safe configuration management
- **CLI Framework**: Built with Commander.js for robust command parsing
- **Cross-Platform**: Platform-specific path handling and tool detection

---

**Full Changelog**: [View on GitHub](https://github.com/justinchen/squeaky-clean/releases/tag/v1.0.0)
