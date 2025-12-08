# Configuration Guide

Complete guide to configuring Squeaky Clean for your development environment.

## Table of Contents

- [Quick Start](#quick-start)
- [Interactive Configuration Wizard](#interactive-configuration-wizard)
- [Command-Line Configuration](#command-line-configuration)
- [Configuration File Reference](#configuration-file-reference)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

The fastest way to get started with Squeaky Clean is using the interactive configuration wizard:

```bash
# Launch the interactive wizard
squeaky config --interactive
```

This will guide you through all configuration options step-by-step.

---

## Interactive Configuration Wizard

### Overview

The interactive wizard provides a user-friendly way to configure Squeaky Clean without needing to remember command-line options or edit configuration files manually.

### Starting the Wizard

```bash
squeaky config --interactive
# or
squeaky config -i
```

### Step-by-Step Walkthrough

#### Step 1: 📝 Output Preferences

Configure how Squeaky Clean displays information:

**Verbose Output**
- **Enabled**: Shows detailed information about operations, file paths, and debugging info
- **Disabled**: Shows only essential information
- **Recommended**: Enabled for first-time users, disabled for regular use

**Colored Output**
- **Enabled**: Uses colors and emojis for better readability
- **Disabled**: Plain text output (useful for CI/CD, logging, or terminals without color support)
- **Recommended**: Enabled for interactive use

```
📝 Step 1: Output Preferences
? Enable verbose output (shows detailed information)? Yes
? Enable colored output (recommended for terminals that support colors)? Yes
```

#### Step 2: 🔒 Safety Settings

Configure safety and confirmation behavior:

**Require Confirmation**
- **Yes**: Asks for confirmation before cleaning caches (recommended)
- **No**: Proceeds with cleaning without asking (use with caution)
- **Recommended**: Yes, especially when first learning the tool

```
🔒 Step 2: Safety Preferences
? Require confirmation before cleaning caches (recommended for safety)? Yes
```

#### Step 3: 🔧 Tool Configuration

This is the most important step - configure which cache cleaners should be enabled.

Tools are organized by categories for easier management:

##### 📦 Package Manager Tools
- **npm** - NPM package manager cache and temporary files
- **yarn** - Yarn package manager caches and global store
- **pnpm** - PNPM package manager store and caches  
- **bun** - Bun runtime and package manager caches
- **pip** - Python pip package manager caches and temporary files

**Recommendation**: Enable the package managers you actually use.

##### 🔨 Build Tool Tools
- **webpack** - Webpack build caches and temporary files
- **vite** - Vite build tool caches and temporary files
- **nx** - NX monorepo build tool caches
- **turbo** - Turborepo build system caches
- **flutter** - Flutter SDK caches, pub cache, and project build artifacts
- **gradle** - Gradle build cache, daemon logs, wrapper distributions

**Recommendation**: Enable build tools you use regularly. These are generally safe to clean.

##### 💻 IDE Tools
- **vscode** - VS Code extensions cache, workspace storage, logs
- **xcode** - Xcode cache, derived data, archives, simulators, device support files
- **androidstudio** - Android Studio IDE caches, build files, Gradle integration
- **jetbrains** - JetBrains IDEs (WebStorm, IntelliJ, PhpStorm, etc.) caches and logs

**Recommendation**: Enable IDEs you use. Xcode can save significant space (2-15 GB).

##### 🌐 Browser Tools
- **chrome** - Chrome DevTools cache, service worker cache, development storage
- **firefox** - Firefox cache, temporary files, developer profile data

**Recommendation**: Be cautious with browser cleaners as they may affect your browsing experience.

##### ⚙️ System Tools
- **docker** - Docker images, containers, volumes, networks, build cache

**Recommendation**: Only enable if you understand Docker and are comfortable managing containers.

#### Step 4: 📋 Review & Apply

The wizard shows a summary of your configuration before applying:

```
📋 Step 4: Review Configuration

Your new configuration will be:
  📁 Verbose output: enabled
  📁 Colored output: enabled
  📁 Require confirmation: yes

🔧 Enabled tools:
     ✓ npm
     ✓ yarn
     ✓ webpack
     ✓ vscode
     ✓ xcode

🔧 Disabled tools:
     ✗ chrome
     ✗ docker
     ✗ jetbrains

? Apply this configuration? Yes
```

Select "Yes" to save your configuration, or "No" to cancel without making changes.

---

## Command-Line Configuration

For quick changes or automation, use the command-line configuration options:

### Show Current Configuration

```bash
squeaky config
```

### Quick Settings Changes

```bash
# Enable/disable verbose output
squeaky config --set verbose=true
squeaky config --set verbose=false

# Enable/disable colors
squeaky config --set colors=true
squeaky config --set colors=false
```

### Tool Management

```bash
# Enable specific tools (space-separated)
squeaky config --enable npm docker vscode

# Disable specific tools
squeaky config --disable chrome jetbrains
```

### Update Checks

```bash
# Disable background update checks
squeaky update --disable-auto

# Re-enable background checks (every 24h by default)
squeaky update --auto-on

# Check without installing
squeaky update --check
```

### Get Specific Values

```bash
# Check if verbose is enabled
squeaky config --get verbose

# Check color setting
squeaky config --get colors
```

### Bulk Operations

```bash
# Enable all package managers in one command
squeaky config --enable npm yarn pnpm

# Or mix tool types together
squeaky config --enable npm yarn pnpm webpack vite
```

---

## Configuration File Reference

### Location

The configuration file is stored in:
- **macOS**: `~/Library/Preferences/squeaky-clean-nodejs/config.json`
- **Linux**: `~/.config/squeaky-clean/config.json`
- **Windows**: `%APPDATA%/squeaky-clean/config.json`

Check the exact location on your system:
```bash
squeaky config --path
```

### File Structure

```json
{
  \"enabledCaches\": {
    \"packageManagers\": true,
    \"buildTools\": true,
    \"browsers\": false,
    \"ides\": true,
    \"system\": false
  },
  \"tools\": {
    \"npm\": true,
    \"yarn\": true,
    \"pnpm\": true,
    \"bun\": false,
    \"pip\": false,
    \"webpack\": true,
    \"vite\": true,
    \"nx\": false,
    \"turbo\": false,
    \"flutter\": false,
    \"gradle\": false,
    \"vscode\": true,
    \"xcode\": true,
    \"androidstudio\": false,
    \"jetbrains\": false,
    \"chrome\": false,
    \"firefox\": false,
    \"docker\": false
  },
  \"safety\": {
    \"requireConfirmation\": true,
    \"dryRunDefault\": false,
    \"backupBeforeClearing\": false,
    \"excludeSystemCritical\": true
  },
  \"output\": {
    \"verbose\": false,
    \"showSizes\": true,
    \"useColors\": true
  },
  \"customPaths\": []
}
```

### Manual Editing

You can manually edit the configuration file, but it's recommended to use the CLI commands or interactive wizard to avoid syntax errors.

After manual editing, validate your configuration:
```bash
squeaky config
```

---

## Best Practices

### Configuration Strategy

#### For New Users
1. Start with the interactive wizard: `squeaky config -i`
2. Enable only tools you recognize and use
3. Keep confirmation enabled (`requireConfirmation: true`)
4. Enable verbose output initially to understand what's happening

#### For Regular Use
1. Disable verbose output for cleaner interface
2. Enable only tools you use regularly
3. Consider enabling size reporting for awareness
4. Set up automation for common tasks

#### For CI/CD Environments
1. Disable colors: `squeaky config --set colors=false`
2. Disable confirmation for automation
3. Use specific tool targeting: `--types package-manager,build-tool`
4. Consider using `--force` flag in scripts

### Tool Selection Guidelines

#### Always Safe to Enable
- **Package Managers**: npm, yarn, pnpm, bun, pip
- **Build Tools**: webpack, vite, nx, turbo, gradle, flutter
- **VS Code**: Generally safe and can reclaim significant space

#### Use with Caution
- **Browser tools**: May affect browsing experience
- **JetBrains IDEs**: May remove useful caches
- **Docker**: Can remove containers and images you might need

#### Environment-Specific
- **Xcode**: Only enable on macOS development machines
- **Android Studio**: Only enable if you do Android development
- **Flutter**: Only enable if you do Flutter development

### Performance Considerations

#### Size Reporting
- Enable `--sizes` flag when you want detailed information
- Disable for faster operations in automation
- Use `squeaky sizes` for size-only reporting

#### Automation
```bash
# Fast daily cleanup
squeaky clean --types package-manager,build-tool --force

# Weekly detailed cleanup
squeaky clean --all --sizes

# Monthly comprehensive review
squeaky list --sizes
```

---

## Troubleshooting

### Common Configuration Issues

#### Configuration Not Applied
```bash
# Check if changes were saved
squeaky config

# Reset if needed
squeaky config --reset
```

#### Tool Not Working
```bash
# Check tool availability
squeaky doctor

# Verify tool is enabled
squeaky config --get tools.npm
squeaky config --enable npm
```

#### Permission Issues
```bash
# Check configuration file permissions
squeaky config --path
ls -la $(squeaky config --path)

# Fix permissions (macOS/Linux)
chmod 644 $(squeaky config --path)
```

### Configuration Migration

#### From v1.x to v2.0
No migration needed - configuration files are compatible.

#### Backup Configuration
```bash
# Find config location
CONFIG_PATH=$(squeaky config --path)

# Backup configuration
cp \"$CONFIG_PATH\" \"$CONFIG_PATH.backup\"

# Restore if needed
cp \"$CONFIG_PATH.backup\" \"$CONFIG_PATH\"
```

### Reset Configuration

If configuration becomes corrupted or you want to start fresh:

```bash
# Reset to defaults
squeaky config --reset

# Run interactive setup again
squeaky config --interactive
```

### Validation

Validate your configuration:

```bash
# Check configuration file
squeaky config

# Test specific tools
squeaky list --type package-manager

# Run diagnostic
squeaky doctor
```

---

## Advanced Configuration

### Environment Variables

Override configuration with environment variables:

```bash
# Disable colors for current session
SQUEAKY_NO_COLOR=1 squeaky clean

# Force verbose mode
SQUEAKY_VERBOSE=1 squeaky clean
```

### Custom Cache Paths

For non-standard installations, add custom paths (future feature):

```json
{
  \"customPaths\": [
    \"/custom/path/to/npm-cache\",
    \"/another/custom/cache/location\"
  ]
}
```

### Configuration Profiles

For different environments, maintain separate config files:

```bash
# Development profile
cp $(squeaky config --path) ~/.squeaky-dev.json

# Production profile  
cp $(squeaky config --path) ~/.squeaky-prod.json

# Switch profiles (manual process)
cp ~/.squeaky-dev.json $(squeaky config --path)
```

---

## Getting Help

```bash
# Configuration help
squeaky config --help

# List all options
squeaky config --list

# Interactive setup
squeaky config --interactive

# Diagnose issues
squeaky doctor
```
