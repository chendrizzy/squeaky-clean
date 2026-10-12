import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stripVTControlCharacters } from "util";
import inquirer from "inquirer";
import { cacheManager } from "../../cleaners/index.js";
import { cleanerRegistry } from "../../cleaners/CleanerRegistry.js";
import { config } from "../../config/index.js";
import { interactiveCommand } from "../../commands/interactive.js";
import { interactiveEnhancedCommand } from "../../commands/interactiveEnhanced.js";

vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
  },
}));

// App thinning has its own command (`squeaky ub`): neither interactive picker
// may list universal-binary. Every cleaner here is a stub, so the real
// universal-binary cleaner is never reachable from this file.
const GB = 1024 ** 3;
const originalStdinIsTTY = process.stdin.isTTY;

function stubCleaner(name: string, type: string, size = 1024) {
  return {
    name,
    type,
    description: `${name} stub`,
    isAvailable: vi.fn().mockResolvedValue(true),
    getCacheInfo: vi.fn().mockResolvedValue({
      name,
      type,
      description: `${name} stub`,
      paths: [`/mock/${name}`],
      isInstalled: true,
      size,
      totalSize: size,
    }),
    getCacheCategories: vi.fn().mockResolvedValue([]),
    clear: vi.fn(),
  };
}

// picocolors colors on in CI regardless of config, so compare plain text
function getConsoleOutput(): string {
  return stripVTControlCharacters(
    vi
      .mocked(console.log)
      .mock.calls.map((call) => call.join(" "))
      .join("\n"),
  );
}

/** Every choice value offered by every prompt so far. */
function offeredValues(): unknown[] {
  return vi
    .mocked(inquirer.prompt)
    .mock.calls.flatMap(([questions]) =>
      (questions as any[]).flatMap((q) =>
        (q.choices ?? []).map((c: any) => c.value),
      ),
    );
}

let npm: ReturnType<typeof stubCleaner>;
let docker: ReturnType<typeof stubCleaner>;
let ub: ReturnType<typeof stubCleaner>;

beforeEach(() => {
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  config.set({ output: { useColors: false, emojis: "off" } as any });
  npm = stubCleaner("npm", "package-manager");
  docker = stubCleaner("docker", "system");
  ub = stubCleaner("universal-binary", "system", 5 * GB);
});

afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", {
    value: originalStdinIsTTY,
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe("interactive command", () => {
  beforeEach(() => {
    vi.spyOn(cacheManager, "getEnabledCleaners").mockReturnValue([
      npm,
      docker,
      ub,
    ] as any);
  });

  it("selecting the system type never pulls in universal-binary", async () => {
    const cleanAll = vi
      .spyOn(cacheManager, "cleanAllCaches")
      .mockResolvedValue([
        {
          name: "docker",
          success: true,
          sizeBefore: 1024,
          sizeAfter: 1024,
          clearedPaths: [],
        },
      ]);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ selectionMethod: "type" })
      .mockResolvedValueOnce({ types: ["system"] })
      .mockResolvedValueOnce({ action: "dry" })
      .mockResolvedValueOnce({ action: "cancel" });

    await interactiveCommand.parseAsync([], { from: "user" });

    expect(ub.getCacheInfo).not.toHaveBeenCalled();
    expect(cleanAll).toHaveBeenCalledWith({
      dryRun: true,
      include: ["docker"],
    });
    expect(getConsoleOutput()).not.toContain("universal-binary");
    expect(getConsoleOutput()).toContain("docker (1.0 KB would be freed)");
  });

  it("does not offer universal-binary for individual selection", async () => {
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ selectionMethod: "individual" })
      .mockResolvedValueOnce({ caches: ["npm"] })
      .mockResolvedValueOnce({ action: "cancel" });

    await interactiveCommand.parseAsync([], { from: "user" });

    expect(offeredValues()).toContain("npm");
    expect(offeredValues()).not.toContain("universal-binary");
  });

  it("reports held bytes apart from freed bytes", async () => {
    vi.spyOn(cacheManager, "cleanAllCaches").mockResolvedValue([
      {
        name: "npm",
        success: true,
        sizeBefore: 1024,
        sizeAfter: 0,
        clearedPaths: [],
      },
      {
        name: "held-stub",
        success: true,
        sizeBefore: 5 * GB,
        sizeAfter: 5 * GB,
        heldBytes: 2.5 * GB,
        clearedPaths: [],
      },
    ]);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ selectionMethod: "individual" })
      .mockResolvedValueOnce({ caches: ["npm"] })
      .mockResolvedValueOnce({ action: "clean" })
      .mockResolvedValueOnce({ cleanMore: false });

    await interactiveCommand.parseAsync([], { from: "user" });
    const output = getConsoleOutput();

    expect(output).toContain("1.0 KB was freed");
    expect(output).not.toContain("5.0 GB");
    expect(output).toMatch(/Held in backups: 2\.5 GB \(freed by the next/);
  });

  it("a dry run reports held bytes as would-be-held, never the backup size as freed", async () => {
    vi.spyOn(cacheManager, "cleanAllCaches").mockResolvedValue([
      {
        name: "held-stub",
        success: true,
        sizeBefore: 5 * GB,
        sizeAfter: 5 * GB,
        heldBytes: 2.5 * GB,
        clearedPaths: [],
      },
    ]);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ selectionMethod: "individual" })
      .mockResolvedValueOnce({ caches: ["npm"] })
      .mockResolvedValueOnce({ action: "dry" })
      .mockResolvedValueOnce({ action: "cancel" });

    await interactiveCommand.parseAsync([], { from: "user" });
    const output = getConsoleOutput();

    expect(output).not.toContain("5.0 GB");
    expect(output).toContain("No space was freed");
    expect(output).toMatch(/Would be held in backups: 2\.5 GB \(freed by/);
  });
});

describe("enhanced interactive command", () => {
  it("never lists or scans universal-binary", async () => {
    vi.spyOn(cleanerRegistry, "autoDetect").mockResolvedValue();
    vi.spyOn(cleanerRegistry, "getAvailableCleaners").mockResolvedValue([
      npm,
      ub,
    ] as any);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ configureProtected: false })
      .mockResolvedValueOnce({ selectionMethod: "cancel" });

    await interactiveEnhancedCommand.parseAsync(["--profile", "none"], {
      from: "user",
    });

    expect(npm.getCacheInfo).toHaveBeenCalled();
    expect(ub.getCacheInfo).not.toHaveBeenCalled();
    expect(getConsoleOutput()).toContain("npm");
    expect(getConsoleOutput()).not.toContain("universal-binary");
  });

  it("a preview reports what a dry run found, not before minus after", async () => {
    vi.spyOn(cleanerRegistry, "autoDetect").mockResolvedValue();
    vi.spyOn(cleanerRegistry, "getAvailableCleaners").mockResolvedValue([
      npm,
    ] as any);
    // a dry run leaves the cache in place, so after equals before
    npm.clear.mockResolvedValue({
      name: "npm",
      success: true,
      sizeBefore: 1024,
      sizeAfter: 1024,
      clearedPaths: [],
    });
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ configureProtected: false })
      .mockResolvedValueOnce({ selectionMethod: "all" })
      .mockResolvedValueOnce({ action: "dryrun" });

    await interactiveEnhancedCommand.parseAsync(["--profile", "none"], {
      from: "user",
    });

    expect(npm.clear).toHaveBeenCalledWith(
      true,
      undefined,
      expect.anything(),
      expect.anything(),
    );
    expect(getConsoleOutput()).toContain("Would save: 1.0 KB");
  });
});
