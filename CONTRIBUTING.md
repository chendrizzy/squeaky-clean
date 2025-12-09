# Contributing to Squeaky Clean

Thank you for your interest in contributing to Squeaky Clean! 🎉 This guide will help you get started with contributing to this project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Adding New Cache Cleaners](#adding-new-cache-cleaners)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Style Guide](#style-guide)
- [Issue Guidelines](#issue-guidelines)

## 🤝 Code of Conduct

This project and everyone participating in it is governed by our commitment to creating a welcoming and inclusive environment. Please be respectful and constructive in all interactions.

## 🛠️ Ways to Contribute

### 🐛 Bug Reports
- Report bugs using GitHub Issues
- Include clear reproduction steps
- Provide system information (OS, Node.js version, tool versions)
- Include error messages and logs

### 💡 Feature Requests
- Suggest new cache cleaners for popular developer tools
- Request CLI improvements or new commands
- Propose performance enhancements
- Share ideas for better user experience

### 🔧 Code Contributions
- Fix bugs and improve existing cleaners
- Add new cache cleaner modules
- Enhance CLI commands and output
- Improve error handling and edge cases
- Add tests and improve coverage

### 📖 Documentation
- Improve README and guides
- Add examples and use cases
- Fix typos and clarity issues
- Translate documentation (future)

## 🚀 Getting Started

### Prerequisites
- Node.js >= 16.0.0
- npm or yarn
- Git

### Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/squeaky-clean.git
cd squeaky-clean

# Add upstream remote
git remote add upstream https://github.com/justinchen/squeaky-clean.git
```

### Install Dependencies

```bash
npm install
```

### Development Setup

```bash
# Build the project
npm run build

# Run tests
npm test

# Run in development mode
npm run dev -- --help

# Run linting
npm run lint

# Format code
npm run format
```

## 🔄 Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Make Changes

- Follow the existing code style and patterns
- Add tests for new functionality
- Update documentation as needed
- Test your changes thoroughly

### 3. Run Tests and Linting

```bash
# Run all tests
npm test

# Run specific tests
npm test -- --run src/__tests__/cleaners/your-cleaner.test.ts

# Check linting
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

### 4. Commit Changes

```bash
git add .
git commit -m "feat: add support for Redis cache cleaning"
```

**Commit Message Format:**
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Test additions/changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## 🧹 Adding New Cache Cleaners

### Quick Start: Use the Generator (Recommended)

The easiest way to add a new cleaner is using the interactive generator:

```bash
npm run generate:cleaner
```

This will prompt you for:
- Tool name and description
- Cache type (package-manager, build-tool, ide, system, browser)
- Cache paths for each platform (macOS, Linux, Windows)

The generator creates properly structured cleaner and test files following all modern patterns.

### Manual Creation

If you prefer to create a cleaner manually, follow this pattern:

#### 1. Create Cleaner File

Create a new file in `src/cleaners/` (e.g., `redis.ts`):

```typescript
import { promises as fs } from "fs";
import path from "path";
import * as os from "os";
import execa from "execa";
import {
  CacheInfo,
  ClearResult,
  CleanerModule,
  CacheCategory,
  CacheSelectionCriteria,
} from "../types";
import {
  getDirectorySize,
  getEstimatedDirectorySize,
  pathExists,
  safeRmrf,
} from "../utils/fs";
import { printVerbose } from "../utils/cli";

export class RedisCleaner implements CleanerModule {
  name = "redis";
  type = "database" as const;
  description = "Redis database cache files, logs, and temporary data";

  /**
   * Define cache paths for each platform with metadata
   */
  private getCachePaths(): Array<{
    path: string;
    description: string;
    category: string;
    priority: "critical" | "important" | "normal" | "low";
    safeToDelete: boolean;
  }> {
    const homeDir = os.homedir();
    const platform = process.platform;

    const paths: Array<{
      path: string;
      description: string;
      category: string;
      priority: "critical" | "important" | "normal" | "low";
      safeToDelete: boolean;
    }> = [];

    if (platform === "darwin") {
      // macOS cache paths
      paths.push(
        {
          path: path.join(homeDir, ".redis", "cache"),
          description: "Redis client cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: path.join(homeDir, "Library", "Logs", "redis"),
          description: "Redis logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
      );
    } else if (platform === "win32") {
      // Windows cache paths
      const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      paths.push({
        path: path.join(appData, "Redis", "cache"),
        description: "Redis client cache",
        category: "cache",
        priority: "low",
        safeToDelete: true,
      });
    } else {
      // Linux cache paths
      const cacheDir = process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache");
      paths.push(
        {
          path: path.join(cacheDir, "redis"),
          description: "Redis client cache",
          category: "cache",
          priority: "low",
          safeToDelete: true,
        },
        {
          path: "/var/log/redis",
          description: "Redis server logs",
          category: "logs",
          priority: "low",
          safeToDelete: true,
        },
      );
    }

    return paths;
  }

  async isAvailable(): Promise<boolean> {
    // Check for cache directories
    const cachePaths = this.getCachePaths();
    for (const { path: cachePath } of cachePaths) {
      if (await pathExists(cachePath)) {
        return true;
      }
    }

    // Also check if Redis CLI is installed
    try {
      await execa("redis-cli", ["--version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const cachePaths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;

    for (const { path: cachePath, safeToDelete } of cachePaths) {
      if (!safeToDelete) continue;

      if (await pathExists(cachePath)) {
        existingPaths.push(cachePath);
        const size = await getEstimatedDirectorySize(cachePath);
        totalSize += size;
        printVerbose(`📁 ${cachePath}: ${(size / (1024 * 1024)).toFixed(1)} MB`);
      }
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: existingPaths,
      isInstalled: await this.isAvailable(),
      size: totalSize,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const cachePaths = this.getCachePaths();
    const categoryMap = new Map<string, CacheCategory>();

    for (const { path: cachePath, description, category, priority, safeToDelete } of cachePaths) {
      if (!safeToDelete) continue;
      if (!(await pathExists(cachePath))) continue;

      const size = await getDirectorySize(cachePath);
      let stats;
      try {
        stats = await fs.stat(cachePath);
      } catch {
        stats = null;
      }

      const categoryId = `redis-${category}`;
      const existing = categoryMap.get(categoryId);

      if (existing) {
        existing.paths.push(cachePath);
        existing.size = (existing.size || 0) + size;
      } else {
        categoryMap.set(categoryId, {
          id: categoryId,
          name: `Redis ${category}`,
          description,
          paths: [cachePath],
          size,
          lastModified: stats?.mtime,
          priority,
          useCase: "development",
        });
      }
    }

    return Array.from(categoryMap.values());
  }

  async clear(
    dryRun = false,
    _criteria?: CacheSelectionCriteria,
    _cacheInfo?: CacheInfo,
    protectedPaths?: string[],
  ): Promise<ClearResult> {
    const cachePaths = this.getCachePaths();
    const clearedPaths: string[] = [];
    let sizeBefore = 0;
    let sizeAfter = 0;

    for (const { path: cachePath, description, safeToDelete } of cachePaths) {
      if (!safeToDelete) continue;
      if (!(await pathExists(cachePath))) continue;

      // Check if path is protected
      if (protectedPaths?.some((p) => cachePath.startsWith(p))) {
        printVerbose(`  Skipping protected path: ${cachePath}`);
        continue;
      }

      const pathSize = await getDirectorySize(cachePath);
      sizeBefore += pathSize;

      if (dryRun) {
        printVerbose(
          `[DRY RUN] Would clear: ${description} (${(pathSize / (1024 * 1024)).toFixed(1)} MB)`,
        );
        clearedPaths.push(cachePath);
      } else {
        try {
          await safeRmrf(cachePath);
          clearedPaths.push(cachePath);
          printVerbose(`✓ Cleared: ${description}`);
        } catch (error) {
          printVerbose(`✗ Failed to clear ${description}: ${error}`);
        }
      }
    }

    if (!dryRun) {
      for (const { path: cachePath, safeToDelete } of cachePaths) {
        if (!safeToDelete) continue;
        if (await pathExists(cachePath)) {
          sizeAfter += await getDirectorySize(cachePath);
        }
      }
    }

    return {
      name: this.name,
      success: true,
      sizeBefore,
      sizeAfter: dryRun ? sizeBefore : sizeAfter,
      clearedPaths,
    };
  }

  async clearByCategory(
    categoryIds: string[],
    dryRun = false,
    _cacheInfo?: CacheInfo,
    protectedPaths?: string[],
  ): Promise<ClearResult> {
    const categories = await this.getCacheCategories();
    const targetCategories = categories.filter((c) => categoryIds.includes(c.id));
    const clearedPaths: string[] = [];
    let sizeBefore = 0;
    let sizeAfter = 0;

    for (const category of targetCategories) {
      for (const cachePath of category.paths) {
        if (!(await pathExists(cachePath))) continue;

        if (protectedPaths?.some((p) => cachePath.startsWith(p))) {
          printVerbose(`  Skipping protected path: ${cachePath}`);
          continue;
        }

        const pathSize = await getDirectorySize(cachePath);
        sizeBefore += pathSize;

        if (dryRun) {
          printVerbose(
            `[DRY RUN] Would clear: ${category.name} (${(pathSize / (1024 * 1024)).toFixed(1)} MB)`,
          );
          clearedPaths.push(cachePath);
        } else {
          try {
            await safeRmrf(cachePath);
            clearedPaths.push(cachePath);
            printVerbose(`✓ Cleared: ${category.name}`);
          } catch (error) {
            printVerbose(`✗ Failed to clear ${category.name}: ${error}`);
          }
        }
      }
    }

    return {
      name: this.name,
      success: true,
      sizeBefore,
      sizeAfter: dryRun ? sizeBefore : sizeAfter,
      clearedPaths,
      clearedCategories: categoryIds,
    };
  }
}

export default new RedisCleaner();
```

#### Key Pattern Elements

- **`getCachePaths()`**: Private method returning path metadata for each platform
- **`safeToDelete`**: Boolean flag to protect user data from accidental deletion
- **`protectedPaths`**: Parameter in `clear()` and `clearByCategory()` for path exclusion
- **Platform detection**: Use `process.platform` to handle macOS, Windows, and Linux
- **Category support**: Enable granular cache control via `getCacheCategories()`

### 2. Register the Cleaner

Add your cleaner to `src/cleaners/index.ts`:

```typescript
import redisCleaner from './redis';

// Add to appropriate category
export const databaseCleaners = [
  redisCleaner,
];

// Add to allCleaners array
export const allCleaners = [
  // ... existing cleaners
  ...databaseCleaners,
];
```

### 3. Add Tests

Create `src/__tests__/cleaners/redis.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import redisCleaner from '../../cleaners/redis';

vi.mock('execa', () => ({
  default: vi.fn(),
}));

describe('RedisCleaner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct properties', () => {
    expect(redisCleaner.name).toBe('redis');
    expect(redisCleaner.type).toBe('database');
    expect(redisCleaner.description).toContain('Redis');
  });

  // Add more tests...
});
```

### 4. Update Configuration

Add the new cache type to `src/types/index.ts` if needed:

```typescript
export type CacheType = 
  | 'package-manager'
  | 'build-tool'
  | 'ide'
  | 'browser'
  | 'system'
  | 'database'; // Add new type
```

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- --run src/__tests__/cleaners/your-cleaner.test.ts

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

### Test Structure

- **Unit Tests**: Test individual cleaners in `src/__tests__/cleaners/`
- **Integration Tests**: Test CacheManager and CLI in `src/test/`
- **Mocking**: Use vitest mocking for external commands and file system operations

### Test Guidelines

1. **Mock External Dependencies**: Always mock `execa`, file system operations, and OS calls
2. **Test All Methods**: Cover `isAvailable()`, `getCacheInfo()`, and `clear()`
3. **Test Error Cases**: Include tests for command failures and missing tools
4. **Cross-Platform**: Test platform-specific behavior where applicable
5. **Descriptive Names**: Use clear, descriptive test names

## 📋 Pull Request Process

### Before Submitting

- [ ] Tests pass: `npm test`
- [ ] Linting passes: `npm run lint`
- [ ] Code is formatted: `npm run format`
- [ ] Documentation updated if needed
- [ ] CHANGELOG.md updated for significant changes

### PR Description Template

```markdown
## Description
Brief description of the changes and motivation.

## Type of Change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Changes Made
- List specific changes made

## Testing
- [ ] Added tests for new functionality
- [ ] All existing tests pass
- [ ] Tested on multiple platforms (if applicable)

## Screenshots/Examples
Include screenshots or example output if applicable.

## Checklist
- [ ] Code follows the project's style guidelines
- [ ] Self-review completed
- [ ] Tests added/updated
- [ ] Documentation updated
```

### Review Process

1. **Automated Checks**: CI/CD will run tests and linting
2. **Code Review**: Maintainers will review code quality and design
3. **Testing**: Changes will be tested across different environments
4. **Merge**: Once approved, changes will be merged

## 📝 Style Guide

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow existing code patterns and structure
- Use meaningful variable and function names
- Add type annotations for public APIs
- Use `const` for constants, `let` for variables
- Prefer arrow functions for short functions

### Code Organization

- Keep files focused and cohesive
- Use descriptive file names
- Follow the existing directory structure
- Import statements at the top, organized by type

### Comments and Documentation

- Use JSDoc comments for public APIs
- Add inline comments for complex logic
- Update README.md for user-facing changes
- Include examples in documentation

### Error Handling

- Handle errors gracefully
- Provide meaningful error messages
- Log errors appropriately using `printVerbose`
- Don't crash on recoverable errors

## 📧 Issue Guidelines

### Bug Reports

Include:
- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node.js version, tool versions)
- Error messages and stack traces
- Relevant configuration

### Feature Requests

Include:
- Clear description of the proposed feature
- Use cases and motivation
- Possible implementation approach
- Impact on existing functionality

### Questions

- Check existing documentation first
- Search existing issues
- Provide context about what you're trying to achieve
- Include relevant code or configuration

## 🎯 Good First Issues

Looking for ways to contribute? Check out issues labeled:
- `good first issue` - Perfect for newcomers
- `help wanted` - Community help needed
- `bug` - Bug fixes needed
- `enhancement` - Feature improvements

## 📞 Getting Help

- **GitHub Issues**: For bugs, features, and questions
- **GitHub Discussions**: For general discussion and ideas
- **Code Review**: Tag maintainers in PRs for review

## 🏆 Recognition

Contributors are recognized in:
- CHANGELOG.md for each release
- README.md contributors section
- GitHub contributors graph

---

Thank you for contributing to Squeaky Clean! Together we can make developer workflows more efficient and disk space more available. ✨
