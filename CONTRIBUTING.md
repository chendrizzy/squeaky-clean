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

### 1. Create Cleaner File

Create a new file in `src/cleaners/` (e.g., `redis.ts`):

```typescript
import execa from 'execa';
import { CacheInfo, ClearResult, CleanerModule } from '../types';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import { printVerbose } from '../utils/cli';
import * as os from 'os';
import * as path from 'path';

export class RedisCleaner implements CleanerModule {
  name = 'redis';
  type = 'database' as const;
  description = 'Redis database cache files and logs';

  async isAvailable(): Promise<boolean> {
    try {
      await execa('redis-cli', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const paths: string[] = [];
    let totalSize = 0;

    // Add Redis cache detection logic here
    // Check common Redis cache locations
    
    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths,
      isInstalled: await this.isAvailable(),
      size: totalSize,
    };
  }

  async clear(dryRun = false): Promise<ClearResult> {
    const cacheInfo = await this.getCacheInfo();
    
    if (!cacheInfo.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'Redis is not available',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    // Add clearing logic here
    
    return {
      name: this.name,
      success: true,
      clearedPaths: cacheInfo.paths,
      sizeBefore: cacheInfo.size,
      sizeAfter: 0,
    };
  }
}

export default new RedisCleaner();
```

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
