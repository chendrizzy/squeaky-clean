import { describe, it, expect, vi, beforeEach } from "vitest";
import { CacheManager } from "../../cleaners/index.js";
import { config } from "../../config/index.js";
import type {
  CacheInfo,
  CacheType,
  CleanerModule,
  ClearResult,
} from "../../types/index.js";

function createMockCleaner(name: string, type: CacheType): CleanerModule {
  const cacheInfo: CacheInfo = {
    name,
    type,
    description: `${name} cache`,
    paths: [`/mock/${name}`],
    isInstalled: true,
    size: 1024,
  };

  return {
    name,
    type,
    description: `${name} cache`,
    isAvailable: vi.fn(async () => true),
    getCacheInfo: vi.fn(async () => cacheInfo),
    clear: vi.fn(async (dryRun?: boolean): Promise<ClearResult> => {
      return {
        name,
        success: true,
        sizeBefore: 1024,
        sizeAfter: dryRun ? 1024 : 0,
        clearedPaths: [`/mock/${name}`],
      };
    }),
  };
}

describe("CacheManager cleaner filtering", () => {
  beforeEach(() => {
    config.set({
      tools: {
        npm: true,
        yarn: true,
        pnpm: true,
        bun: true,
        pip: true,
        cargo: true,
        poetry: true,
        pipenv: true,
        cocoapods: true,
        swiftpm: true,
        nuget: true,
        brew: true,
        nix: true,
        webpack: true,
        vite: true,
        nx: true,
        turbo: true,
        flutter: true,
        "node-gyp": true,
        "go-build": true,
        maven: true,
        playwright: true,
        chrome: false,
        firefox: false,
        vscode: true,
        xcode: true,
        androidstudio: true,
        jetbrains: false,
        windsurf: true,
        cursor: true,
        zed: true,
        docker: false,
        gradle: true,
        "universal-binary": false,
      },
    });
  });

  it("applies type filters before scanning and lets include override exclude", async () => {
    const manager = new CacheManager();
    const npmCleaner = createMockCleaner("npm", "package-manager");
    const yarnCleaner = createMockCleaner("yarn", "package-manager");
    const webpackCleaner = createMockCleaner("webpack", "build-tool");

    (manager as any).cleaners = new Map<string, CleanerModule>([
      ["npm", npmCleaner],
      ["yarn", yarnCleaner],
      ["webpack", webpackCleaner],
    ]);

    const results = await manager.cleanAllCaches({
      dryRun: true,
      types: ["package-manager"],
      include: ["npm", "yarn"],
      exclude: ["yarn"],
      showProgress: false,
    });

    expect(results.map((result) => result.name)).toEqual(["npm", "yarn"]);
    expect(npmCleaner.getCacheInfo).toHaveBeenCalledTimes(1);
    expect(npmCleaner.clear).toHaveBeenCalledTimes(1);
    expect(yarnCleaner.getCacheInfo).toHaveBeenCalledTimes(1);
    expect(yarnCleaner.clear).toHaveBeenCalledTimes(1);
    expect(webpackCleaner.getCacheInfo).not.toHaveBeenCalled();
    expect(webpackCleaner.clear).not.toHaveBeenCalled();
  });

  it("applies exclude before scanning when include is not provided", async () => {
    const manager = new CacheManager();
    const npmCleaner = createMockCleaner("npm", "package-manager");
    const yarnCleaner = createMockCleaner("yarn", "package-manager");
    const webpackCleaner = createMockCleaner("webpack", "build-tool");

    (manager as any).cleaners = new Map<string, CleanerModule>([
      ["npm", npmCleaner],
      ["yarn", yarnCleaner],
      ["webpack", webpackCleaner],
    ]);

    const results = await manager.cleanAllCaches({
      dryRun: true,
      types: ["package-manager"],
      exclude: ["yarn"],
      showProgress: false,
    });

    expect(results.map((result) => result.name)).toEqual(["npm"]);
    expect(npmCleaner.getCacheInfo).toHaveBeenCalledTimes(1);
    expect(npmCleaner.clear).toHaveBeenCalledTimes(1);
    expect(yarnCleaner.getCacheInfo).not.toHaveBeenCalled();
    expect(yarnCleaner.clear).not.toHaveBeenCalled();
    expect(webpackCleaner.getCacheInfo).not.toHaveBeenCalled();
    expect(webpackCleaner.clear).not.toHaveBeenCalled();
  });
});
