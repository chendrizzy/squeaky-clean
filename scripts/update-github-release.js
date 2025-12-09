#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const version = pkg.version;
const tag = `v${version}`;
const notesFile = path.join(
  os.tmpdir(),
  `squeaky-clean-release-${version}-${Date.now()}.md`,
);

function run(cmd, options = {}) {
  execSync(cmd, {
    stdio: "inherit",
    cwd: root,
    ...options,
  });
}

function commandExists() {
  try {
    execSync("gh --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function buildReleaseNotes() {
  let commits = "";
  try {
    const prevTag = execSync("git describe --tags --abbrev=0 HEAD^", {
      cwd: root,
      encoding: "utf-8",
    })
      .trim();

    commits = execSync(`git log ${prevTag}..HEAD --pretty=format:"- %s"`, {
      cwd: root,
      encoding: "utf-8",
    }).trim();
  } catch {
    commits = execSync("git log HEAD --pretty=format:\"- %s\" -n 20", {
      cwd: root,
      encoding: "utf-8",
    }).trim();
  }

  if (!commits) {
    commits = "- Minor maintenance and documentation improvements";
  }

  return [
    "## What's Changed",
    "",
    commits,
    "",
    "## Install",
    `\`npm install -g ${pkg.name}\``,
  ].join("\n");
}

async function main() {
  if (!commandExists()) {
    console.error(
      "❌ GitHub CLI (gh) is required to update GitHub releases. Install it from https://cli.github.com/",
    );
    process.exit(1);
  }

  // Check for authentication - either env var or gh CLI auth
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    try {
      execSync("gh auth status", { stdio: "ignore" });
    } catch {
      console.error(
        "❌ GitHub authentication required. Either set GH_TOKEN/GITHUB_TOKEN or run 'gh auth login'.",
      );
      process.exit(1);
    }
  }

  fs.writeFileSync(notesFile, buildReleaseNotes());

  console.log(`ℹ️  Preparing GitHub release ${tag}`);

  let releaseExists = false;
  try {
    execSync(`gh release view ${tag}`, { cwd: root, stdio: "ignore" });
    releaseExists = true;
  } catch {
    releaseExists = false;
  }

  if (releaseExists) {
    run(`gh release edit ${tag} --title "Release ${tag}" --notes-file "${notesFile}"`);
  } else {
    run(`gh release create ${tag} --title "Release ${tag}" --notes-file "${notesFile}"`);
  }

  const assets = [];
  const tarball = path.join(root, `${pkg.name}-${pkg.version}.tgz`);
  if (fs.existsSync(tarball)) {
    assets.push(tarball);
  }

  if (fs.existsSync(path.join(root, "README.md"))) {
    assets.push(path.join(root, "README.md"));
  }

  if (fs.existsSync(path.join(root, "LICENSE"))) {
    assets.push(path.join(root, "LICENSE"));
  }

  if (fs.existsSync(path.join(root, "dist"))) {
    const distFiles = fs
      .readdirSync(path.join(root, "dist"))
      .filter((file) => file.endsWith(".js"));

    distFiles.forEach((file) => {
      assets.push(path.join(root, "dist", file));
    });
  }

  if (assets.length > 0) {
    run(`gh release upload "${tag}" ${assets.map((asset) => `"${asset}"`).join(" ")} --clobber`);
  }

  fs.unlinkSync(notesFile);

  if (fs.existsSync(tarball)) {
    fs.unlinkSync(tarball);
  }

  console.log(`✅ GitHub release ${tag} updated`);
}

main().catch((error) => {
  console.error(`❌ Failed to update GitHub release: ${error.message}`);
  process.exit(1);
});
