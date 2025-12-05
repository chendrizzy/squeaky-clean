import { beforeEach, describe, expect, it } from "vitest";
import ChromeCleaner from "../../cleaners/chrome.js";
import FirefoxCleaner from "../../cleaners/firefox.js";

describe("Browser Cleaners", () => {
  describe("ChromeCleaner", () => {
    const cleaner = ChromeCleaner;

    it("should have correct properties", () => {
      expect(cleaner.name).toBe("chrome");
      expect(cleaner.type).toBe("browser");
      expect(cleaner.description).toContain("Chrome");
    });

    it("should implement CleanerModule interface", () => {
      expect(typeof cleaner.isAvailable).toBe("function");
      expect(typeof cleaner.getCacheInfo).toBe("function");
      expect(typeof cleaner.clear).toBe("function");
    });

    it("should handle operations gracefully", async () => {
      const isAvailable = await cleaner.isAvailable();
      expect(typeof isAvailable).toBe("boolean");

      const cacheInfo = await cleaner.getCacheInfo();
      expect(cacheInfo.name).toBe("chrome");
      expect(cacheInfo.type).toBe("browser");
      expect(Array.isArray(cacheInfo.paths)).toBe(true);

      const result = await cleaner.clear(true);
      expect(result.name).toBe("chrome");
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("FirefoxCleaner", () => {
    const cleaner = FirefoxCleaner;

    it("should have correct properties", () => {
      expect(cleaner.name).toBe("firefox");
      expect(cleaner.type).toBe("browser");
      expect(cleaner.description).toContain("Firefox");
    });

    it("should implement CleanerModule interface", () => {
      expect(typeof cleaner.isAvailable).toBe("function");
      expect(typeof cleaner.getCacheInfo).toBe("function");
      expect(typeof cleaner.clear).toBe("function");
    });

    it("should handle operations gracefully", async () => {
      const isAvailable = await cleaner.isAvailable();
      expect(typeof isAvailable).toBe("boolean");

      const cacheInfo = await cleaner.getCacheInfo();
      expect(cacheInfo.name).toBe("firefox");
      expect(cacheInfo.type).toBe("browser");
      expect(Array.isArray(cacheInfo.paths)).toBe(true);

      const result = await cleaner.clear(true);
      expect(result.name).toBe("firefox");
      expect(typeof result.success).toBe("boolean");
    });
  });
});
