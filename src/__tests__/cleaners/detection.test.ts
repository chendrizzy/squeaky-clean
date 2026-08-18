import { beforeEach, describe, expect, it, vi } from "vitest";
import * as path from "path";
import npmCleaner from "../../cleaners/npm";
import yarnCleaner from "../../cleaners/yarn";
import pnpmCleaner from "../../cleaners/pnpm";
import bunCleaner from "../../cleaners/bun";
import cargoCleaner from "../../cleaners/cargo";
import mavenCleaner from "../../cleaners/maven";
import nugetCleaner from "../../cleaners/nuget";
import pipenvCleaner from "../../cleaners/pipenv";
import poetryCleaner from "../../cleaners/poetry";
import nodeGypCleaner from "../../cleaners/nodeGyp";
import { pathExists } from "../../utils/fs.js";
import { commandExists, anyCommandExists } from "../../utils/which";
import { cacheManager } from "../../utils/cache";

// Detection invariant: a cleaner is available when its tool is on PATH OR its
// cache directories exist on disk. Regression guard for the 2026-08-17 miss
// where node-gyp reported "Not detected" while 4GB sat in its devdir cache,
// so `auto --safe` skipped it.

// No process spawns: yarn/pnpm probe their CLI for cache locations, which must
// fail fast (as it does when the tool is uninstalled) and fall back to the
// default locations.
vi.mock("execa", () => ({
  default: vi.fn(() => Promise.reject(new Error("spawn ENOENT"))),
  __esModule: true,
}));

vi.mock("../../utils/which", () => ({
  commandExists: vi.fn(),
  anyCommandExists: vi.fn(),
}));

vi.mock("../../utils/fs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/fs.js")>();
  return {
    ...actual,
    pathExists: vi.fn(),
    getDirectorySize: vi.fn(async () => 0),
    getCachedDirectorySize: vi.fn(async () => 0),
    safeRmrf: vi.fn(async () => undefined),
  };
});

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: vi.fn(() => "/Users/test"),
    platform: vi.fn(() => "darwin"),
  };
});

const home = "/Users/test";

// node-gyp resolves its devdir from process.platform (not os.platform()),
// which cannot be mocked - mirror its branch so the test runs on both
// macOS and Linux CI.
const nodeGypDevdir =
  process.platform === "darwin"
    ? path.join(home, "Library", "Caches", "node-gyp")
    : path.join(
        process.env.XDG_CACHE_HOME || path.join(home, ".cache"),
        "node-gyp",
      );

interface Case {
  name: string;
  cleaner: { isAvailable(): Promise<boolean> };
  cacheDir: string;
}

const cases: Case[] = [
  { name: "npm", cleaner: npmCleaner, cacheDir: path.join(home, ".npm") },
  {
    name: "yarn",
    cleaner: yarnCleaner,
    cacheDir: path.join(home, ".yarn", "cache"),
  },
  {
    name: "pnpm",
    cleaner: pnpmCleaner,
    cacheDir: path.join(home, ".pnpm-store"),
  },
  {
    name: "bun",
    cleaner: bunCleaner,
    cacheDir: path.join(home, ".bun", "install", "cache"),
  },
  {
    name: "cargo",
    cleaner: cargoCleaner,
    cacheDir: path.join(home, ".cargo", "registry"),
  },
  {
    name: "maven",
    cleaner: mavenCleaner,
    cacheDir: path.join(home, ".m2", "repository"),
  },
  {
    name: "nuget",
    cleaner: nugetCleaner,
    cacheDir: path.join(home, ".nuget", "packages"),
  },
  {
    name: "pipenv",
    cleaner: pipenvCleaner,
    cacheDir: path.join(home, ".cache", "pipenv"),
  },
  {
    name: "poetry",
    cleaner: poetryCleaner,
    cacheDir: path.join(home, ".cache", "pypoetry"),
  },
  { name: "node-gyp", cleaner: nodeGypCleaner, cacheDir: nodeGypDevdir },
];

describe("cache-dir detection (tool-on-PATH OR cache-dir-exists)", () => {
  const existing = new Set<string>();

  beforeEach(() => {
    vi.clearAllMocks();
    existing.clear();
    cacheManager.clearAll();

    vi.mocked(commandExists).mockResolvedValue(false);
    vi.mocked(anyCommandExists).mockResolvedValue(false);
    vi.mocked(pathExists).mockImplementation(async (p: string) =>
      existing.has(p),
    );
  });

  for (const { name, cleaner, cacheDir } of cases) {
    it(`${name}: available when tool is off PATH but ${cacheDir} exists`, async () => {
      existing.add(cacheDir);
      await expect(cleaner.isAvailable()).resolves.toBe(true);
    });

    it(`${name}: unavailable when tool is off PATH and no cache dirs exist`, async () => {
      await expect(cleaner.isAvailable()).resolves.toBe(false);
    });
  }

  it("node-gyp: legacy ~/.node-gyp alone still detects", async () => {
    existing.add(path.join(home, ".node-gyp"));
    await expect(nodeGypCleaner.isAvailable()).resolves.toBe(true);
  });

  it("node-gyp: getCacheInfo reports isInstalled from cache-dir detection", async () => {
    existing.add(nodeGypDevdir);
    const info = await nodeGypCleaner.getCacheInfo();
    expect(info.isInstalled).toBe(true);
  });

  it("tool on PATH still detects with no cache dirs (spot check)", async () => {
    vi.mocked(commandExists).mockResolvedValue(true);
    vi.mocked(anyCommandExists).mockResolvedValue(true);
    await expect(cargoCleaner.isAvailable()).resolves.toBe(true);
    await expect(nugetCleaner.isAvailable()).resolves.toBe(true);
  });
});
