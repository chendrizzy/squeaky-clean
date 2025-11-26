# Design Notes: extend-cleaner-matrix

## Cleaner Architecture Alignment
- Follow existing `CleanerModule` shape and registration in `src/cleaners/index.ts`; new modules live in `src/cleaners/<tool>.ts` and expose `type`, `name`, `description`, `isAvailable`, `getCacheInfo`, `clear`, and (when useful) `clearByCategory`.
- Detection:
  - Prefer CLI presence (`cargo`, `mvn`, `poetry`, `pipenv`, `dotnet`, `nuget`, `pod`) with `execa` and fallback to cache path existence to support portable installs.
  - Mark `isInstalled` false without throwing when tool is absent; keep empty paths in `getCacheInfo` for graceful skip.
- Cache definitions & safety:
  - Provide category IDs to allow selective clearing: e.g., Cargo `registry`, `git`, `target`; Maven `repository`, `wrapper`; NuGet `packages`, `http-cache`; CocoaPods `cache`, `derived-specs`; SwiftPM `artifacts`, `repositories`; Poetry `cache`; Pipenv `cache`.
  - Guard workspace-destructive paths (e.g., Rust `target/`) behind explicit include or confirmation; default to cache directories only unless `--all` or a category opt-in is used.
- Cross-platform paths:
  - Use platform helpers to branch paths (`~/.nuget` vs `%USERPROFILE%\\.nuget`, macOS `~/Library/Caches`).
  - Avoid shell globbing; rely on fs-extra and utils for size calc and removal.

## Easter-Egg Toggle
- Introduce a boolean config flag (`funMode` or `bootAnimation`) in config defaults and CLI env mapping; default false.
- Gate `showBootPristine` entry point with the flag; skip loading audio/player when disabled to remove side effects and speed startup.
- Keep the animation/audio code path intact behind the switch to allow turnkey re-enable via config/flag/env.
- Consider moving audio asset loading behind a lazy import or optional dependency to keep headless environments clean.
