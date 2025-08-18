#!/usr/bin/env node

/**
 * Script to update version number across all files
 * Usage: node scripts/update-version.js [version]
 * If no version is provided, it will read from package.json
 */

const fs = require('fs');
const path = require('path');

// Get version from command line or package.json
let version = process.argv[2];
if (!version) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  version = packageJson.version;
  console.log(`Using version from package.json: ${version}`);
} else {
  // Remove 'v' prefix if present
  version = version.replace(/^v/, '');
  console.log(`Updating to version: ${version}`);
}

// Files to update
const filesToUpdate = [
  {
    path: path.join(__dirname, '../package.json'),
    update: (content) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + '\n';
    }
  },
  {
    path: path.join(__dirname, '../src/cli.ts'),
    update: (content) => {
      return content.replace(
        /version: '[^']*'/,
        `version: '${version}'`
      );
    }
  }
];

// Update each file
let updatedFiles = 0;
for (const file of filesToUpdate) {
  try {
    if (!fs.existsSync(file.path)) {
      console.warn(`⚠️  File not found: ${file.path}`);
      continue;
    }
    
    const content = fs.readFileSync(file.path, 'utf8');
    const updated = file.update(content);
    
    if (content !== updated) {
      fs.writeFileSync(file.path, updated);
      console.log(`✅ Updated ${path.basename(file.path)}`);
      updatedFiles++;
    } else {
      console.log(`⏭️  No changes needed in ${path.basename(file.path)}`);
    }
  } catch (error) {
    console.error(`❌ Error updating ${file.path}:`, error.message);
  }
}

console.log(`\n📦 Version update complete! Updated ${updatedFiles} file(s) to v${version}`);

// If running in CI, output the version for GitHub Actions
if (process.env.CI) {
  console.log(`::set-output name=version::${version}`);
}