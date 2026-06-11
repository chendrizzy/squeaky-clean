---
name: cross-platform-bugfix-and-test-extension
description: Workflow command scaffold for cross-platform-bugfix-and-test-extension in squeaky-clean.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /cross-platform-bugfix-and-test-extension

Use this workflow when working on **cross-platform-bugfix-and-test-extension** in `squeaky-clean`.

## Goal

Fixes platform-specific bugs and extends the test suite to cover new OS behaviors.

## Common Files

- `src/cleaners/*.ts`
- `src/utils/*.ts`
- `src/__tests__/**/*.test.ts`
- `src/__tests__/os/*.test.ts`
- `.github/workflows/ci.yml`
- `vitest.config.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Identify and fix platform-specific issues in implementation files (src/cleaners/, src/utils/)
- Update or add new tests in src/__tests__/ to cover the fixed behaviors
- Add or update OS-specific test suites in src/__tests__/os/
- Update CI configuration to ensure new tests run on all platforms

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.