#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const packagePath = path.join(__dirname, "..", "package.json");

try {
  const raw = fs.readFileSync(packagePath, "utf-8");
  const pkg = JSON.parse(raw);
  const dependencyName = pkg.name;

  if (pkg.dependencies?.[dependencyName]) {
    delete pkg.dependencies[dependencyName];
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(
      `✅ Removed self-dependency '${dependencyName}' from package.json`,
    );
  } else {
    console.log(`ℹ️  No self-dependency '${dependencyName}' found`);
  }
} catch (error) {
  console.error(`❌ Failed to update package.json: ${error.message}`);
  process.exit(1);
}
