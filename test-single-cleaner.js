#!/usr/bin/env node

const { spawn } = require('child_process');

const TIMEOUT = 15000; // 15 seconds

async function testSingleCleaner(cleanerName) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    console.log(`\n🧪 Testing: ${cleanerName}`);
    
    // Use sizes command to test cache detection speed for individual cleaner
    const child = spawn('npm', ['run', 'cli', '--', 'sizes'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { 
        ...process.env, 
        SQUEAKY_CLEAN_TEST_ONLY: cleanerName // We'll add this env var support
      }
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (killed) return;
      
      const duration = Date.now() - startTime;
      const status = code === 0 ? '✅' : '❌';
      console.log(`${status} ${cleanerName} - ${duration}ms - exit code: ${code}`);
      
      if (duration > 5000) {
        console.log(`   ⚠️  SLOW: ${(duration/1000).toFixed(1)}s`);
      }
      
      if (stderr && code !== 0) {
        console.log(`   Error: ${stderr.trim().split('\n')[0]}`);
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
      if (killed) return;
      
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
    const timeoutId = setTimeout(() => {
      if (!child.killed) {
        killed = true;
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
    }, TIMEOUT);

    child.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

async function main() {
  // Test the most likely suspects first
  const suspiciousCleaners = [
    'yarn',    // Recursive directory searching
    'npm',     // Directory tree walking
    'vscode',  // Multiple cache locations
    'pip',     // Python cache locations
    'pnpm',    // Package manager
    'bun',     // Package manager
    'jetbrains', // IDE with many cache locations
    'androidstudio', // IDE with large caches
    'xcode'    // Large IDE caches
  ];
  
  console.log('🔍 Testing individual cleaners to find the slow ones...\n');
  
  const results = [];
  
  for (const cleaner of suspiciousCleaners) {
    const result = await testSingleCleaner(cleaner);
    results.push(result);
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n📊 Results Summary:');
  console.log('────────────────────────────────────────────────────────────');
  
  const sortedResults = results.sort((a, b) => b.duration - a.duration);
  
  sortedResults.forEach(result => {
    const duration = `${(result.duration/1000).toFixed(1)}s`;
    const status = result.success ? '✅' : '❌';
    const warning = result.duration > 8000 ? ' ⚠️  SLOW' : '';
    const error = result.error ? ` (${result.error})` : '';
    
    console.log(`${status} ${duration.padStart(6)} - ${result.cleaner}${warning}${error}`);
  });
  
  const slowOnes = results.filter(r => r.duration > 8000);
  if (slowOnes.length > 0) {
    console.log(`\n⚠️  Slow cleaners (>8s): ${slowOnes.map(r => r.cleaner).join(', ')}`);
    console.log('These are likely causing the CLI hangs.');
  }
  
  const timeouts = results.filter(r => r.error === 'TIMEOUT');
  if (timeouts.length > 0) {
    console.log(`\n🚨 Timeout cleaners (>${TIMEOUT/1000}s): ${timeouts.map(r => r.cleaner).join(', ')}`);
    console.log('These definitely need performance fixes.');
  }
}

if (require.main === module) {
  main().catch(console.error);
}
