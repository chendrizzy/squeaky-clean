---
name: feature-development-with-tests-and-docs
description: Workflow command scaffold for feature-development-with-tests-and-docs in squeaky-clean.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-with-tests-and-docs

Use this workflow when working on **feature-development-with-tests-and-docs** in `squeaky-clean`.

## Goal

Implements a major feature, including code, tests, and documentation updates.

## Common Files

- `src/cleaners/*.ts`
- `src/commands/*.ts`
- `src/safety/*.ts`
- `src/types/*.ts`
- `src/config/*.ts`
- `src/utils/*.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Implement core feature logic in src/cleaners/, src/commands/, or src/safety/
- Update or create relevant type definitions in src/types/
- Update configuration or utility logic in src/config/ or src/utils/
- Add or update unit and regression tests in src/__tests__/
- Update CLI documentation in docs/cli-reference.md and/or docs/configuration-guide.md

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.