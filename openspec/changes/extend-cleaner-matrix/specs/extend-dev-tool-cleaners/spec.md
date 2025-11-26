# extend-dev-tool-cleaners

## ADDED Requirements

### Requirement: Provide a Rust Cargo cleaner that detects Cargo installs and reports/clears cache paths (`~/.cargo/registry`, `~/.cargo/git`) and optional workspace `target/` directories with dry-run support and category-level selection.
The system MUST surface Cargo caches, respect opt-in for workspace `target/`, and allow dry-run/category filtering.
#### Scenario: Rust toolchain installed
- Given Cargo is available on PATH
- When the user runs cache discovery
- Then the cleaner reports registry and git cache sizes (and `target/` only when explicitly included or under `--all`) with `isInstalled=true`.
#### Scenario: Rust toolchain absent
- Given Cargo is not available
- When discovery runs
- Then the cleaner returns `isInstalled=false` without error and is skipped during clean.

### Requirement: Implement Maven cleaner aligned to the existing `tools.maven` config flag, covering `~/.m2/repository` and wrapper distributions, with safe dry-run and removal.
The system MUST discover Maven caches, honor the config toggle, and support preview versus removal.
#### Scenario: Maven caches present
- Given `~/.m2/repository` exists
- When cache info is requested
- Then paths include repository and wrapper cache, and dry-run shows planned removals without deleting files.
#### Scenario: Maven disabled in config
- Given `tools.maven=false`
- When cleaning is invoked
- Then Maven caches are not scanned or removed.

### Requirement: Add Python environment manager cleaners for Poetry and Pipenv that detect tool presence and clean `~/.cache/pypoetry` and `~/.cache/pipenv` respectively with category-aware removal (e.g., downloads vs. virtualenvs if present).
The system MUST detect Poetry/Pipenv, report their caches, and allow dry-run and per-category clearing.
#### Scenario: Poetry installed
- Given Poetry is on PATH
- When cache info runs
- Then the cleaner reports poetry cache directories and supports dry-run before deletion.
#### Scenario: Pipenv not installed
- Given Pipenv is absent
- When cache info runs
- Then the cleaner returns `isInstalled=false` and no removal occurs.

### Requirement: Add Apple dependency manager cleaners for CocoaPods (`~/Library/Caches/CocoaPods`) and Swift Package Manager (`~/Library/Caches/org.swift.swiftpm`), respecting platform-specific paths and avoiding overlap with Xcode derived data unless explicitly included.
The system MUST expose CocoaPods and SwiftPM caches on macOS, skip on other OSes, and avoid clearing Xcode derived data unless opted in.
#### Scenario: macOS developer with pods and SwiftPM caches
- Given the caches exist on macOS
- When the user runs `squeaky list --types package-manager`
- Then CocoaPods and SwiftPM appear with cache sizes and can be cleaned with dry-run and confirmation.
#### Scenario: Non-macOS platform
- Given the OS is not macOS
- When discovery runs
- Then these cleaners mark `isInstalled=false` without errors.

### Requirement: Introduce a NuGet/.NET cleaner that handles `~/.nuget/packages` and HTTP caches (`~/.nuget/v3-cache`, platform equivalents), with detection via `dotnet`/`nuget` presence and config toggle.
The system MUST detect NuGet/dotnet availability, map platform-specific cache paths, and support dry-run cleaning.
#### Scenario: dotnet SDK installed
- Given `dotnet --info` succeeds
- When cache info runs
- Then NuGet cache paths and sizes are reported and can be removed (or previewed) respecting dry-run.
#### Scenario: Windows environment
- Given the cleaner runs on Windows
- When determining cache paths
- Then it uses `%USERPROFILE%\\.nuget\\packages` and `%LOCALAPPDATA%\\NuGet\\v3-cache` equivalents.
