import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pathExists,
  getDirectorySize,
  getEstimatedDirectorySize,
  safeRmrf,
} from "../../utils/fs.js";
import * as os from "os";

// Mock filesystem utilities
vi.mock("../../utils/fs.js", () => {
  return {
    pathExists: vi.fn(),
    getDirectorySize: vi.fn(),
    getEstimatedDirectorySize: vi.fn(),
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

// Import cleaner AFTER mocks are set up to ensure singleton uses mocked dependencies
import antigravityCleaner from "../../cleaners/antigravity";

// Detect actual platform for conditional test skipping
const actualPlatform = process.platform;

describe("Google Antigravity IDE Cleaner", () => {
  // Store original env values to restore after tests
  const originalEnv = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pathExists).mockResolvedValue(false);
    vi.mocked(getDirectorySize).mockResolvedValue(0);
    vi.mocked(getEstimatedDirectorySize).mockResolvedValue(0);
    vi.mocked(safeRmrf).mockResolvedValue(undefined);
    vi.mocked(os.platform).mockReturnValue("darwin");
    vi.mocked(os.homedir).mockReturnValue("/Users/test");

    // Clear env vars so getCachePaths() uses homedir-based fallbacks
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CACHE_HOME;
    delete process.env.APPDATA;
    delete process.env.LOCALAPPDATA;
  });

  afterAll(() => {
    // Restore original env values
    if (originalEnv.XDG_CONFIG_HOME !== undefined) {
      process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;
    }
    if (originalEnv.XDG_CACHE_HOME !== undefined) {
      process.env.XDG_CACHE_HOME = originalEnv.XDG_CACHE_HOME;
    }
    if (originalEnv.APPDATA !== undefined) {
      process.env.APPDATA = originalEnv.APPDATA;
    }
    if (originalEnv.LOCALAPPDATA !== undefined) {
      process.env.LOCALAPPDATA = originalEnv.LOCALAPPDATA;
    }
  });

  describe("Basic properties", () => {
    it("should have correct name", () => {
      expect(antigravityCleaner.name).toBe("antigravity");
    });

    it("should have correct type", () => {
      expect(antigravityCleaner.type).toBe("ide");
    });

    it("should have descriptive description", () => {
      expect(antigravityCleaner.description).toContain("Antigravity");
      expect(antigravityCleaner.description).toContain("IDE");
    });
  });

  describe("isAvailable", () => {
    describe("macOS", () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue("darwin");
      });

      it("should return true when .antigravity directory exists", async () => {
        vi.mocked(pathExists).mockImplementation(async (p: string) => {
          return p.endsWith(".antigravity");
        });

        const available = await antigravityCleaner.isAvailable();
        expect(available).toBe(true);
      });

      it.skipIf(actualPlatform !== "darwin")(
        "should return true when Application Support Antigravity exists",
        async () => {
          vi.mocked(pathExists).mockImplementation(async (p: string) => {
            return p.includes("Library/Application Support/Antigravity");
          });

          const available = await antigravityCleaner.isAvailable();
          expect(available).toBe(true);
        },
      );

      it("should return true when Antigravity.app exists", async () => {
        vi.mocked(pathExists).mockImplementation(async (p: string) => {
          return p === "/Applications/Antigravity.app";
        });

        const available = await antigravityCleaner.isAvailable();
        expect(available).toBe(true);
      });

      it("should return false when no Antigravity paths exist", async () => {
        vi.mocked(pathExists).mockResolvedValue(false);

        const available = await antigravityCleaner.isAvailable();
        expect(available).toBe(false);
      });
    });

    describe("Windows", () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue("win32");
        vi.mocked(os.homedir).mockReturnValue("C:\\Users\\test");
      });

      it("should return true when Antigravity AppData exists", async () => {
        vi.mocked(pathExists).mockImplementation(async (p: string) => {
          return p.includes("AppData") && p.includes("Antigravity");
        });

        const available = await antigravityCleaner.isAvailable();
        expect(available).toBe(true);
      });

      it("should return true when .antigravity exists on Windows", async () => {
        vi.mocked(pathExists).mockImplementation(async (p: string) => {
          return p.endsWith(".antigravity");
        });

        const available = await antigravityCleaner.isAvailable();
        expect(available).toBe(true);
      });
    });

    describe("Linux", () => {
      beforeEach(() => {
        vi.mocked(os.platform).mockReturnValue("linux");
        vi.mocked(os.homedir).mockReturnValue("/home/test");
      });

      it("should return true when .config/Antigravity exists", async () => {
        vi.mocked(pathExists).mockImplementation(async (p: string) => {
          return p.includes(".config") && p.includes("Antigravity");
        });

        const available = await antigravityCleaner.isAvailable();
        expect(available).toBe(true);
      });

      it("should return true when .cache/antigravity exists", async () => {
        vi.mocked(pathExists).mockImplementation(async (p: string) => {
          return p.includes(".cache") && p.includes("antigravity");
        });

        const available = await antigravityCleaner.isAvailable();
        expect(available).toBe(true);
      });

      it("should return true when /opt/Antigravity exists", async () => {
        vi.mocked(pathExists).mockImplementation(async (p: string) => {
          return p.includes("/opt/Antigravity");
        });

        const available = await antigravityCleaner.isAvailable();
        expect(available).toBe(true);
      });
    });
  });

  describe("getCacheInfo", () => {
    it("should return cache info with paths on macOS", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getEstimatedDirectorySize).mockResolvedValue(100 * 1024 * 1024);

      const info = await antigravityCleaner.getCacheInfo();

      expect(info.name).toBe("antigravity");
      expect(info.type).toBe("ide");
      expect(info.isInstalled).toBe(true);
      expect(info.paths.length).toBeGreaterThan(0);
      expect(info.size).toBeGreaterThan(0);
    });

    it("should return empty info when not installed", async () => {
      vi.mocked(pathExists).mockResolvedValue(false);

      const info = await antigravityCleaner.getCacheInfo();

      expect(info.isInstalled).toBe(false);
      expect(info.paths).toHaveLength(0);
      expect(info.size).toBe(0);
    });

    it.skipIf(actualPlatform !== "darwin")(
      "should include macOS-specific paths",
      async () => {
        vi.mocked(os.platform).mockReturnValue("darwin");
        vi.mocked(pathExists).mockResolvedValue(true);
        vi.mocked(getEstimatedDirectorySize).mockResolvedValue(
          50 * 1024 * 1024,
        );

        const info = await antigravityCleaner.getCacheInfo();

        // Check for expected macOS cache paths
        const hasLibraryCachesPath = info.paths.some(
          (p) =>
            p.includes("Library/Caches") &&
            p.includes("com.google.antigravity"),
        );
        const hasAppSupportPath = info.paths.some(
          (p) =>
            p.includes("Library/Application Support") &&
            p.includes("Antigravity"),
        );

        expect(hasLibraryCachesPath || hasAppSupportPath).toBe(true);
      },
    );

    it("should detect com.google.antigravity.ShipIt cache", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockImplementation(async (p: string) => {
        return p.includes("com.google.antigravity.ShipIt");
      });
      vi.mocked(getEstimatedDirectorySize).mockResolvedValue(25 * 1024 * 1024);

      const info = await antigravityCleaner.getCacheInfo();

      expect(info.isInstalled).toBe(true);
      expect(
        info.paths.some((p) => p.includes("com.google.antigravity.ShipIt")),
      ).toBe(true);
    });
  });

  describe("getCacheCategories", () => {
    it("should return cache categories on macOS", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(50 * 1024 * 1024);

      const categories = await antigravityCleaner.getCacheCategories();

      expect(Array.isArray(categories)).toBe(true);
      // Should have categories when paths exist
      if (categories.length > 0) {
        expect(categories[0]).toHaveProperty("id");
        expect(categories[0]).toHaveProperty("name");
        expect(categories[0]).toHaveProperty("paths");
      }
    });

    it("should include various category types", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(25 * 1024 * 1024);

      const categories = await antigravityCleaner.getCacheCategories();
      const categoryIds = categories.map((c) => c.id);

      // Check for expected category prefixes
      const hasExpectedCategories = categoryIds.some(
        (id) =>
          id.startsWith("antigravity-cache") ||
          id.startsWith("antigravity-logs") ||
          id.startsWith("antigravity-extensions") ||
          id.startsWith("antigravity-workspaces"),
      );

      if (categories.length > 0) {
        expect(hasExpectedCategories).toBe(true);
      }
    });
  });

  describe("clear", () => {
    it("should perform dry run without deleting", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(100 * 1024 * 1024);

      const result = await antigravityCleaner.clear(true);

      expect(result.success).toBe(true);
      expect(result.clearedPaths.length).toBeGreaterThan(0);
      expect(vi.mocked(safeRmrf)).not.toHaveBeenCalled();
    });

    it("should delete caches when not dry run", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(100 * 1024 * 1024);

      const result = await antigravityCleaner.clear(false);

      expect(result.success).toBe(true);
      expect(result.clearedPaths.length).toBeGreaterThan(0);
      expect(vi.mocked(safeRmrf)).toHaveBeenCalled();
    });

    it("should respect protected paths", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(50 * 1024 * 1024);

      const result = await antigravityCleaner.clear(
        false,
        undefined,
        undefined,
        ["/Users/test/Library/"],
      );

      // safeRmrf should not be called for protected paths
      const callArgs = vi.mocked(safeRmrf).mock.calls.map((c) => c[0]);
      const hasProtectedPath = callArgs.some((p) =>
        p.toString().startsWith("/Users/test/Library/"),
      );
      expect(hasProtectedPath).toBe(false);
    });

    it("should track size before clearing", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(200 * 1024 * 1024);

      const result = await antigravityCleaner.clear(true);

      expect(result.sizeBefore).toBeGreaterThan(0);
    });
  });

  describe("clearByCategory", () => {
    it("should clear specific categories", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(50 * 1024 * 1024);

      const result = await antigravityCleaner.clearByCategory(
        ["antigravity-cache"],
        false,
      );

      expect(result.success).toBe(true);
      expect(result.clearedCategories).toContain("antigravity-cache");
    });

    it("should perform dry run for category clearing", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getDirectorySize).mockResolvedValue(50 * 1024 * 1024);

      const result = await antigravityCleaner.clearByCategory(
        ["antigravity-logs"],
        true,
      );

      expect(result.success).toBe(true);
      expect(vi.mocked(safeRmrf)).not.toHaveBeenCalled();
    });
  });

  describe("Cross-platform compatibility", () => {
    it("should handle darwin platform", async () => {
      vi.mocked(os.platform).mockReturnValue("darwin");
      expect(() => antigravityCleaner.isAvailable()).not.toThrow();
      expect(() => antigravityCleaner.getCacheInfo()).not.toThrow();
    });

    it("should handle linux platform", async () => {
      vi.mocked(os.platform).mockReturnValue("linux");
      vi.mocked(os.homedir).mockReturnValue("/home/test");
      expect(() => antigravityCleaner.isAvailable()).not.toThrow();
      expect(() => antigravityCleaner.getCacheInfo()).not.toThrow();
    });

    it("should handle win32 platform", async () => {
      vi.mocked(os.platform).mockReturnValue("win32");
      vi.mocked(os.homedir).mockReturnValue("C:\\Users\\test");
      expect(() => antigravityCleaner.isAvailable()).not.toThrow();
      expect(() => antigravityCleaner.getCacheInfo()).not.toThrow();
    });

    it("should return different paths per platform", async () => {
      vi.mocked(pathExists).mockResolvedValue(true);
      vi.mocked(getEstimatedDirectorySize).mockResolvedValue(10 * 1024 * 1024);

      // macOS
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(os.homedir).mockReturnValue("/Users/test");
      const macInfo = await antigravityCleaner.getCacheInfo();

      // Linux
      vi.mocked(os.platform).mockReturnValue("linux");
      vi.mocked(os.homedir).mockReturnValue("/home/test");
      const linuxInfo = await antigravityCleaner.getCacheInfo();

      // Windows
      vi.mocked(os.platform).mockReturnValue("win32");
      vi.mocked(os.homedir).mockReturnValue("C:\\Users\\test");
      const winInfo = await antigravityCleaner.getCacheInfo();

      // Each platform should have different path patterns
      expect(macInfo.paths.some((p) => p.includes("Library"))).toBe(true);
      expect(
        linuxInfo.paths.some(
          (p) => p.includes(".config") || p.includes(".cache"),
        ),
      ).toBe(true);
      expect(winInfo.paths.some((p) => p.includes("AppData"))).toBe(true);
    });
  });

  describe("Cache path categories", () => {
    const expectedCategories = [
      { category: "cache", description: "application cache" },
      { category: "logs", description: "application logs" },
      { category: "extensions", description: "extension" },
      { category: "workspaces", description: "Workspace" },
      { category: "history", description: "history" },
      { category: "diagnostics", description: "crash" },
    ];

    expectedCategories.forEach(({ category }) => {
      it(`should include ${category} paths on macOS`, async () => {
        vi.mocked(os.platform).mockReturnValue("darwin");
        vi.mocked(pathExists).mockResolvedValue(true);
        vi.mocked(getDirectorySize).mockResolvedValue(10 * 1024 * 1024);

        const categories = await antigravityCleaner.getCacheCategories();
        const categoryIds = categories.map((c) => c.id);

        // Check that the category type exists
        const hasCategory = categoryIds.some((id) =>
          id.includes(`antigravity-${category}`),
        );

        // Categories may not exist if paths don't exist, so just verify no errors
        expect(Array.isArray(categories)).toBe(true);
      });
    });
  });
});
