# Change Proposal: extend-cleaner-matrix

## Summary
- Expand cleaner coverage to high-impact dev ecosystems not yet supported (Rust, Java, Python env managers, Apple dependency tooling, .NET).
- Ship a reversible toggle that archives the CLI easter-egg animation by default while keeping a simple switch to re-enable.

## Current State (evidence)
- Supported tools span npm/yarn/pnpm/bun/pip/brew/nix; webpack/vite/nx/turbo/flutter/node-gyp/go-build; VS Code/Xcode/Android Studio/JetBrains; Chrome/Firefox; Docker/Gradle (per README and `src/cleaners/index.ts`).
- Easter-egg is hardcoded in `src/utils/cli.ts#showBootPristine` with a random trigger (5%) and audio playback.

## Proposed Additions (targeted impact)
- Rust: `cargo` registries (`~/.cargo/registry`, `~/.cargo/git`) and workspace `target/` to address Rust/Polyglot repos.
- Java: `maven` local repo (`~/.m2/repository`, wrapper dists) to complement Gradle and Android builds.
- Python env managers: `poetry` (`~/.cache/pypoetry`) and `pipenv` (`~/.cache/pipenv`) so Python teams aren't limited to pip.
- Apple dependency managers: `cocoapods` caches (`~/Library/Caches/CocoaPods`) and `swiftpm` (`~/Library/Caches/org.swift.swiftpm`) to pair with Xcode cleaner.
- .NET: `nuget` packages/cache (`~/.nuget/packages`, `~/.nuget/v3-cache`) for cross-platform .NET developers.

## Scope & Boundaries
- Add one cleaner per ecosystem with detection (CLI presence or cache path existence), cache introspection, dry-run, and category-level clearing where meaningful.
- Document new tools in Supported Tools and expose enable/disable via existing config.
- Easter-egg archived by default; add a config/flag (e.g., `funMode` or `bootAnimation`) that gates the animation and audio.

## Risks / Open Questions
- Platform-specific cache paths (Windows NuGet, CocoaPods on Linux runners) — need per-OS path maps.
- Audio asset (`epic.mp3`) handling when easter-egg disabled — remove load or guard to avoid shipping it on minimal builds?
- Safe defaults for workspace `target/` cleanup (Rust) to avoid wiping release artifacts unintentionally.

## Validation Plan
- Unit tests per cleaner: detection, cache info paths, dry-run vs destructive.
- Integration checks: `squeaky list`/`clean` includes new tools when enabled; default config keeps easter-egg off.
- Manual toggling: verify easter-egg flag enables/blocks animation and audio without affecting core flow.
