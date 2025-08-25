#!/usr/bin/env node
/**
 * Generator script for creating new cleaner modules
 * Usage: npm run generate:cleaner <name> <type>
 * Example: npm run generate:cleaner rust-cargo package-manager
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';

const CLEANER_TEMPLATE = `import { BaseCleaner } from './BaseCleaner';
import { CacheInfo, CacheCategory, CacheType } from '../types';
import { existsSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { printVerbose } from '../utils/cli';

const execAsync = promisify(exec);

export class {{ClassName}}Cleaner extends BaseCleaner {
  name = '{{name}}';
  type: CacheType = '{{type}}';
  description = '{{description}}';

  private getCachePaths(): string[] {
    const paths: string[] = [];
    const homeDir = os.homedir();
    
    // TODO: Add cache path detection logic
    // Example paths:
    {{cachePaths}}
    
    return paths.filter(p => existsSync(p));
  }

  async isAvailable(): Promise<boolean> {
    try {
      // TODO: Check if {{name}} is installed
      {{availabilityCheck}}
      return true;
    } catch {
      // Check if cache directories exist
      const homeDir = os.homedir();
      {{fallbackCheck}}
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const paths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;
    let oldestCache: Date | undefined;
    let newestCache: Date | undefined;

    for (const cachePath of paths) {
      if (existsSync(cachePath)) {
        existingPaths.push(cachePath);
        const size = await this.getDirectorySize(cachePath);
        totalSize += size;
        
        try {
          const stat = statSync(cachePath);
          if (!oldestCache || stat.mtime < oldestCache) {
            oldestCache = stat.mtime;
          }
          if (!newestCache || stat.mtime > newestCache) {
            newestCache = stat.mtime;
          }
        } catch (error) {
          printVerbose(\`Error getting stats for \${cachePath}: \${error}\`);
        }
      }
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: existingPaths,
      isInstalled: await this.isAvailable(),
      totalSize: totalSize,
      oldestCache,
      newestCache,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    const categories: CacheCategory[] = [];
    const paths = this.getCachePaths();
    
    for (const cachePath of paths) {
      if (!existsSync(cachePath)) continue;
      
      // TODO: Categorize different cache types
      let categoryName = '{{defaultCategoryName}}';
      let priority: CacheCategory['priority'] = 'normal';
      let useCase: CacheCategory['useCase'] = 'development';
      
      try {
        const stat = statSync(cachePath);
        const size = await this.getDirectorySize(cachePath);
        
        categories.push({
          id: \`{{name}}-\${path.basename(cachePath)}\`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          name: categoryName,
          description: \`{{description}} cache at \${cachePath}\`,
          paths: [cachePath],
          size,
          lastModified: stat.mtime,
          lastAccessed: stat.atime,
          priority: this.getCachePriority(cachePath),
          useCase: this.detectUseCase(cachePath),
          isProjectSpecific: this.isProjectSpecific(cachePath),
          ageInDays: Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24)),
        });
      } catch (error) {
        printVerbose(\`Error analyzing \${cachePath}: \${error}\`);
      }
    }
    
    return categories;
  }
}

export default new {{ClassName}}Cleaner();`;

const TEST_TEMPLATE = `import { describe, it, expect, beforeEach, vi } from 'vitest';
import {{name}}Cleaner from '../cleaners/{{fileName}}';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';

vi.mock('fs');
vi.mock('os');
vi.mock('child_process');

describe('{{ClassName}}Cleaner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('should return true when {{name}} is installed', async () => {
      // TODO: Add test implementation
      const result = await {{name}}Cleaner.isAvailable();
      expect(result).toBeDefined();
    });

    it('should return false when {{name}} is not installed', async () => {
      // TODO: Add test implementation
      const result = await {{name}}Cleaner.isAvailable();
      expect(result).toBeDefined();
    });
  });

  describe('getCacheInfo', () => {
    it('should return cache information', async () => {
      // TODO: Add test implementation
      const info = await {{name}}Cleaner.getCacheInfo();
      expect(info.name).toBe('{{name}}');
      expect(info.type).toBe('{{type}}');
    });
  });

  describe('getCacheCategories', () => {
    it('should return cache categories', async () => {
      // TODO: Add test implementation
      const categories = await {{name}}Cleaner.getCacheCategories();
      expect(Array.isArray(categories)).toBe(true);
    });
  });
});`;

async function main() {
  console.log(chalk.bold.cyan('🚀 Squeaky Clean - Cleaner Generator\n'));

  // Get input from user
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Cleaner name (e.g., rust-cargo):',
      validate: (input) => {
        if (!input) return 'Name is required';
        if (!/^[a-z0-9-]+$/.test(input)) return 'Name must be lowercase with hyphens only';
        return true;
      },
    },
    {
      type: 'list',
      name: 'type',
      message: 'Cache type:',
      choices: [
        'package-manager',
        'build-tool',
        'browser',
        'ide',
        'system',
        'other',
      ],
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      default: (answers: any) => `${answers.name} cache and temporary files`,
    },
    {
      type: 'input',
      name: 'command',
      message: 'Command to check if installed (e.g., cargo --version):',
      default: (answers: any) => `${answers.name.split('-')[0]} --version`,
    },
    {
      type: 'input',
      name: 'cachePaths',
      message: 'Common cache paths (comma-separated):',
      default: (answers: any) => {
        const base = answers.name.split('-')[0];
        return `~/.${base}, ~/Library/Caches/${base}, ~/.cache/${base}`;
      },
    },
    {
      type: 'confirm',
      name: 'createTest',
      message: 'Create test file?',
      default: true,
    },
  ]);

  // Generate file names
  const className = answers.name
    .split('-')
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  
  const fileName = answers.name.replace(/-/g, '') + (answers.name.includes('-') ? '' : '');
  
  // Process cache paths
  const cachePaths = answers.cachePaths
    .split(',')
    .map((p: string) => {
      const trimmed = p.trim();
      if (trimmed.startsWith('~')) {
        return `paths.push(path.join(homeDir, '${trimmed.substring(2)}'));`;
      }
      return `paths.push('${trimmed}');`;
    })
    .join('\n    ');

  // Generate availability check
  const availabilityCheck = `await execAsync('${answers.command}');`;
  const fallbackCheck = `const cacheDir = path.join(homeDir, '.${answers.name.split('-')[0]}');\n      return existsSync(cacheDir);`;

  // Replace template variables
  const cleanerContent = CLEANER_TEMPLATE
    .replace(/{{ClassName}}/g, className)
    .replace(/{{name}}/g, answers.name)
    .replace(/{{type}}/g, answers.type)
    .replace(/{{description}}/g, answers.description)
    .replace(/{{cachePaths}}/g, cachePaths)
    .replace(/{{availabilityCheck}}/g, availabilityCheck)
    .replace(/{{fallbackCheck}}/g, fallbackCheck)
    .replace(/{{defaultCategoryName}}/g, `${className} Cache`)
    .replace(/{{fileName}}/g, fileName);

  const testContent = TEST_TEMPLATE
    .replace(/{{ClassName}}/g, className)
    .replace(/{{name}}/g, answers.name)
    .replace(/{{type}}/g, answers.type)
    .replace(/{{fileName}}/g, fileName);

  // Write files
  const cleanerPath = path.join(process.cwd(), 'src', 'cleaners', `${fileName}.ts`);
  const testPath = path.join(process.cwd(), 'src', '__tests__', 'cleaners', `${fileName}.test.ts`);

  // Check if files already exist
  if (fs.existsSync(cleanerPath)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `${cleanerPath} already exists. Overwrite?`,
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.yellow('Aborted'));
      return;
    }
  }

  // Write cleaner file
  fs.writeFileSync(cleanerPath, cleanerContent);
  console.log(chalk.green(`✅ Created cleaner: ${cleanerPath}`));

  // Write test file if requested
  if (answers.createTest) {
    const testDir = path.dirname(testPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(testPath, testContent);
    console.log(chalk.green(`✅ Created test: ${testPath}`));
  }

  // Instructions for next steps
  console.log(chalk.bold.yellow('\n📝 Next Steps:'));
  console.log(chalk.gray('1. Review and customize the generated cleaner'));
  console.log(chalk.gray(`2. Add the cleaner to src/cleaners/index.ts:`));
  console.log(chalk.cyan(`   import ${answers.name}Cleaner from './${fileName}';`));
  console.log(chalk.cyan(`   this.cleaners.set('${answers.name}', ${answers.name}Cleaner);`));
  console.log(chalk.gray('3. Update the config types if needed'));
  console.log(chalk.gray('4. Run tests: npm test'));
  console.log(chalk.gray('5. Test the cleaner: npm run dev -- clean --dry-run'));

  console.log(chalk.bold.green('\n✨ Done!'));
}

// Run the generator
main().catch((error) => {
  console.error(chalk.red('Error:'), error);
  process.exit(1);
});