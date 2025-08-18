import chalk from 'chalk';
import { config } from '../config';

export const colors = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  muted: chalk.gray,
  bold: chalk.bold,
  dim: chalk.dim,
};

export function colorize(text: string, color: keyof typeof colors): string {
  return config.shouldUseColors() ? colors[color](text) : text;
}

export function formatSize(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
  
  return `${size} ${sizes[i]}`;
}

export function formatSizeWithColor(bytes: number): string {
  const formatted = formatSize(bytes);
  
  if (bytes === 0) {
    return colorize(formatted, 'muted');
  } else if (bytes < 1024 * 1024) { // < 1MB
    return colorize(formatted, 'success');
  } else if (bytes < 1024 * 1024 * 100) { // < 100MB
    return colorize(formatted, 'warning');
  } else {
    return colorize(formatted, 'error');
  }
}

export function printHeader(text: string): void {
  console.log();
  console.log(colorize(`🧼 ${text}`, 'bold'));
  console.log(colorize('─'.repeat(text.length + 3), 'dim'));
}

export function printSuccess(text: string): void {
  console.log(colorize('✅', 'success') + ' ' + text);
}

export function printError(text: string): void {
  console.log(colorize('❌', 'error') + ' ' + text);
}

export function printWarning(text: string): void {
  console.log(colorize('⚠️ ', 'warning') + text);
}

export function printInfo(text: string): void {
  console.log(colorize('ℹ️ ', 'info') + text);
}

export function printVerbose(text: string): void {
  if (config.isVerbose()) {
    console.log(colorize('  🔍 ' + text, 'dim'));
  }
}

export function printTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((header, i) => 
    Math.max(header.length, ...rows.map(row => row[i]?.length || 0))
  );
  
  // Header
  const headerRow = headers.map((header, i) => 
    colorize(header.padEnd(colWidths[i]), 'bold')
  ).join('  ');
  console.log(headerRow);
  
  // Separator
  const separator = colWidths.map(width => 
    colorize('─'.repeat(width), 'dim')
  ).join('  ');
  console.log(separator);
  
  // Rows
  rows.forEach(row => {
    const formattedRow = row.map((cell, i) => 
      cell.padEnd(colWidths[i])
    ).join('  ');
    console.log(formattedRow);
  });
}

export function createProgressMessage(current: number, total: number, item: string): string {
  const progress = `[${current}/${total}]`;
  const progressColored = colorize(progress, 'dim');
  const itemColored = colorize(item, 'primary');
  
  return `${progressColored} ${itemColored}`;
}

export const symbols = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  arrow: '→',
  bullet: '•',
  check: '✓',
  cross: '✗',
  hourglass: '⏳',
  rocket: '🚀',
  soap: '🧼',
  bubbles: '🫧',
  sparkles: '✨',
  gear: '⚙️',
  folder: '📁',
  file: '📄',
  trash: '🗑️',
} as const;

// Special message for completion
export function printCleanComplete(message: string): void {
  console.log(colorize(`✨ ${message} 🫧`, 'success'));
}
