import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { cacheManager } from '../cleaners';
import { formatSizeWithColor, printInfo, printError, printHeader } from '../utils/cli';
import { config } from '../config';
import { CacheType } from '../types';

interface InteractiveOptions {
  verbose?: boolean;
}

function getCacheEmoji(type: CacheType): string {
  switch (type) {
    case 'package-manager': return '📦';
    case 'build-tool': return '🔨';
    case 'browser': return '🌐';
    case 'ide': return '💻';
    case 'system': return '🖥️';
    default: return '📄';
  }
}

function getTypeEmoji(type: string): string {
  switch (type) {
    case 'package-manager': return '📦';
    case 'build-tool': return '🔨';
    case 'browser': return '🌐';
    case 'ide': return '💻';
    case 'system': return '🖥️';
    default: return '📄';
  }
}

export const interactiveCommand = new Command('interactive')
  .alias('i')
  .description('interactively select and clean caches with guided prompts')
  .option('-v, --verbose', 'enable verbose output')
  .action(async (options: InteractiveOptions) => {
    try {
      // Check if we're in a TTY environment
      if (!process.stdin.isTTY) {
        printError('Interactive mode requires a TTY environment.');
        console.log(chalk.yellow('💡 Tip: Use non-interactive commands instead:'));
        console.log(chalk.gray('   • squeaky clean --all    # Clean all caches'));
        console.log(chalk.gray('   • squeaky clean --dry-run # Preview what would be cleaned'));
        console.log(chalk.gray('   • squeaky list --sizes   # List caches with sizes'));
        return;
      }

      printHeader('Interactive Cache Cleaning');

      // Set verbose mode in config if requested
      if (options.verbose) {
        config.set({ output: { ...config.get().output, verbose: true } });
      }

      // Get all available cache info
      printInfo('🔍 Scanning for available caches...');
      const allCaches = await cacheManager.getAllCacheInfo();
      const availableCaches = allCaches.filter((cache: any) => cache.isInstalled && cache.size > 0);

      if (availableCaches.length === 0) {
        console.log(chalk.yellow('\n⚠️  No caches found with reclaimable space.'));
        console.log(chalk.gray('   This could mean:'));
        console.log(chalk.gray('   • Your caches are already clean'));
        console.log(chalk.gray('   • No supported development tools are installed'));
        console.log(chalk.gray('   • Cache directories are in non-standard locations'));
        return;
      }

      // Display summary
      console.log(chalk.bold('\n📋 Found caches:'));
      const totalSize = availableCaches.reduce((sum: number, cache: any) => sum + cache.size, 0);
      availableCaches.forEach((cache: any) => {
        const size = formatSizeWithColor(cache.size);
        const emoji = getCacheEmoji(cache.type);
        console.log(`   ${emoji} ${chalk.bold(cache.name)} - ${size} - ${chalk.gray(cache.description)}`);
      });

      console.log(chalk.bold(`\n💾 Total reclaimable space: ${chalk.green(formatSizeWithColor(totalSize))}\n`));

      // Selection method
      const { selectionMethod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectionMethod',
          message: 'How would you like to select caches to clean?',
          choices: [
            {
              name: `🧹 Clean all caches (save ${formatSizeWithColor(totalSize)})`,
              value: 'all',
            },
            {
              name: '🎯 Select individual caches',
              value: 'individual',
            },
            {
              name: '📂 Select by cache type',
              value: 'type',
            },
            {
              name: '❌ Exit without cleaning',
              value: 'exit',
            },
          ],
        },
      ]);

      if (selectionMethod === 'exit') {
        console.log(chalk.yellow('\n👋 Exiting without cleaning caches.'));
        return;
      }

      let selectedCaches: string[] = [];

      if (selectionMethod === 'all') {
        selectedCaches = availableCaches.map((cache: any) => cache.name);
      } else if (selectionMethod === 'individual') {
        const { caches } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'caches',
            message: 'Select caches to clean:',
            choices: availableCaches.map((cache: any) => ({
              name: `${getCacheEmoji(cache.type)} ${cache.name} (${formatSizeWithColor(cache.size)}) - ${cache.description}`,
              value: cache.name,
            })),
          },
        ]);
        selectedCaches = caches;
      } else if (selectionMethod === 'type') {
        const cacheTypes = [...new Set(availableCaches.map((cache: any) => cache.type))];
        const typeChoices = cacheTypes.map((type: string) => {
          const typeCaches = availableCaches.filter((cache: any) => cache.type === type);
          const typeSize = typeCaches.reduce((sum: number, cache: any) => sum + cache.size, 0);
          return {
            name: `${getTypeEmoji(type)} ${type} (${typeCaches.length} caches, ${formatSizeWithColor(typeSize)})`,
            value: type,
          };
        });

        const { types } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'types',
            message: 'Select cache types to clean:',
            choices: typeChoices,
          },
        ]);

        selectedCaches = availableCaches
          .filter((cache: any) => types.includes(cache.type))
          .map((cache: any) => cache.name);
      }

      if (selectedCaches.length === 0) {
        console.log(chalk.yellow('\n⚠️  No caches selected. Exiting.'));
        return;
      }

      // Show what will be cleaned
      const selectedSize = availableCaches
        .filter((cache: any) => selectedCaches.includes(cache.name))
        .reduce((sum: number, cache: any) => sum + cache.size, 0);

      console.log(chalk.bold('\n🎯 Selected for cleaning:'));
      console.log(chalk.gray(`   This will free up approximately ${formatSizeWithColor(selectedSize)}`));
      selectedCaches.forEach((name: string) => {
        const cache = availableCaches.find((c: any) => c.name === name);
        if (cache) {
          const emoji = getCacheEmoji(cache.type);
          console.log(`   ${emoji} ${name} - ${formatSizeWithColor(cache.size || 0)}`);
        }
      });

      // Confirmation
      const { confirmClean, dryRun } = await inquirer.prompt([
        {
          type: 'list',
          name: 'confirmClean',
          message: 'How would you like to proceed?',
          choices: [
            {
              name: '🔍 Dry run (preview what would be cleaned)',
              value: 'dry',
            },
            {
              name: '🧹 Clean selected caches now',
              value: 'clean',
            },
            {
              name: '❌ Cancel',
              value: 'cancel',
            },
          ],
        },
      ]).then((answers) => ({
        confirmClean: answers.confirmClean,
        dryRun: answers.confirmClean === 'dry',
      }));

      if (confirmClean === 'cancel') {
        console.log(chalk.yellow('\n👋 Operation cancelled.'));
        return;
      }

      const isDryRun = dryRun || confirmClean === 'dry';

      // Execute cleaning
      console.log(chalk.bold(`\n${isDryRun ? '🔍 DRY RUN: ' : '🧹 '}Cleaning selected caches...\n`));

      // Convert selectedCaches to exclude list (all caches except selected ones)
      const allCleaners = await cacheManager.getAllCacheInfo();
      const excludeCaches = allCleaners
        .filter((cache: any) => !selectedCaches.includes(cache.name))
        .map((cache: any) => cache.name);

      const results = await cacheManager.cleanAllCaches({
        dryRun: isDryRun,
        exclude: excludeCaches,
      });

      // Display results
      let totalFreed = 0;
      results.forEach((result: any) => {
        const name = result.name;
        if (!selectedCaches.includes(name)) return;

        const emoji = result.success ? '✅' : '❌';
        const freed = result.sizeBefore - result.sizeAfter;
        totalFreed += freed;

        if (result.success) {
          const freedStr = freed > 0 ? ` (${formatSizeWithColor(freed)} ${isDryRun ? 'would be ' : ''}freed)` : '';
          console.log(`${emoji} ${name}${freedStr}`);

          if (options.verbose && result.clearedPaths && result.clearedPaths.length > 0) {
            result.clearedPaths.forEach((path: string) => {
              console.log(chalk.gray(`     → ${path}`));
            });
          }
        } else {
          console.log(`${emoji} ${name}: ${chalk.red(result.error || 'Unknown error')}`);
        }
      });

      // Summary
      console.log();
      if (totalFreed > 0) {
        console.log(`   ${chalk.green(formatSizeWithColor(totalFreed))} ${isDryRun ? 'would be' : 'was'} freed\n`);
      } else {
        console.log(chalk.yellow('   No space was freed\n'));
      }

      if (isDryRun) {
        const { proceedWithClean } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceedWithClean',
            message: 'Would you like to proceed with the actual cleaning?',
            default: false,
          },
        ]);

        if (proceedWithClean) {
          console.log(chalk.bold('\n🧹 Proceeding with actual cleaning...\n'));
          const realResults = await cacheManager.cleanAllCaches({
            dryRun: false,
            exclude: excludeCaches,
          });

          let realFreed = 0;
          realResults.forEach((result: any) => {
            const name = result.name;
            if (selectedCaches.includes(name) && result.success) {
              realFreed += result.sizeBefore - result.sizeAfter;
            }
          });

          console.log(chalk.green(`✨ Real cleaning complete! Freed ${formatSizeWithColor(realFreed)}\n`));
        }
      }

      console.log(chalk.bold('🎉 Interactive cleaning session complete!'));
    } catch (error) {
      printError(`Interactive command failed: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  });
