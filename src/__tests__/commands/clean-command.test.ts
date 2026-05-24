import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import inquirer from "inquirer";
import { cacheManager } from "../../cleaners/index.js";
import { config } from "../../config/index.js";

vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
  },
}));

vi.mock("../../cleaners/index.js", () => ({
  cacheManager: {
    cleanAllCaches: vi.fn(),
    getAllCacheInfo: vi.fn(),
  },
  cleaners: [],
  CacheManager: vi.fn(),
}));

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

  it("formats clean result logs without extra spaces", async () => {
    const { cleanCommand } = await import("../../commands/clean.js");

    await cleanCommand({ include: "npm" as any, force: true });

    const output = getConsoleOutput();
    expect(output).toContain("npm: 1.0 KB freed");
    expect(output).not.toMatch(/KB\s{2,}freed/);
  });
});
