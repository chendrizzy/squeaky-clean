# Repository Guidelines

## Project Structure & Module Organization
- `src/cli.ts` is the CLI entry; `src/commands/` holds command handlers (`clean`, `list`, `sizes`, etc.).
- `src/cleaners/` contains per-tool cleaner modules; mirror naming when adding new tools.
- Shared helpers live in `src/utils/`; configuration helpers in `src/config/`; plugin/profile support in `src/plugins/` and `src/profiles/`.
- Tests reside in `src/__tests__/` with fixtures/utilities in `src/test/`. Built output goes to `dist/`. Docs live in `docs/` (user-facing) and `docs-dev/` (internal). Helper scripts are in `scripts/`; JSON schemas in `schemas/`.

## Build, Test, and Development Commands
- `npm run dev -- --help` — run the TypeScript CLI via `tsx` for quick iteration.
- `npm run build` — compile to `dist/` via `tsc`; use before packaging.
- `npm start` — execute the built CLI from `dist/`.
- `npm test` / `npm run test:watch` — run Vitest suites once or in watch mode.
- `npm run test:coverage` — enforce coverage thresholds (80% global).
- `npm run lint` / `npm run lint:fix` — ESLint over `src`.
- `npm run format` — Prettier on `src/**/*.{ts,tsx,json}`.
- `npm run generate:cleaner` — scaffold a new cleaner module.

## Coding Style & Naming Conventions
- TypeScript-first; prefer 2-space indent, single quotes, and Prettier defaults.
- Keep modules small; share logic through `src/utils/`. Use the `@` alias for imports from `src/`.
- File naming: kebab-case for modules (`redis.ts`), `*.test.ts` for tests. CLI flags and config keys are kebab-case.
- Lint must pass; avoid disabling rules unless justified inline.

## Testing Guidelines
- Framework: Vitest (Node env, globals enabled). Setup file: `src/test/setup.ts`.
- Place unit tests near feature folders under `src/__tests__/...`. Use fixtures/helpers from `src/test/` to avoid duplication.
- Target ≥80% coverage; run `npm run test:coverage` before PRs. Mock external processes and filesystem effects; avoid touching real caches.
- Name tests by feature (e.g., `src/__tests__/cleaners/npm.test.ts`); cover both dry-run and execute paths.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, etc.). Examples from history: `feat(spec): ...`, `fix(package): ...`.
- Before submitting: `npm run lint` and `npm test` (add `npm run test:coverage` for new features).
- PRs should include: summary of behavior change, test notes/results, linked issue, and any CLI output screenshots for UX changes. Update docs or schemas when modifying CLI surface or cleaner behaviors.
- Keep commits focused; avoid bundling unrelated refactors with feature work.

## Security & Configuration Tips
- Do not commit secrets or machine paths; keep user-specific config in `~/.config/squeaky-clean` or project-local config files added to `.gitignore` when appropriate.
- Prefer dry-run flows when modifying cleaner logic; guard destructive operations with confirmations/flags and tests that assert no side effects in default modes.
