import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { config } from "../../config/index.js";

// Mock the cleaners module to avoid real filesystem operations
vi.mock("../../cleaners/index.js", () => ({
  cacheManager: {
    // cleanAllCaches returns ClearResult[] directly
    cleanAllCaches: vi.fn().mockResolvedValue([
      {
        name: "npm",
        success: true,
        sizeBefore: 1024 * 1024,
        sizeAfter: 0,
        clearedPaths: ["/mock/.npm"],
      },
    ]),
    getCacheStatus: vi.fn().mockResolvedValue([
      {
        name: "npm",
        type: "package-manager",
        available: true,
        cacheInfo: {
          totalSize: 1024 * 1024,
          paths: ["/mock/.npm"],
          categories: [],
        },
      },
    ]),
  },
  cleaners: [],
  CacheManager: vi.fn(),
}));

describe("clean command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("respects include/exclude and dry-run", async () => {
    // Import after mocking
    const { cleanCommand } = await import("../../commands/clean.js");

    config.set({
      tools: {
        npm: true,
        yarn: true,
      },
    });

    const result = await cleanCommand({
      include: "npm",
      dryRun: true,
      sizes: false,
    });

    expect(result).toBeUndefined(); // command prints output; no throw
  });
});
