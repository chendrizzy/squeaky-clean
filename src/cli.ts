#!/usr/bin/env node

import { Command } from 'commander';
import { config } from './config';
import { printHeader, printError } from './utils/cli';

const program = new Command();

// Package info (this would normally be imported from package.json)
const packageInfo = {
  name: 'squeaky-clean',
  version: '0.1.0',
  description: '✨ Make your dev environment squeaky clean!',
};

program
  .name(packageInfo.name)
  .description(packageInfo.description)
  .version(packageInfo.version)
  .configureHelp({
    sortSubcommands: true,
  });

// Global options
program
  .option('-v, --verbose', 'enable verbose output')
  .option('--no-color', 'disable colored output')
  .option('-q, --quiet', 'suppress non-essential output')
  .option('--json', 'output results in JSON format')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    
    if (options.verbose) {
      config.set({ output: { ...config.get().output, verbose: true } });
    }
    
    if (options.noColor) {
      config.set({ output: { ...config.get().output, useColors: false } });
    }
    
    if (options.quiet) {
      config.set({ output: { ...config.get().output, quiet: true } });
    }
    
    if (options.json) {
      config.set({ output: { ...config.get().output, format: 'json' } });
    }
  });

// Clean command - main functionality
program
  .command('clean')
  .description('clean development caches')
  .option('-a, --all', 'clean all configured caches')
  .option('-t, --types <types>', 'comma-separated list of cache types (package-manager,build-tool,browser,ide,system)')
  .option('-e, --exclude <tools>', 'comma-separated list of tools to exclude')
  .option('-d, --dry-run', 'show what would be cleaned without actually cleaning')
  .option('-f, --force', 'skip confirmation prompts')
  .option('-s, --sizes', 'show cache sizes before cleaning')
  .action(async (options) => {
    try {
      printHeader('Cache Cleaning');
      
      // Import and run the clean command
      const { cleanCommand } = await import('./commands/clean');
      await cleanCommand(options);
    } catch (error) {
      printError(`Failed to clean caches: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// List command - show available caches
program
  .command('list')
  .alias('ls')
  .description('list available caches and their status')
  .option('-s, --sizes', 'include cache sizes (slower)')
  .option('-t, --type <type>', 'filter by cache type')
  .action(async (options) => {
    try {
      printHeader('Available Caches');
      
      const { listCommand } = await import('./commands/list');
      await listCommand(options);
    } catch (error) {
      printError(`Failed to list caches: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Sizes command - show cache sizes
program
  .command('sizes')
  .description('show cache sizes without clearing')
  .option('-t, --type <type>', 'filter by cache type')
  .option('--json', 'output as JSON')
  .action(async (options) => {
    try {
      printHeader('Cache Sizes');
      
      const { sizesCommand } = await import('./commands/sizes');
      await sizesCommand(options);
    } catch (error) {
      printError(`Failed to get cache sizes: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Config command - manage configuration
const configCmd = program
  .command('config')
  .description('manage configuration settings')
  .option('-l, --list', 'list current configuration')
  .option('-r, --reset', 'reset to default configuration')
  .option('-p, --path', 'show config file path')
  .option('-i, --interactive', 'interactive configuration wizard')
  .option('-g, --get <key>', 'get a specific configuration value')
  .option('-s, --set <key=value>', 'set a specific configuration value')
  .option('-e, --enable <tool>', 'enable a specific cache cleaner')
  .option('-d, --disable <tool>', 'disable a specific cache cleaner')
  .action(async (options) => {
    try {
      // No need to set default behavior here - let configCommand handle it
      
      const { configCommand } = await import('./commands/config');
      await configCommand(options);
    } catch (error) {
      printError(`Failed to manage config: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Config doctor subcommand - migrate legacy config
configCmd
  .command('doctor')
  .description('migrate legacy configuration to new format')
  .option('-i, --input <path>', 'input config path (default: ~/.squeaky-clean/config.json)')
  .option('-o, --output <path>', 'output path for migrated config (default: overwrites input)')
  .option('-d, --dry-run', 'show what would be migrated without writing')
  .option('-q, --quiet', 'minimal output')
  .action(async (options) => {
    try {
      printHeader('Configuration Migration');
      const { runConfigDoctor } = await import('./commands/configDoctor');
      await runConfigDoctor({
        input: options.input,
        output: options.output,
        dryRun: options.dryRun,
        quiet: options.quiet,
      });
    } catch (error) {
      printError(`Failed to migrate config: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Doctor command - diagnose issues and migrate config
program
  .command('doctor')
  .alias('dr')
  .description('diagnose potential issues and migrate legacy config')
  .option('--config', 'migrate legacy configuration to new format')
  .option('-i, --input <path>', 'input config path (default: ~/.squeaky-clean/config.json)')
  .option('-o, --output <path>', 'output path for migrated config (default: overwrites input)')
  .option('-d, --dry-run', 'show what would be migrated without writing')
  .option('-q, --quiet', 'minimal output')
  .action(async (options) => {
    try {
      if (options.config || options.input || options.output || options.dryRun) {
        // Config migration mode
        printHeader('Configuration Migration');
        const { runConfigDoctor } = await import('./commands/configDoctor');
        await runConfigDoctor({
          input: options.input,
          output: options.output,
          dryRun: options.dryRun,
          quiet: options.quiet,
        });
      } else {
        // System diagnosis mode
        printHeader('System Diagnosis');
        const { doctorCommand } = await import('./commands/doctor');
        await doctorCommand();
      }
    } catch (error) {
      printError(`Failed to run doctor: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Auto command - smart automatic clearing
program
  .command('auto')
  .description('automatically clear caches based on smart detection')
  .option('-s, --safe', 'only clear safe caches')
  .option('-a, --aggressive', 'include more cache types')
  .action(async (options) => {
    try {
      printHeader('Smart Cache Clearing');
      
      const { autoCommand } = await import('./commands/auto');
      await autoCommand(options);
    } catch (error) {
      printError(`Failed to auto-clear: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Interactive command - guided cache cleaning
program
  .command('interactive')
  .alias('i')
  .description('interactively select and clean caches with guided prompts')
  .option('-v, --verbose', 'enable verbose output')
  .action(async (options) => {
    try {
      const { interactiveCommand } = await import('./commands/interactive');
      await interactiveCommand.parseAsync(['node', 'squeaky', 'interactive', ...(options.verbose ? ['--verbose'] : [])]);
    } catch (error) {
      printError(`Failed to run interactive mode: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Help improvements
program.addHelpText('after', `
Examples:
  $ squeaky clean --all              # Clean all configured caches
  $ squeaky clean -t package-manager # Clean only package manager caches  
  $ squeaky clean --exclude chrome   # Clean all except Chrome cache
  $ squeaky list --sizes             # Show all caches with sizes
  $ squeaky config --interactive     # Configure cache preferences
  $ squeaky auto --safe              # Smart automatic cleaning (safe mode)
  $ squeaky-clean clean -a           # Using the full name

Cache Types:
  package-manager    npm, yarn, pnpm, bun caches
  build-tool         webpack, vite, nx, turbo, gradle, maven caches  
  browser            Chrome, Firefox development caches
  ide                VS Code, WebStorm, Xcode caches
  system             Docker images/containers, temp files, logs
  
Configuration:
  Config stored at: ~/.config/squeaky-clean/config.json
  Use 'squeaky config' to customize preferences

✨ Make your development environment squeaky clean! ✨
`);

// Error handling
program.configureOutput({
  writeErr: (str) => printError(str),
});

// Parse arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
