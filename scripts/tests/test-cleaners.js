#!/usr/bin/env node

// Quick diagnostic script to test individual cleaners and identify slow ones
const { spawn } = require('child_process');

const commands = [
  'list',
  'sizes', 
  'clean --dry-run',
  'clean --dry-run --types package-manager',
  'clean --dry-run --types build-tool',
  'clean --dry-run --types ide',
  'clean --dry-run --types system'
];

async function testCommand(cmd) {
  return new Promise((resolve) => {
    console.log(`\n🧪 Testing: squeaky ${cmd}`);
    const start = Date.now();
    
    const child = spawn('squeaky', cmd.split(' '), {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000 // 30 second timeout
    });
    
    let output = '';
    let error = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    child.on('close', (code) => {
      const duration = Date.now() - start;
      const status = code === 0 ? '✅' : '❌';
      
      console.log(`${status} squeaky ${cmd} - ${duration}ms - exit code: ${code}`);
      
      if (code !== 0) {
        console.log(`   Error: ${error.substring(0, 100)}...`);
      }
      
      if (duration > 10000) {
        console.log(`   ⚠️  SLOW: Command took ${(duration/1000).toFixed(1)}s`);
      }
      
      resolve({ cmd, code, duration, output: output.length, error: error.length });
    });
    
    child.on('error', (err) => {
      const duration = Date.now() - start;
      console.log(`❌ squeaky ${cmd} - ${duration}ms - error: ${err.message}`);
      resolve({ cmd, code: -1, duration, output: 0, error: err.message.length });
    });
  });
}

async function runDiagnostics() {
  console.log('🔍 Running squeaky-clean diagnostics...\n');
  
  const results = [];
  
  for (const cmd of commands) {
    const result = await testCommand(cmd);
    results.push(result);
    
    // Wait a bit between commands to avoid overwhelming the system
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n📊 Summary:');
  console.log('─'.repeat(60));
  
  results.sort((a, b) => b.duration - a.duration);
  
  for (const result of results) {
    const status = result.code === 0 ? '✅' : '❌';
    const duration = `${(result.duration/1000).toFixed(1)}s`.padStart(6);
    const warning = result.duration > 10000 ? ' ⚠️  SLOW' : '';
    
    console.log(`${status} ${duration} - squeaky ${result.cmd}${warning}`);
  }
  
  const slowCommands = results.filter(r => r.duration > 10000);
  if (slowCommands.length > 0) {
    console.log(`\n⚠️  Found ${slowCommands.length} slow command(s) - these might be causing hangs`);
  }
  
  const failedCommands = results.filter(r => r.code !== 0);
  if (failedCommands.length > 0) {
    console.log(`\n❌ Found ${failedCommands.length} failing command(s)`);
  }
}

runDiagnostics().catch(console.error);
