import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import inquirer from "inquirer";
import { cacheManager } from "../../cleaners/index.js";
import { config } from "../../config/index.js";

vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
  },
}));

// The real selection rule runs over the mocked enabled list, so these tests
// see exactly what `clean` would select without any real cleaner.
vi.mock("../../cleaners/index.js", async (importOriginal) => {
  const { CacheManager } =
    await importOriginal<typeof import("../../cleaners/index.js")>();
  return {
    cacheManager: {
      cleanAllCaches: vi.fn(),
      getAllCacheInfo: vi.fn(),
      getEnabledCleaners: vi.fn(),
      selectCleaners: CacheManager.prototype.selectCleaners,
    },
    cleaners: [],
    CacheManager: vi.fn(),
  };
});

const originalStdinIsTTY = process.stdin.isTTY;
const originalStdoutIsTTY = process.stdout.isTTY;

function setTerminalInteractivity(isInteractive: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value: isInteractive,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: isInteractive,
    configurable: true,
  });
}

function getConsoleOutput(): string {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => call.join(" "))
    .join("\n");
}

describe("clean command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTerminalInteractivity(false);

    config.set({
      safety: {
        requireConfirmation: false,
        dryRunDefault: false,
        backupBeforeClearing: false,
        excludeSystemCritical: true,
      },
      output: {
        verbose: false,
        showSizes: true,
        useColors: false,
        emojis: "off",
      },
    });

    vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([
      {
        name: "npm",
        success: true,
        sizeBefore: 1024,
        sizeAfter: 0,
        clearedPaths: ["/mock/.npm"],
      },
    ]);
    vi.mocked(cacheManager.getAllCacheInfo).mockResolvedValue([
      {
        name: "npm",
        type: "package-manager",
        description: "NPM cache",
        paths: ["/mock/.npm"],
        isInstalled: true,
        size: 1024,
      },
    ]);
    vi.mocked(inquirer.prompt).mockResolvedValue({ confirmed: true });
    vi.mocked(cacheManager.getEnabledCleaners).mockReturnValue([]);
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("passes dry-run through only when --dry-run is requested", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    await cleanCommand({
      include: "npm,yarn" as any,
      exclude: ["brew"] as any,
      types: "package-manager,build-tool" as any,
      subCaches: "xcode:DerivedData,npm:logs" as any,
      dryRun: true,
    });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(cacheManager.cleanAllCaches).toHaveBeenCalledTimes(1);

    const callOptions = vi.mocked(cacheManager.cleanAllCaches).mock.calls[0][0];
    expect(callOptions).toMatchObject({
      dryRun: true,
      include: ["npm", "yarn"],
      exclude: ["brew"],
      types: ["package-manager", "build-tool"],
      showProgress: false,
    });
    expect([...callOptions.subCachesToClear!.entries()]).toEqual([
      ["xcode", ["DerivedData"]],
      ["npm", ["logs"]],
    ]);
  });

  it("prints freed bytes grouped by physical volume", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([
      {
        name: "cargo",
        success: true,
        sizeBefore: 2048,
        sizeAfter: 0,
        clearedPaths: ["/mock/.cargo/registry"],
        volumeBreakdown: { "/Volumes/BOLT": 1536, "/": 512 },
      },
    ]);

    await cleanCommand({ dryRun: true });
    const output = getConsoleOutput();

    expect(output).toContain("By volume:");
    expect(output).toContain("/Volumes/BOLT");
    expect(output).toContain("/ (internal)");
  });

  it("does not convert forced clean runs into dry-runs", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    config.set({
      safety: {
        requireConfirmation: true,
        dryRunDefault: false,
        backupBeforeClearing: false,
        excludeSystemCritical: true,
      },
    });

    await cleanCommand({ include: "npm" as any, force: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(cacheManager.cleanAllCaches).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        include: ["npm"],
      }),
    );
  });

  it("prompts in interactive terminals and cleans when confirmed", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    setTerminalInteractivity(true);
    config.set({
      safety: {
        requireConfirmation: true,
        dryRunDefault: false,
        backupBeforeClearing: false,
        excludeSystemCritical: true,
      },
    });
    vi.mocked(inquirer.prompt).mockResolvedValue({ confirmed: true });

    await cleanCommand({ include: "npm" as any });

    expect(inquirer.prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "confirm",
        name: "confirmed",
        default: false,
      }),
    ]);
    expect(cacheManager.cleanAllCaches).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        include: ["npm"],
        showProgress: true,
      }),
    );
  });

  it("does not clean when the interactive confirmation is declined", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    setTerminalInteractivity(true);
    config.set({
      safety: {
        requireConfirmation: true,
        dryRunDefault: false,
        backupBeforeClearing: false,
        excludeSystemCritical: true,
      },
    });
    vi.mocked(inquirer.prompt).mockResolvedValue({ confirmed: false });

    await cleanCommand({ include: "npm" as any });

    expect(inquirer.prompt).toHaveBeenCalledTimes(1);
    expect(cacheManager.cleanAllCaches).not.toHaveBeenCalled();
    expect(getConsoleOutput()).toContain(
      "Operation cancelled. No caches were cleaned.",
    );
  });

  it("does not hang or clean when confirmation is required in a non-interactive terminal", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    config.set({
      safety: {
        requireConfirmation: true,
        dryRunDefault: false,
        backupBeforeClearing: false,
        excludeSystemCritical: true,
      },
    });

    await cleanCommand({ include: "npm" as any });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(cacheManager.cleanAllCaches).not.toHaveBeenCalled();
    expect(getConsoleOutput()).toContain(
      "Confirmation is required, but this terminal cannot prompt.",
    );
  });

  it("runs size scanning only for non-dry-run clean executions", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    await cleanCommand({ include: "npm" as any, force: true, sizes: true });

    expect(cacheManager.getAllCacheInfo).toHaveBeenCalledWith({
      showProgress: true,
      cleaners: [],
    });

    vi.clearAllMocks();
    vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([
      {
        name: "npm",
        success: true,
        sizeBefore: 1024,
        sizeAfter: 1024,
        clearedPaths: ["/mock/.npm"],
      },
    ]);

    await cleanCommand({
      include: "npm" as any,
      dryRun: true,
      sizes: true,
    });

    expect(cacheManager.getAllCacheInfo).not.toHaveBeenCalled();
    expect(cacheManager.cleanAllCaches).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("skips manual-tier categories in non-TTY force runs and lists them", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    const manualCategory = {
      id: "fakeapp:manual-cache",
      name: "Manual Cache",
      description: "should require manual user confirmation before cleaning",
      paths: ["/home/testuser/Library/Caches/fakeapp"],
      size: 2048,
      priority: "normal" as const,
      safety: "manual" as const,
      useCase: "development" as const,
    };
    const fakeCleaner = {
      name: "fakeapp",
      type: "system",
      description: "fake cleaner exposing a manual-tier category",
      isAvailable: vi.fn().mockResolvedValue(true),
      getCacheInfo: vi.fn(),
      getCacheCategories: vi.fn().mockResolvedValue([manualCategory]),
      clear: vi.fn(),
      clearByCategory: vi.fn(),
    };
    vi.mocked(cacheManager.getEnabledCleaners).mockReturnValue([
      fakeCleaner as any,
    ]);

    // Non-TTY (set in beforeEach) + --force: manual categories can neither be
    // prompted for nor auto-confirmed, so they must be skipped with a notice.
    await cleanCommand({ include: "fakeapp" as any, force: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(cacheManager.cleanAllCaches).toHaveBeenCalledTimes(1);

    // allowManualIds stays empty: force never grants manual consent.
    const callOptions = vi.mocked(cacheManager.cleanAllCaches).mock.calls[0][0];
    expect(callOptions.criteria?.allowManualIds).toEqual([]);

    const output = getConsoleOutput();
    expect(output).toContain("Skipped (requires manual confirmation):");
    expect(output).toContain("Manual Cache [fakeapp:manual-cache]");
    expect(output).toContain("--allow-manual");
  });

  it("formats clean result logs without extra spaces", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    await cleanCommand({ include: "npm" as any, force: true });

    const output = getConsoleOutput();
    expect(output).toContain("npm: 1.0 KB freed");
    expect(output).not.toMatch(/KB\s{2,}freed/);
  });

  // ---- universal-binary: opt-in selection and honest reporting ----
  // Every cleaner here is a stub; the real universal-binary cleaner is never
  // reachable from this file.
  const GB = 1024 ** 3;
  const HINT = /App thinning \(universal-binary\) is not part of clean/;

  function stubCleaner(name: string, type: string) {
    return {
      name,
      type,
      description: `${name} stub`,
      isAvailable: vi.fn().mockResolvedValue(true),
      getCacheInfo: vi.fn(),
      getCacheCategories: vi.fn().mockResolvedValue([]),
      clear: vi.fn(),
      clearByCategory: vi.fn(),
    };
  }

  // A dry run's view of a universal-binary result: originals summed in
  // sizeBefore (the backup size), nothing removed, savings deferred.
  const ubResult = {
    name: "universal-binary",
    success: true,
    sizeBefore: 5 * GB,
    sizeAfter: 5 * GB,
    heldBytes: 2.5 * GB,
    clearedPaths: ["/mock/Apps/Big.app"],
  };
  const npmResult = {
    name: "npm",
    success: true,
    sizeBefore: 1024,
    sizeAfter: 0,
    clearedPaths: ["/mock/.npm"],
    volumeBreakdown: { "/": 1024 },
  };

  function countMatches(output: string, pattern: RegExp): number {
    return output.split("\n").filter((line) => pattern.test(line)).length;
  }

  it("--all never inspects universal-binary and prints the opt-in hint once", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");
    const npm = stubCleaner("npm", "package-manager");
    const ub = stubCleaner("universal-binary", "system");
    vi.mocked(cacheManager.getEnabledCleaners).mockReturnValue([
      npm,
      ub,
    ] as any);

    await cleanCommand({ all: true, dryRun: true } as any);

    // the consent pre-inspection ran over the selection, which has no UB
    expect(npm.getCacheCategories).toHaveBeenCalled();
    expect(ub.getCacheCategories).not.toHaveBeenCalled();
    expect(ub.clear).not.toHaveBeenCalled();
    // the hint is printed from the selection alone, with no availability check
    expect(ub.isAvailable).not.toHaveBeenCalled();
    expect(countMatches(getConsoleOutput(), HINT)).toBe(1);
    expect(getConsoleOutput()).toContain("squeaky ub");
  });

  it("--include universal-binary opts in and drops the hint", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");
    const ub = stubCleaner("universal-binary", "system");
    vi.mocked(cacheManager.getEnabledCleaners).mockReturnValue([ub] as any);

    await cleanCommand({ include: "universal-binary", dryRun: true } as any);

    expect(ub.getCacheCategories).toHaveBeenCalled();
    expect(getConsoleOutput()).not.toMatch(HINT);
  });

  it("never prints the hint under --json", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");
    vi.mocked(cacheManager.getEnabledCleaners).mockReturnValue([
      stubCleaner("universal-binary", "system"),
    ] as any);
    vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([]);
    vi.spyOn(config, "getOutputFormat").mockReturnValue("json");

    await cleanCommand({ dryRun: true });

    expect(getConsoleOutput()).not.toMatch(HINT);
  });

  it("--sizes scans only the selected cleaners", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");
    const npm = stubCleaner("npm", "package-manager");
    const ub = stubCleaner("universal-binary", "system");
    vi.mocked(cacheManager.getEnabledCleaners).mockReturnValue([
      npm,
      ub,
    ] as any);

    await cleanCommand({ all: true, force: true, sizes: true } as any);

    expect(cacheManager.getAllCacheInfo).toHaveBeenCalledWith({
      showProgress: true,
      cleaners: [npm],
    });
  });

  it("dry run: a held universal-binary row is not 'would be freed' and stays out of the totals", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");
    vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([
      npmResult,
      ubResult,
    ]);

    await cleanCommand({
      include: "npm,universal-binary",
      dryRun: true,
    } as any);
    const output = getConsoleOutput();
    const ubLines = output
      .split("\n")
      .filter((line) => line.startsWith("universal-binary:"));

    expect(ubLines).toHaveLength(1);
    expect(ubLines[0]).toContain("2.5 GB estimated savings");
    expect(ubLines[0]).toContain("squeaky ub prune");
    expect(ubLines[0]).not.toMatch(/freed\b(?! by)/);
    expect(output).not.toContain("universal-binary: No cache data found");
    expect(output).toContain("Total potential space freed: 1.0 KB");
    expect(output).not.toContain("5.0 GB");
    expect(countMatches(output, /^Would be held in backups: 2\.5 GB \(/)).toBe(
      1,
    );
    expect(output).toMatch(/By volume:\n {3}\/ \(internal\): 1\.0 KB/);
  });

  it("real run: says the savings are held in backups, total excludes them", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");
    vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([
      npmResult,
      ubResult,
    ]);

    await cleanCommand({ include: "npm,universal-binary", force: true } as any);
    const output = getConsoleOutput();

    expect(output).toMatch(
      /^universal-binary: 2\.5 GB held in backups \(freed by the next squeaky run/m,
    );
    expect(output).toContain("Total space freed: 1.0 KB");
    expect(countMatches(output, /^Held in backups: 2\.5 GB \(/)).toBe(1);
  });

  it("prints the held line even when nothing else was freed", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");
    vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([ubResult]);

    await cleanCommand({ include: "universal-binary", force: true } as any);
    const output = getConsoleOutput();

    expect(output).not.toContain("Total space freed");
    expect(output).not.toContain("By volume:");
    expect(output).toMatch(/^Held in backups: 2\.5 GB \(/m);
  });

  it.each([true, false])(
    "dryRun=%s: a universal-binary run that skipped every app shows why, not 'No cache data found'",
    async (dryRun) => {
      const { cleanCommand } = await import("../../commands/clean.js");
      vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([
        {
          name: "universal-binary",
          success: true,
          sizeBefore: 0,
          sizeAfter: 0,
          heldBytes: 0,
          clearedPaths: [],
          error:
            "B\u001bg: skipped:low-space (the volume of /mock needs 1.0 GB + 2.0 GB reserve, 1.7 GB free); `squeaky ub prune` frees held backups",
        },
      ]);

      await cleanCommand({
        include: "universal-binary",
        dryRun,
        force: true,
      } as any);
      const output = getConsoleOutput();

      expect(output).toMatch(
        /^universal-binary: B\\x1bg: skipped:low-space \(the volume of \/mock needs .*`squeaky ub prune` frees held backups$/m,
      );
      expect(output).not.toContain("No cache data found");
    },
  );

  it.each([true, false])(
    "--json (dryRun=%s): freed and totalFreed exclude held bytes, carried as heldBytes/totalHeld",
    async (dryRun) => {
      const { cleanCommand } = await import("../../commands/clean.js");
      vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([
        npmResult,
        ubResult,
      ]);
      vi.spyOn(config, "getOutputFormat").mockReturnValue("json");

      await cleanCommand({
        include: "npm,universal-binary",
        dryRun,
        force: true,
      } as any);
      const payload = JSON.parse(getConsoleOutput());

      expect(payload.dryRun).toBe(dryRun);
      expect(payload.totalFreed).toBe(1024);
      expect(payload.totalHeld).toBe(2.5 * GB);
      expect(payload.volumes).toEqual({ "/": 1024 });
      const ub = payload.results.find(
        (r: any) => r.name === "universal-binary",
      );
      expect(ub).toMatchObject({ freed: 0, heldBytes: 2.5 * GB });
      const npm = payload.results.find((r: any) => r.name === "npm");
      expect(npm).toMatchObject({ freed: 1024, heldBytes: 0 });
    },
  );
});
