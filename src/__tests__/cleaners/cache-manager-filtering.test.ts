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

// App thinning rewrites installed apps: `clean` runs it only when --include
// names it. Stubs stand in for every cleaner, so nothing here can reach the
// real universal-binary cleaner.
describe("CacheManager.selectCleaners (universal-binary is opt-in)", () => {
  function managerWith(...cleaners: CleanerModule[]): CacheManager {
    const manager = new CacheManager();
    (manager as any).cleaners = new Map(cleaners.map((c) => [c.name, c]));
    return manager;
  }
  const names = (cleaners: CleanerModule[]) => cleaners.map((c) => c.name);

  let npm: CleanerModule;
  let docker: CleanerModule;
  let ub: CleanerModule;
  let manager: CacheManager;

  beforeEach(() => {
    config.set({
      tools: { npm: true, docker: true, "universal-binary": true } as any,
    });
    npm = createMockCleaner("npm", "package-manager");
    docker = createMockCleaner("docker", "system");
    ub = createMockCleaner("universal-binary", "system");
    manager = managerWith(npm, docker, ub);
  });

  it("drops universal-binary from a plain (--all) selection and says so", () => {
    const { cleaners, optInSkipped } = manager.selectCleaners();
    expect(names(cleaners)).toEqual(["npm", "docker"]);
    expect(optInSkipped).toBe(true);
  });

  it("does not opt in through --types system (docker is system too)", () => {
    const { cleaners, optInSkipped } = manager.selectCleaners({
      types: ["system"],
    });
    expect(names(cleaners)).toEqual(["docker"]);
    expect(optInSkipped).toBe(true);
  });

  it("keeps universal-binary when --include names it", () => {
    const { cleaners, optInSkipped } = manager.selectCleaners({
      include: ["universal-binary"],
    });
    expect(names(cleaners)).toEqual(["universal-binary"]);
    expect(optInSkipped).toBe(false);
  });

  it("lets --include win over --exclude for universal-binary, as for any tool", () => {
    const { cleaners } = manager.selectCleaners({
      include: ["universal-binary", "npm"],
      exclude: ["universal-binary"],
    });
    expect(names(cleaners)).toEqual(["npm", "universal-binary"]);
  });

  it("stays quiet when the user excluded it or included other tools", () => {
    expect(
      manager.selectCleaners({ exclude: ["universal-binary"] }),
    ).toMatchObject({ optInSkipped: false });
    const included = manager.selectCleaners({ include: ["npm"] });
    expect(names(included.cleaners)).toEqual(["npm"]);
    expect(included.optInSkipped).toBe(false);
  });

  it("stays quiet when universal-binary is disabled in config", () => {
    config.set({ tools: { "universal-binary": false } as any });
    const { cleaners, optInSkipped } = manager.selectCleaners();
    expect(names(cleaners)).toEqual(["npm", "docker"]);
    expect(optInSkipped).toBe(false);
  });

  it("cleanAllCaches never scans or clears universal-binary unless included", async () => {
    const results = await manager.cleanAllCaches({
      dryRun: true,
      showProgress: false,
    });
    expect(results.map((r) => r.name)).toEqual(["npm", "docker"]);
    expect(ub.getCacheInfo).not.toHaveBeenCalled();
    expect(ub.clear).not.toHaveBeenCalled();

    await manager.cleanAllCaches({
      dryRun: true,
      include: ["universal-binary"],
      showProgress: false,
    });
    expect(ub.clear).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ub.clear).mock.calls[0][0]).toBe(true);
  });
});
