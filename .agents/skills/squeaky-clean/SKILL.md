```markdown
# squeaky-clean Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns, coding conventions, and collaborative workflows used in the `squeaky-clean` TypeScript project. The repository is organized for clarity and maintainability, with a focus on robust feature development, cross-platform support, and comprehensive testing using Vitest. No framework is used; the codebase is structured with modular directories for commands, cleaners, safety checks, and utilities.

---

## Coding Conventions

### File Naming

- Use **camelCase** for file and directory names.
  - Example: `fileCleaner.ts`, `configLoader.ts`

### Import Style

- Use **relative imports** for all internal modules.
  - Example:
    ```typescript
    import { cleanTempFiles } from '../utils/fileCleaner';
    ```

### Export Style

- **Mixed exports** are used (both named and default exports).
  - Example:
    ```typescript
    // Named export
    export function cleanCache() { ... }

    // Default export
    export default cleanCache;
    ```

### Commit Message Style

- Use **Conventional Commits** with prefixes: `feat`, `fix`, `ci`.
  - Example: `feat: add deep cleaning for temp directories`

---

## Workflows

### Feature Development with Tests and Docs

**Trigger:** When adding a significant new capability or architectural change  
**Command:** `/feature-workflow`

1. Implement core feature logic in one of:
    - `src/cleaners/`
    - `src/commands/`
    - `src/safety/`
2. Update or create relevant type definitions in `src/types/`.
3. Update configuration or utility logic in `src/config/` or `src/utils/`.
4. Add or update unit and regression tests in `src/__tests__/`.
5. Update CLI documentation in `docs/cli-reference.md` and/or `docs/configuration-guide.md`.
6. Update `README.md` to reflect new features or changes.

**Example:**
```typescript
// src/cleaners/tempCleaner.ts
export function cleanTempFiles() {
  // implementation
}
```
```typescript
// src/__tests__/tempCleaner.test.ts
import { cleanTempFiles } from '../cleaners/tempCleaner';
import { describe, it, expect } from 'vitest';

describe('cleanTempFiles', () => {
  it('removes temp files', () => {
    // test logic
  });
});
```

---

### Cross-Platform Bugfix and Test Extension

**Trigger:** When ensuring correct behavior across Linux, Windows, and macOS  
**Command:** `/cross-platform-fix`

1. Identify and fix platform-specific issues in:
    - `src/cleaners/`
    - `src/utils/`
2. Update or add new tests in `src/__tests__/` to cover the fixed behaviors.
3. Add or update OS-specific test suites in `src/__tests__/os/`.
4. Update CI configuration to ensure new tests run on all platforms:
    - `.github/workflows/ci.yml`
    - `vitest.config.ts`
    - `vitest.os.config.ts`

**Example:**
```typescript
// src/utils/pathHelper.ts
export function normalizePath(input: string): string {
  // platform-specific normalization
}
```
```typescript
// src/__tests__/os/pathHelper.windows.test.ts
import { normalizePath } from '../../utils/pathHelper';
import { describe, it, expect } from 'vitest';

describe('normalizePath (Windows)', () => {
  it('handles backslashes', () => {
    expect(normalizePath('C:\\temp\\file')).toBe('C:/temp/file');
  });
});
```

---

## Testing Patterns

- **Framework:** [Vitest](https://vitest.dev/)
- **Test files:** Named with `.test.ts` suffix and placed in `src/__tests__/` (including subdirectories for OS-specific tests).
- **Test Example:**
  ```typescript
  // src/__tests__/cleaner.test.ts
  import { cleanCache } from '../cleaners/cacheCleaner';
  import { describe, it, expect } from 'vitest';

  describe('cleanCache', () => {
    it('cleans cache directory', () => {
      // test implementation
    });
  });
  ```

---

## Commands

| Command               | Purpose                                                        |
|-----------------------|----------------------------------------------------------------|
| /feature-workflow     | Start a new feature branch with code, tests, and documentation |
| /cross-platform-fix   | Begin a cross-platform bugfix and extend test coverage         |
```
