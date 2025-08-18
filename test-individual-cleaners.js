#!/usr/bin/env node

const { spawn } = require('child_process');

// List of all cleaners categorized by type
const cleanersByType = {
  'package-manager': ['npm', 'yarn', 'pnpm', 'bun', 'pip'],
  'ide': ['vscode', 'xcode', 'androidstudio', 'jetbrains'],
  'build-tool': ['webpack', 'vite', 'nx', 'turbo', 'flutter', 'gradle'],
  'browser': ['chrome', 'firefox'], 
  'system': ['docker']
};

async function testCleaner(cleanerName, timeout = 10000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    console.log(`\n🧪 Testing individual cleaner: ${cleanerName}`);
    
    const child = spawn('npm', ['run', 'cli', '--', 'clean', '--dry-run', '--types', 'package-manager', '--exclude', ...Object.values(cleanersByType).flat().filter(c => c !== cleanerName)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeout
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      const status = code === 0 ? '✅' : '❌';
      console.log(`${status} ${cleanerName} - ${duration}ms - exit code: ${code}`);
      
      if (duration > 5000) {
        console.log(`   ⚠️  SLOW: Cleaner took ${(duration/1000).toFixed(1)}s`);
      }
      
      if (code !== 0 && stderr) {
        console.log(`   Error: ${stderr.trim()}`);
      }

      resolve({
        cleaner: cleanerName,
        success: code === 0,
        duration,
        stdout,
        stderr
      });
    });

    child.on('error', (error) => {
      const duration = Date.now() - startTime;
      console.log(`❌ ${cleanerName} - ${duration}ms - error: ${error.message}`);
      resolve({
        cleaner: cleanerName,
        success: false,
        duration,
        error: error.message
      });
    });

    // Kill after timeout
    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
        const duration = Date.now() - startTime;
        console.log(`❌ ${cleanerName} - ${duration}ms - TIMEOUT`);
        resolve({
          cleaner: cleanerName,
          success: false,
          duration,
          error: 'TIMEOUT'
        });
      }
    }, timeout);
  });
}

async function testCategory(categoryName, cleaners, timeout = 15000) {
  console.log(`\n🔍 Testing ${categoryName} cleaners individually...`);
  const results = [];
  
  for (const cleaner of cleaners) {
    const result = await testCleaner(cleaner, timeout);
    results.push(result);
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}

async function main() {
  console.log('🔍 Testing individual cleaners to identify slow ones...\n');
  
  const allResults = [];
  
  // Test the problematic categories first
  const problematicCategories = ['package-manager', 'ide'];
  
  for (const category of problematicCategories) {
    const cleaners = cleanersByType[category];
    const results = await testCategory(category, cleaners);
    allResults.push(...results);
  }
  
  console.log('\n📊 Individual Cleaner Results:');
  console.log('────────────────────────────────────────────────────────────');
  
  const slowCleaners = [];
  const failedCleaners = [];
  const fastCleaners = [];
  
  allResults.forEach(result => {
    const duration = `${(result.duration/1000).toFixed(1)}s`;
    const status = result.success ? '✅' : '❌';
    
    if (result.duration > 8000) {
      slowCleaners.push(`${status} ${duration.padStart(6)} - ${result.cleaner} ⚠️  SLOW`);
    } else if (!result.success) {
      failedCleaners.push(`${status} ${duration.padStart(6)} - ${result.cleaner} (${result.error || 'failed'})`);
    } else {
      fastCleaners.push(`${status} ${duration.padStart(6)} - ${result.cleaner}`);
    }
  });
  
  // Print results grouped by performance
  [...slowCleaners, ...failedCleaners, ...fastCleaners].forEach(line => console.log(line));
  
  if (slowCleaners.length > 0) {
    console.log(`\n⚠️  Found ${slowCleaners.length} slow cleaner(s) - these are likely causing the hangs`);
    console.log('Slow cleaners:', slowCleaners.map(s => s.split(' - ')[1].replace(' ⚠️  SLOW', '')).join(', '));
  }
  
  if (failedCleaners.length > 0) {
    console.log(`\n❌ Found ${failedCleaners.length} failing cleaner(s)`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
