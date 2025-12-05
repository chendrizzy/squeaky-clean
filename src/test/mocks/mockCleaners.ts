/**
 * Mock cleaners for fast unit testing
 * These avoid real filesystem operations for 10x faster tests
 */
import type { CleanerModule, CacheInfo, ClearResult, CacheCategory } from "../../types/index.js";

// Mock cache info that would be returned by real cleaners
export const mockCacheInfo: Record<string, CacheInfo> = {
  npm: {
    name: "npm",
    type: "package-manager",
    description: "NPM package manager cache",
    paths: ["~/.npm", "~/.npm/_cacache"],
    size: 1024 * 1024 * 500, // 500MB
    isInstalled: true,
  },
  yarn: {
    name: "yarn",
    type: "package-manager",
    description: "Yarn package manager cache",
    paths: ["~/.yarn/cache"],
    size: 1024 * 1024 * 200, // 200MB
    isInstalled: true,
  },
  docker: {
    name: "docker",
    type: "system",
    description: "Docker images and containers",
    paths: ["/var/lib/docker"],
    size: 1024 * 1024 * 1024 * 2, // 2GB
    isInstalled: true,
  },
  webpack: {
    name: "webpack",
    type: "build-tool",
    description: "Webpack build cache",
    paths: ["node_modules/.cache/webpack"],
    size: 1024 * 1024 * 100, // 100MB
    isInstalled: true,
  },
  vscode: {
    name: "vscode",
    type: "ide",
    description: "VS Code cache and extensions",
    paths: ["~/.vscode/extensions"],
    size: 1024 * 1024 * 300, // 300MB
    isInstalled: true,
  },
  chrome: {
    name: "chrome",
    type: "browser",
    description: "Chrome browser cache",
    paths: ["~/Library/Caches/Google/Chrome"],
    size: 1024 * 1024 * 800, // 800MB
    isInstalled: true,
  },
  pip: {
    name: "pip",
    type: "package-manager",
    description: "Python pip cache",
    paths: ["~/.cache/pip"],
    size: 1024 * 1024 * 150, // 150MB
    isInstalled: false, // Simulate not installed
  },
};

// Mock clear results
export const mockClearResults: Record<string, ClearResult> = {
  npm: { name: "npm", success: true, clearedSize: 1024 * 1024 * 500 },
  yarn: { name: "yarn", success: true, clearedSize: 1024 * 1024 * 200 },
  docker: { name: "docker", success: true, clearedSize: 1024 * 1024 * 1024 * 2 },
  webpack: { name: "webpack", success: true, clearedSize: 1024 * 1024 * 100 },
  vscode: { name: "vscode", success: true, clearedSize: 1024 * 1024 * 300 },
  chrome: { name: "chrome", success: true, clearedSize: 1024 * 1024 * 800 },
  pip: { name: "pip", success: false, error: "pip not installed" },
};

/**
 * Creates a mock cleaner module for testing
 */
export function createMockCleaner(name: string, info: CacheInfo): CleanerModule {
  return {
    name,
    type: info.type,
    description: info.description,
    isAvailable: async () => info.isInstalled,
    getCacheInfo: async () => info,
    getCacheCategories: async (): Promise<CacheCategory[]> => [
      {
        id: `${name}-main`,
        name: `${name} main cache`,
        description: `Main cache for ${name}`,
        size: info.size || 0,
        paths: info.paths,
        priority: "normal",
        useCase: "development",
      },
    ],
    clear: async (dryRun?: boolean) => mockClearResults[name] || { name, success: true },
    clearByCategory: async (categoryIds: string[], dryRun?: boolean) =>
      mockClearResults[name] || { name, success: true },
  };
}

/**
 * Creates an array of mock cleaners for testing
 */
export function createMockCleaners(): CleanerModule[] {
  return Object.entries(mockCacheInfo).map(([name, info]) => createMockCleaner(name, info));
}

/**
 * Check if we should run full (slow) integration tests
 * Set FULL_INTEGRATION_TESTS=true to run real filesystem tests
 */
export function shouldRunFullTests(): boolean {
  return process.env.FULL_INTEGRATION_TESTS === "true";
}

/**
 * Pre-computed summary for mock tests (avoids recalculation)
 */
export const mockSummary = {
  totalSize: Object.values(mockCacheInfo).reduce((sum, info) => sum + (info.size || 0), 0),
  totalCleaners: Object.keys(mockCacheInfo).length,
  installedCleaners: Object.values(mockCacheInfo).filter(info => info.isInstalled).length,
  enabledCleaners: Object.keys(mockCacheInfo).length,
  sizesByType: {
    "package-manager": mockCacheInfo.npm.size! + mockCacheInfo.yarn.size! + mockCacheInfo.pip.size!,
    "build-tool": mockCacheInfo.webpack.size!,
    "browser": mockCacheInfo.chrome.size!,
    "ide": mockCacheInfo.vscode.size!,
    "system": mockCacheInfo.docker.size!,
    "other": 0,
  },
};

/**
 * MockCacheManager that uses mock cleaners instead of real filesystem operations
 * Tests run ~100x faster with this instead of the real CacheManager
 */
export class MockCacheManager {
  private cleaners: Map<string, CleanerModule>;

  constructor() {
    this.cleaners = new Map();
    const mockCleanerList = createMockCleaners();
    mockCleanerList.forEach(cleaner => {
      this.cleaners.set(cleaner.name, cleaner);
    });
  }

  getAllCleaners(): CleanerModule[] {
    return Array.from(this.cleaners.values());
  }

  getCleanersByType(type: string): CleanerModule[] {
    return this.getAllCleaners().filter(cleaner => cleaner.type === type);
  }

  getEnabledCleaners(): CleanerModule[] {
    return this.getAllCleaners();
  }

  getCleaner(name: string): CleanerModule | undefined {
    return this.cleaners.get(name);
  }

  async getAllCacheInfo(): Promise<CacheInfo[]> {
    return Object.values(mockCacheInfo);
  }

  async cleanAllCaches(options: {
    dryRun?: boolean;
    types?: string[];
    exclude?: string[];
    include?: string[];
  } = {}): Promise<ClearResult[]> {
    let cleaners = this.getEnabledCleaners();

    if (options.types?.length) {
      cleaners = cleaners.filter(c => options.types!.includes(c.type));
    }
    if (options.include?.length) {
      cleaners = cleaners.filter(c => options.include!.includes(c.name));
    }
    if (options.exclude?.length) {
      cleaners = cleaners.filter(c => !options.exclude!.includes(c.name));
    }

    return cleaners.map(cleaner =>
      mockClearResults[cleaner.name] || { name: cleaner.name, success: true }
    );
  }

  async getCacheSizesByType(): Promise<Record<string, number>> {
    return mockSummary.sizesByType;
  }

  async getSummary(): Promise<{
    totalSize: number;
    totalCleaners: number;
    installedCleaners: number;
    enabledCleaners: number;
    sizesByType: Record<string, number>;
  }> {
    return mockSummary;
  }
}
