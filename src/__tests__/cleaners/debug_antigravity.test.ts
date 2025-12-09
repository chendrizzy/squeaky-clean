import { beforeEach, describe, expect, it, vi, afterAll } from "vitest";
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

// Import cleaner AFTER mocks
import antigravityCleaner from "../../cleaners/antigravity";

describe("Debug test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pathExists).mockResolvedValue(false);
    vi.mocked(getDirectorySize).mockResolvedValue(0);
    vi.mocked(getEstimatedDirectorySize).mockResolvedValue(0);
    vi.mocked(safeRmrf).mockResolvedValue(undefined);
    vi.mocked(os.platform).mockReturnValue("darwin");
    vi.mocked(os.homedir).mockReturnValue("/Users/test");
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CACHE_HOME;
    delete process.env.APPDATA;
    delete process.env.LOCALAPPDATA;
  });

  it("debug: check what paths are actually passed to pathExists on Windows", async () => {
    vi.mocked(os.platform).mockReturnValue("win32");
    vi.mocked(os.homedir).mockReturnValue("C:\\Users\\test");

    const checkedPaths: string[] = [];
    vi.mocked(pathExists).mockImplementation(async (p: string) => {
      checkedPaths.push(p);
      const hasAppData = p.includes("AppData");
      const hasAntigravity = p.includes("Antigravity");
      const result = hasAppData && hasAntigravity;
      return result;
    });

    const available = await antigravityCleaner.isAvailable();

    // Verify the mocks are working correctly
    expect(os.platform()).toBe("win32");
    expect(os.homedir()).toBe("C:\\Users\\test");

    // Debug: throw if no paths checked - this would mean getCachePaths isn't being called correctly
    if (checkedPaths.length === 0) {
      throw new Error(
        "No paths were checked! The cleaner didn't call pathExists at all.",
      );
    }

    // Debug: show all paths that were checked
    const pathsWithAppData = checkedPaths.filter(
      (p) => p.includes("AppData") && p.includes("Antigravity"),
    );
    if (pathsWithAppData.length === 0) {
      throw new Error(
        `No AppData+Antigravity paths found in checked paths: ${JSON.stringify(checkedPaths)}`,
      );
    }

    expect(available).toBe(true);
  });

  it("debug: check Linux paths", async () => {
    vi.mocked(os.platform).mockReturnValue("linux");
    vi.mocked(os.homedir).mockReturnValue("/home/test");

    const checkedPaths: string[] = [];
    vi.mocked(pathExists).mockImplementation(async (p: string) => {
      checkedPaths.push(p);
      const hasConfig = p.includes(".config");
      const hasAntigravity = p.includes("Antigravity");
      return hasConfig && hasAntigravity;
    });

    const available = await antigravityCleaner.isAvailable();

    // Verify with assertions
    expect(os.platform()).toBe("linux");
    expect(os.homedir()).toBe("/home/test");
    expect(checkedPaths.length).toBeGreaterThan(0);
    expect(available).toBe(true);
  });
});
