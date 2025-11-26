# GitHub Action Technical Specification

## Overview
Official GitHub Action for squeaky-clean to optimize CI/CD build caches and artifacts.

## Action Configuration

### action.yml
```yaml
name: 'Squeaky Clean Cache Manager'
description: 'Optimize CI/CD caches, reduce build times, and manage artifacts efficiently'
author: 'squeaky-clean'
branding:
  icon: 'trash-2'
  color: 'blue'

inputs:
  # Core Options
  tools:
    description: 'Comma-separated list of tools to clean (e.g., npm,docker,gradle)'
    required: false
    default: 'auto'

  mode:
    description: 'Cleaning mode: auto, aggressive, safe, custom'
    required: false
    default: 'auto'

  # Timing Options
  when:
    description: 'When to clean: pre-build, post-build, both, on-failure'
    required: false
    default: 'pre-build'

  # Cache Control
  max-cache-size:
    description: 'Maximum cache size before cleaning (e.g., 5GB, 500MB)'
    required: false
    default: '5GB'

  cache-retention:
    description: 'Keep caches newer than (e.g., 7d, 24h, 1w)'
    required: false
    default: '7d'

  # Reporting
  report:
    description: 'Generate cache report: none, summary, detailed'
    required: false
    default: 'summary'

  comment-pr:
    description: 'Comment on PR with cache savings'
    required: false
    default: 'true'

  # Advanced
  config-file:
    description: 'Path to squeaky-clean config file'
    required: false
    default: ''

  fail-on-error:
    description: 'Fail the workflow if cleaning fails'
    required: false
    default: 'false'

outputs:
  space-saved:
    description: 'Total space saved in bytes'
  space-saved-formatted:
    description: 'Human-readable space saved (e.g., 2.3 GB)'
  cache-report:
    description: 'JSON report of cache analysis'
  time-saved:
    description: 'Estimated build time saved in seconds'

runs:
  using: 'node20'
  main: 'dist/index.js'
  post: 'dist/cleanup.js'
```

### Core Implementation

#### src/index.ts (Main Entry)
```typescript
import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import { analyzeCache, cleanCache, generateReport } from './cache-manager';

async function run(): Promise<void> {
  try {
    // Get inputs
    const tools = core.getInput('tools').split(',').map(t => t.trim());
    const mode = core.getInput('mode');
    const when = core.getInput('when');
    const maxCacheSize = parseSize(core.getInput('max-cache-size'));
    const retention = parseDuration(core.getInput('cache-retention'));

    // Pre-build cleaning
    if (when === 'pre-build' || when === 'both') {
      core.startGroup('🧹 Pre-build Cache Cleaning');

      // Analyze current cache state
      const analysis = await analyzeCache({
        tools,
        githubContext: github.context
      });

      core.info(`📊 Current cache size: ${formatBytes(analysis.totalSize)}`);
      core.info(`📁 Cache directories: ${analysis.directories.length}`);

      // Determine if cleaning needed
      if (shouldClean(analysis, maxCacheSize)) {
        const result = await cleanCache({
          tools,
          mode,
          retention,
          githubContext: github.context
        });

        // Set outputs
        core.setOutput('space-saved', result.spaceSaved);
        core.setOutput('space-saved-formatted', formatBytes(result.spaceSaved));
        core.setOutput('time-saved', estimateTimeSaved(result.spaceSaved));

        core.info(`✅ Freed ${formatBytes(result.spaceSaved)}`);
        core.info(`⏱️ Estimated time saved: ${result.timeSaved}s`);
      } else {
        core.info('✨ Cache within limits, no cleaning needed');
      }

      core.endGroup();
    }

    // Generate report if requested
    if (core.getInput('report') !== 'none') {
      await generateAndPostReport();
    }

  } catch (error) {
    if (core.getInput('fail-on-error') === 'true') {
      core.setFailed(error.message);
    } else {
      core.warning(`Cache cleaning failed: ${error.message}`);
    }
  }
}

async function generateAndPostReport(): Promise<void> {
  const report = await generateReport();

  // Save as artifact
  const artifactClient = artifact.create();
  await artifactClient.uploadArtifact(
    'cache-report',
    ['cache-report.json', 'cache-report.html'],
    process.cwd()
  );

  // Comment on PR if enabled
  if (core.getInput('comment-pr') === 'true' && github.context.eventName === 'pull_request') {
    await commentOnPR(report);
  }

  // Set output
  core.setOutput('cache-report', JSON.stringify(report));
}
```

#### src/cache-manager.ts
```typescript
export interface CacheAnalysis {
  totalSize: number;
  directories: CacheDirectory[];
  recommendations: string[];
  inefficiencies: CacheInefficiency[];
}

export interface CacheDirectory {
  path: string;
  size: number;
  tool: string;
  lastModified: Date;
  priority: 'critical' | 'important' | 'normal' | 'low';
}

export async function analyzeCache(options: AnalyzeOptions): Promise<CacheAnalysis> {
  const directories: CacheDirectory[] = [];

  // GitHub Actions specific caches
  const actionsCaches = [
    { path: '~/.npm', tool: 'npm' },
    { path: '~/.cache/yarn', tool: 'yarn' },
    { path: '~/.gradle', tool: 'gradle' },
    { path: '~/Library/Caches/go-build', tool: 'go' },
    { path: '/var/lib/docker', tool: 'docker' }
  ];

  // Runner tool cache
  const runnerCache = process.env.RUNNER_TOOL_CACHE;
  if (runnerCache) {
    directories.push({
      path: runnerCache,
      tool: 'runner',
      size: await getDirectorySize(runnerCache),
      lastModified: await getLastModified(runnerCache),
      priority: 'important'
    });
  }

  // Detect inefficiencies
  const inefficiencies = detectInefficiencies(directories);

  return {
    totalSize: directories.reduce((sum, d) => sum + d.size, 0),
    directories,
    recommendations: generateRecommendations(directories, inefficiencies),
    inefficiencies
  };
}

function detectInefficiencies(dirs: CacheDirectory[]): CacheInefficiency[] {
  const inefficiencies: CacheInefficiency[] = [];

  // Duplicate dependencies
  const npmDirs = dirs.filter(d => d.tool === 'npm');
  if (npmDirs.length > 1) {
    inefficiencies.push({
      type: 'duplicate_caches',
      severity: 'medium',
      description: 'Multiple npm cache directories detected',
      solution: 'Consolidate to single cache location'
    });
  }

  // Oversized caches
  dirs.forEach(dir => {
    if (dir.size > 1024 * 1024 * 1024 * 5) { // 5GB
      inefficiencies.push({
        type: 'oversized_cache',
        severity: 'high',
        description: `${dir.tool} cache exceeds 5GB`,
        solution: `Consider cleaning ${dir.tool} cache more frequently`
      });
    }
  });

  // Stale caches
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  dirs.forEach(dir => {
    if (dir.lastModified < thirtyDaysAgo) {
      inefficiencies.push({
        type: 'stale_cache',
        severity: 'low',
        description: `${dir.tool} cache not updated in 30+ days`,
        solution: 'Consider removing unused cache'
      });
    }
  });

  return inefficiencies;
}
```

### GitHub Actions Workflows

#### Example: Basic Usage
```yaml
name: Build with Cache Management

on:
  push:
    branches: [ main ]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      # Clean caches before build
      - name: Optimize Caches
        uses: squeaky-clean/action@v1
        with:
          tools: npm,docker
          mode: auto
          max-cache-size: 2GB

      # Your build steps
      - run: npm ci
      - run: npm run build
      - run: npm test
```

#### Example: Matrix Build Optimization
```yaml
name: Matrix Build

on: [push]

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [18, 20]

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node }}

      - name: Smart Cache Management
        uses: squeaky-clean/action@v1
        with:
          tools: auto
          mode: ${{ matrix.os == 'windows-latest' && 'safe' || 'auto' }}
          report: detailed
          comment-pr: true

      - run: npm ci
      - run: npm test
```

#### Example: Docker Build Optimization
```yaml
name: Docker Build

on: [push]

jobs:
  docker:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Pre-build Docker Cleanup
        uses: squeaky-clean/action@v1
        with:
          tools: docker
          mode: aggressive
          when: pre-build

      - name: Build Docker Image
        run: |
          docker build -t myapp:${{ github.sha }} .
          docker push myapp:${{ github.sha }}

      - name: Post-build Cleanup
        uses: squeaky-clean/action@v1
        with:
          tools: docker
          mode: aggressive
          when: post-build
```

### PR Comment Feature

```typescript
async function commentOnPR(report: CacheReport): Promise<void> {
  const octokit = github.getOctokit(core.getInput('github-token'));
  const context = github.context;

  const comment = generatePRComment(report);

  // Find existing comment
  const { data: comments } = await octokit.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number
  });

  const botComment = comments.find(c =>
    c.user?.type === 'Bot' &&
    c.body?.includes('<!-- squeaky-clean-report -->')
  );

  if (botComment) {
    // Update existing comment
    await octokit.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: botComment.id,
      body: comment
    });
  } else {
    // Create new comment
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      body: comment
    });
  }
}

function generatePRComment(report: CacheReport): string {
  return `<!-- squeaky-clean-report -->
## 🧹 Cache Optimization Report

### 📊 Summary
- **Space Saved**: ${report.spaceSavedFormatted}
- **Time Saved**: ~${report.timeSaved} seconds
- **Caches Cleaned**: ${report.toolsCleaned.join(', ')}

### 📈 Before & After
| Tool | Before | After | Saved |
|------|--------|-------|-------|
${report.tools.map(t => `| ${t.name} | ${t.before} | ${t.after} | ${t.saved} |`).join('\n')}

### 💡 Recommendations
${report.recommendations.map(r => `- ${r}`).join('\n')}

### 🔍 Details
<details>
<summary>View detailed cache analysis</summary>

\`\`\`json
${JSON.stringify(report.analysis, null, 2)}
\`\`\`

</details>

---
*Automated by [squeaky-clean](https://github.com/squeaky-clean/squeaky-clean)*
`;
}
```

### Marketplace Listing

#### README.md (for GitHub Marketplace)
```markdown
# Squeaky Clean GitHub Action

Optimize your CI/CD pipeline by intelligently managing build caches and artifacts.

## Features

✨ **Smart Detection** - Automatically detects npm, yarn, pnpm, Docker, Gradle, and more
📊 **Cache Analytics** - Detailed reports on cache usage and inefficiencies
⚡ **Build Acceleration** - Reduce build times by up to 50%
💰 **Cost Savings** - Lower CI/CD costs by optimizing cache storage
🔒 **Safe Cleaning** - Never removes active or critical caches

## Quick Start

```yaml
- uses: squeaky-clean/action@v1
  with:
    tools: auto
    mode: auto
```

## Advanced Configuration

```yaml
- uses: squeaky-clean/action@v1
  with:
    tools: npm,docker,gradle
    mode: aggressive
    max-cache-size: 2GB
    retention: 7d
    report: detailed
    comment-pr: true
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `tools` | Tools to clean | `auto` |
| `mode` | Cleaning mode | `auto` |
| `when` | When to clean | `pre-build` |
| `max-cache-size` | Maximum cache size | `5GB` |
| `retention` | Cache retention period | `7d` |
| `report` | Report type | `summary` |
| `comment-pr` | Comment on PR | `true` |

## Outputs

| Output | Description |
|--------|-------------|
| `space-saved` | Bytes saved |
| `space-saved-formatted` | Human-readable space |
| `cache-report` | JSON report |
| `time-saved` | Estimated time saved |

## Examples

See [examples](./examples) directory for more use cases.

## License

MIT
```

### Testing Strategy

```typescript
// __tests__/action.test.ts
describe('GitHub Action', () => {
  it('should detect GitHub Actions environment', () => {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.RUNNER_TOOL_CACHE = '/opt/hostedtoolcache';

    const isGitHubActions = detectEnvironment();
    expect(isGitHubActions).toBe(true);
  });

  it('should parse size inputs correctly', () => {
    expect(parseSize('5GB')).toBe(5 * 1024 * 1024 * 1024);
    expect(parseSize('500MB')).toBe(500 * 1024 * 1024);
    expect(parseSize('2.5GB')).toBe(2.5 * 1024 * 1024 * 1024);
  });

  it('should generate correct PR comment', () => {
    const report = {
      spaceSaved: 2147483648,
      spaceSavedFormatted: '2.0 GB',
      toolsCleaned: ['npm', 'docker']
    };

    const comment = generatePRComment(report);
    expect(comment).toContain('2.0 GB');
    expect(comment).toContain('npm, docker');
  });
});
```

## Publishing Strategy

### Phase 1: Beta Testing (Week 1)
1. Publish to test organization
2. Test on 5 different workflows
3. Gather feedback

### Phase 2: Public Beta (Week 2)
1. Publish as v0.1.0-beta
2. Announce on Twitter/Reddit
3. Iterate based on feedback

### Phase 3: Official Launch (Week 3)
1. Publish v1.0.0
2. Submit to GitHub Marketplace
3. Write blog post
4. Create demo video

### Phase 4: Enterprise Features (Week 4)
1. Add advanced reporting
2. Add cost analysis
3. Add custom policies
4. Launch enterprise tier