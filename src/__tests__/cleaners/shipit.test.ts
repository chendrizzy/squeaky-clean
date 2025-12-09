import { beforeEach, describe, expect, it, vi } from "vitest";
import shipitCleaner from "../../cleaners/shipit";
import { pathExists, getDirectorySize, safeRmrf } from "../../utils/fs.js";
import * as os from "os";
import * as fs from "fs";

// Mock filesystem utilities
vi.mock("../../utils/fs.js", () => {
  return {
    pathExists: vi.fn(),
    getDirectorySize: vi.fn(),
    safeRmrf: vi.fn(),
  };
});

// Mock os module
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    homedir: vi.fn(() => "/Users/test"),
    platform: vi.fn(() => "darwin"),
  };
});

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readdirSync: vi.fn(() => []),
  };
});

describe("ShipIt Cache Cleaner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pathExists).mockResolvedValue(false);
    vi.mocked(getDirectorySize).mockResolvedValue(0);
    vi.mocked(safeRmrf).mockResolvedValue(undefined);
    vi.mocked(os.platform).mockReturnValue("darwin");
    vi.mocked(os.homedir).mockReturnValue("/Users/test");
    vi.mocked(fs.readdirSync).mockReturnValue([]);
  });

  describe("Basic properties", () => {
    it("should have correct name", () => {
      expect(shipitCleaner.name).toBe("shipit");
    });

    it("should have correct type", () => {
      expect(shipitCleaner.type).toBe("system");
    });

    it("should have descriptive description", () => {
      expect(shipitCleaner.description).toContain("ShipIt");
      expect(shipitCleaner.description).toContain("update");
    });
  });

  describe("isAvailable", () => {
    it("should return false on non-macOS platforms", async () => {
      vi.mocked(os.platform).mockReturnValue("linux");
      const available = await shipitCleaner.isAvailable();
      expect(available).toBe(false);
    });

    it("should return false on Windows", async () => {
      vi.mocked(os.platform).mockReturnValue("win32");
      const available = await shipitCleaner.isAvailable();
      expect(available).toBe(false);
    });

    it("should return true when ShipIt caches exist on macOS", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "com.google.Chrome.ShipIt", isDirectory: () => true } as any,
      ]);

      const available = await shipitCleaner.isAvailable();
      expect(available).toBe(true);
    });

    it("should return false when no ShipIt caches exist", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      // Caches dir exists but no ShipIt dirs, and no Keystone paths exist
      vi.mocked(pathExists).mockImplementation(async (p: string) => {
        if (p.endsWith("/Library/Caches")) return true;
        return false; // No Keystone or GoogleSoftwareUpdate
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "com.apple.Safari", isDirectory: () => true } as any,
      ]);

      const available = await shipitCleaner.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe("getCacheInfo", () => {
    it("should return empty info on non-macOS", async () => {
      vi.mocked(os.platform).mockReturnValue("linux");

      const info = await shipitCleaner.getCacheInfo();

      expect(info.name).toBe("shipit");
      expect(info.isInstalled).toBe(false);
      expect(info.paths).toHaveLength(0);
      expect(info.size).toBe(0);
    });

    it("should detect ShipIt caches on macOS", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "com.google.Chrome.ShipIt", isDirectory: () => true } as any,
        { name: "com.microsoft.VSCode.ShipIt", isDirectory: () => true } as any,
      ]);
      vi.mocked(getDirectorySize).mockResolvedValue(50 * 1024 * 1024); // 50MB each

      const info = await shipitCleaner.getCacheInfo();

      expect(info.isInstalled).toBe(true);
      expect(info.paths.length).toBeGreaterThan(0);
      expect(info.size).toBeGreaterThan(0);
    });

    it("should detect Google Keystone caches", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockImplementation(async (p: string) => {
        return p.includes("GoogleSoftwareUpdate") || p.includes("Keystone");
      });
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      vi.mocked(getDirectorySize).mockResolvedValue(100 * 1024 * 1024);

      const info = await shipitCleaner.getCacheInfo();

      expect(info.isInstalled).toBe(true);
      expect(info.paths.some((p) => p.includes("Google"))).toBe(true);
    });

    it("should detect com.google.antigravity.ShipIt pattern", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        {
          name: "com.google.antigravity.ShipIt",
          isDirectory: () => true,
        } as any,
      ]);
      vi.mocked(getDirectorySize).mockResolvedValue(25 * 1024 * 1024);

      const info = await shipitCleaner.getCacheInfo();

      expect(info.isInstalled).toBe(true);
      expect(
        info.paths.some((p) => p.includes("com.google.antigravity.ShipIt")),
      ).toBe(true);
    });
  });

  describe("clear", () => {
    it("should not clear on non-macOS platforms", async () => {
      vi.mocked(os.platform).mockReturnValue("win32");

      const result = await shipitCleaner.clear(false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("macOS only");
      expect(vi.mocked(safeRmrf)).not.toHaveBeenCalled();
    });

    it("should perform dry run without deleting", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "com.google.Chrome.ShipIt", isDirectory: () => true } as any,
      ]);
      vi.mocked(getDirectorySize).mockResolvedValue(50 * 1024 * 1024);

      const result = await shipitCleaner.clear(true);

      expect(result.clearedPaths.length).toBeGreaterThan(0);
      expect(vi.mocked(safeRmrf)).not.toHaveBeenCalled();
    });

    it("should delete caches when not dry run", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "com.github.atom.ShipIt", isDirectory: () => true } as any,
      ]);
      vi.mocked(getDirectorySize).mockResolvedValue(30 * 1024 * 1024);

      const result = await shipitCleaner.clear(false);

      expect(result.success).toBe(true);
      expect(result.clearedPaths.length).toBeGreaterThan(0);
      expect(vi.mocked(safeRmrf)).toHaveBeenCalled();
    });

    it("should respect protected paths", async () => {
      vi.mocked(safeRmrf).mockClear();
      vi.mocked(os.platform).mockReturnValue("darwin");
      // Only return true for Caches dir (to allow readdirSync), false for Keystone paths
      vi.mocked(pathExists).mockImplementation(async (p: string) => {
        if (p.endsWith("/Library/Caches")) return true;
        if (p.includes("com.google.Chrome.ShipIt")) return true;
        return false; // GoogleSoftwareUpdate and Keystone.Agent return false
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "com.google.Chrome.ShipIt", isDirectory: () => true } as any,
      ]);
      vi.mocked(getDirectorySize).mockResolvedValue(50 * 1024 * 1024);

      const result = await shipitCleaner.clear(false, undefined, undefined, [
        "**/com.google.Chrome.ShipIt",
      ]);

      expect(vi.mocked(safeRmrf)).not.toHaveBeenCalled();
    });
  });

  describe("Cross-platform compatibility", () => {
    it("should handle darwin platform", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      expect(() => shipitCleaner.isAvailable()).not.toThrow();
      expect(() => shipitCleaner.getCacheInfo()).not.toThrow();
    });

    it("should handle linux platform gracefully", async () => {
      vi.mocked(os.platform).mockReturnValue("linux");
      const available = await shipitCleaner.isAvailable();
      expect(available).toBe(false);

      const info = await shipitCleaner.getCacheInfo();
      expect(info.isInstalled).toBe(false);
    });

    it("should handle win32 platform gracefully", async () => {
      vi.mocked(os.platform).mockReturnValue("win32");
      const available = await shipitCleaner.isAvailable();
      expect(available).toBe(false);

      const info = await shipitCleaner.getCacheInfo();
      expect(info.isInstalled).toBe(false);
    });
  });

  describe("Known ShipIt patterns", () => {
    const knownPatterns = [
      "com.google.antigravity.ShipIt",
      "com.google.Chrome.ShipIt",
      "com.github.atom.ShipIt",
      "com.microsoft.VSCode.ShipIt",
      "com.spotify.client.ShipIt",
      "com.slack.Slack.ShipIt",
      "com.discord.Discord.ShipIt",
    ];

    knownPatterns.forEach((pattern) => {
      it(`should detect ${pattern}`, async () => {
        vi.mocked(os.platform).mockReturnValue("darwin");
        vi.mocked(pathExists).mockResolvedValue(true);
        vi.mocked(fs.readdirSync).mockReturnValue([
          { name: pattern, isDirectory: () => true } as any,
        ]);
        vi.mocked(getDirectorySize).mockResolvedValue(10 * 1024 * 1024);

        const info = await shipitCleaner.getCacheInfo();

        expect(info.isInstalled).toBe(true);
        expect(info.paths.some((p) => p.includes(pattern))).toBe(true);
      });
    });

    it("should detect wildcard *.ShipIt patterns", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "com.unknown.app.ShipIt", isDirectory: () => true } as any,
      ]);
      vi.mocked(getDirectorySize).mockResolvedValue(10 * 1024 * 1024);

      const info = await shipitCleaner.getCacheInfo();

      expect(info.isInstalled).toBe(true);
      expect(
        info.paths.some((p) => p.includes("com.unknown.app.ShipIt")),
      ).toBe(true);
    });
  });
});
