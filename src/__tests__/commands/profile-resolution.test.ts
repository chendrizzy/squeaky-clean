import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cacheManager } from "../../cleaners/index.js";
import { config } from "../../config/index.js";
import {
  CLEANING_PROFILES,
  DEFAULT_PROFILE,
  SAFETY_TIER_ORDER,
} from "../../safety/index.js";
import {
  resolveSafetyTiers,
  parseAgeToDays,
  parseSizeToMB,
  cleanCommand,
} from "../../commands/clean.js";

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

function fakeConfig(activeProfile?: string): { get: () => any } {
  return { get: () => ({ activeProfile }) };
}

describe("resolveSafetyTiers precedence", () => {
  it("--safety beats --profile", () => {
    const result = resolveSafetyTiers(
      { safety: "safe,caution", profile: "aggressive" },
      fakeConfig("conservative"),
    );

    expect(result).toEqual({
      ok: true,
      tiers: ["safe", "caution"],
      source: "safety-flag",
    });
  });

  it("--profile beats config activeProfile", () => {
    const result = resolveSafetyTiers(
      { profile: "conservative" },
      fakeConfig("aggressive"),
    );

    expect(result).toEqual({
      ok: true,
      tiers: CLEANING_PROFILES.conservative.tiers,
      source: "profile-flag",
      profile: "conservative",
    });
  });

  it("config activeProfile beats default", () => {
    const result = resolveSafetyTiers({}, fakeConfig("aggressive"));

    expect(result).toEqual({
      ok: true,
      tiers: CLEANING_PROFILES.aggressive.tiers,
      source: "config",
      profile: "aggressive",
    });
  });

  it("falls back to the default profile when nothing is set", () => {
    const result = resolveSafetyTiers({}, fakeConfig(undefined));

    expect(result).toEqual({
      ok: true,
      tiers: CLEANING_PROFILES[DEFAULT_PROFILE].tiers,
      source: "default",
      profile: DEFAULT_PROFILE,
    });
  });

  it("ignores a config activeProfile that is not a cleaning profile", () => {
    const result = resolveSafetyTiers({}, fakeConfig("my-custom-thing"));

    expect(result).toMatchObject({
      ok: true,
      source: "default",
      profile: DEFAULT_PROFILE,
    });
  });

  it("returns an error listing valid tiers for an invalid --safety", () => {
    const result = resolveSafetyTiers({ safety: "bogus" }, fakeConfig());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const tier of SAFETY_TIER_ORDER) {
        expect(result.error).toContain(tier);
      }
    }
  });

  it("returns an error listing valid profiles for an invalid --profile", () => {
    const result = resolveSafetyTiers({ profile: "yolo" }, fakeConfig());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const name of Object.keys(CLEANING_PROFILES)) {
        expect(result.error).toContain(name);
      }
    }
  });
});

describe("clean command safety flag errors", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
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
  });

  afterEach(() => {
    process.exitCode = originalExitCode ?? 0;
    vi.restoreAllMocks();
  });

  it("exits non-zero and does not clean on invalid --safety", async () => {
    await cleanCommand({ safety: "not-a-tier" } as any);

    expect(process.exitCode).toBe(1);
    expect(cacheManager.cleanAllCaches).not.toHaveBeenCalled();
  });

  it("exits non-zero and does not clean on invalid --profile", async () => {
    await cleanCommand({ profile: "extreme" } as any);

    expect(process.exitCode).toBe(1);
    expect(cacheManager.cleanAllCaches).not.toHaveBeenCalled();
  });

  it("passes resolved safety tiers through the cleaning criteria", async () => {
    vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([]);

    await cleanCommand({ profile: "conservative", force: true } as any);

    expect(process.exitCode).toBe(0);
    expect(cacheManager.cleanAllCaches).toHaveBeenCalledWith(
      expect.objectContaining({
        criteria: expect.objectContaining({
          safetyTiers: CLEANING_PROFILES.conservative.tiers,
          allowManualIds: [],
        }),
      }),
    );
  });

  it("forwards --allow-manual ids into the criteria", async () => {
    vi.mocked(cacheManager.cleanAllCaches).mockResolvedValue([]);

    await cleanCommand({
      force: true,
      allowManual: "app-caches:slack,app-caches:spotify" as any,
    } as any);

    expect(cacheManager.cleanAllCaches).toHaveBeenCalledWith(
      expect.objectContaining({
        criteria: expect.objectContaining({
          allowManualIds: ["app-caches:slack", "app-caches:spotify"],
        }),
      }),
    );
  });
});

describe("granular flag parsing helpers", () => {
  it("parses age expressions into days", () => {
    expect(parseAgeToDays("7d")).toBe(7);
    expect(parseAgeToDays("2w")).toBe(14);
    expect(parseAgeToDays("1m")).toBe(30);
    expect(parseAgeToDays("3")).toBe(3);
    expect(parseAgeToDays("nope")).toBeUndefined();
    expect(parseAgeToDays(undefined)).toBeUndefined();
  });

  it("parses size expressions into MB", () => {
    expect(parseSizeToMB("100MB")).toBe(100);
    expect(parseSizeToMB("1GB")).toBe(1024);
    expect(parseSizeToMB("512kb")).toBe(0.5);
    expect(parseSizeToMB("250")).toBe(250);
    expect(parseSizeToMB("huge")).toBeUndefined();
    expect(parseSizeToMB(undefined)).toBeUndefined();
  });
});
