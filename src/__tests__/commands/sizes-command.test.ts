import { describe, it, expect, vi, beforeEach } from "vitest";
import { cacheManager } from "../../cleaners/index.js";
import { config } from "../../config/index.js";

vi.mock("../../cleaners/index.js", () => ({
  cacheManager: {
    getAllCacheInfo: vi.fn(),
  },
}));

function getConsoleOutput(): string {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => call.join(" "))
    .join("\n");
}

describe("sizes command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.set({
      output: {
        verbose: false,
        showSizes: true,
        useColors: false,
        emojis: "off",
      },
    });
    vi.mocked(cacheManager.getAllCacheInfo).mockResolvedValue([
      {
        name: "npm",
        type: "package-manager",
        description: "NPM cache",
        paths: ["/mock/.npm"],
        isInstalled: true,
        size: 2048,
      },
    ]);
  });

  it("does not print a duplicate command header", async () => {
    const { sizesCommand } = await import("../../commands/sizes.js");

    await sizesCommand({});

    expect(cacheManager.getAllCacheInfo).toHaveBeenCalledWith({
      showProgress: true,
    });
    expect(getConsoleOutput()).not.toContain("Cache Sizes");
    expect(getConsoleOutput()).toContain("Scanning cache directories...");
  });
});
