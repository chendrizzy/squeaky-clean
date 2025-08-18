import { cacheManager } from '../cleaners';
import { printHeader, printSuccess, printInfo } from '../utils/cli';
import chalk from 'chalk';

export async function listCommand(options?: any): Promise<void> {
  printHeader('Available Cache Cleaners');
  
  let allCleaners = cacheManager.getAllCleaners();
  
  // Filter by type if specified
  if (options?.type) {
    allCleaners = allCleaners.filter(c => c.type === options.type);
  }
  
  // Group cleaners by type
  const cleanersByType = {
    'package-manager': allCleaners.filter(c => c.type === 'package-manager'),
    'build-tool': allCleaners.filter(c => c.type === 'build-tool'),
    'ide': allCleaners.filter(c => c.type === 'ide'),
    'system': allCleaners.filter(c => c.type === 'system'),
  };
  
  // Check availability for each cleaner
  console.log(chalk.cyan('\nDetecting installed tools...\n'));
  
  for (const [type, cleaners] of Object.entries(cleanersByType)) {
    if (cleaners.length === 0) continue;
    
    const typeLabels = {
      'package-manager': '📦 Package Managers',
      'build-tool': '🔧 Build Tools', 
      'ide': '💻 Development Environments',
      'system': '⚙️  System Tools',
    };
    
    console.log(chalk.bold(typeLabels[type as keyof typeof typeLabels]));
    
    for (const cleaner of cleaners) {
      const isAvailable = await cleaner.isAvailable();
      const status = isAvailable ? chalk.green('✅ Available') : chalk.gray('⚪ Not detected');
      console.log(`  ${status} ${chalk.bold(cleaner.name)} - ${cleaner.description}`);
    }
    
    console.log(); // Add spacing between sections
  }
  
  printInfo(`Total cleaners: ${allCleaners.length}`);
  printSuccess('Use \`squeaky-clean clean --dry-run\` to see what would be cleaned');
}
