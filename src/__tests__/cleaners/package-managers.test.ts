import { beforeEach, describe, expect, it } from "vitest";
import { NpmCleaner } from "../../cleaners/npm.js";
import YarnCleaner from "../../cleaners/yarn.js";
import PnpmCleaner from "../../cleaners/pnpm.js";
import BunCleaner from "../../cleaners/bun.js";
import PipCleaner from "../../cleaners/pip.js";

describe("Package Manager Cleaners", () => {
  describe("NpmCleaner", () => {
    let cleaner: NpmCleaner;

    beforeEach(() => {
      cleaner = new NpmCleaner();
    });

    it("should have correct properties", () => {
      expect(cleaner.name).toBe("npm");
      expect(cleaner.type).toBe("package-manager");
      expect(cleaner.description).toBe(
        "NPM package manager cache and temporary files",
      );
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
      expect(cacheInfo.name).toBe("npm");
      expect(cacheInfo.type).toBe("package-manager");
      expect(Array.isArray(cacheInfo.paths)).toBe(true);

      const result = await cleaner.clear(true); // dry run
      expect(result.name).toBe("npm");
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("YarnCleaner", () => {
    const cleaner = YarnCleaner;

    it("should have correct properties", () => {
      expect(cleaner.name).toBe("yarn");
      expect(cleaner.type).toBe("package-manager");
      expect(cleaner.description).toContain("Yarn");
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
      expect(cacheInfo.name).toBe("yarn");
      expect(cacheInfo.type).toBe("package-manager");

      const result = await cleaner.clear(true);
      expect(result.name).toBe("yarn");
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("PnpmCleaner", () => {
    const cleaner = PnpmCleaner;

    it("should have correct properties", () => {
      expect(cleaner.name).toBe("pnpm");
      expect(cleaner.type).toBe("package-manager");
      expect(cleaner.description).toContain("PNPM");
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
      expect(cacheInfo.name).toBe("pnpm");
      expect(cacheInfo.type).toBe("package-manager");

      const result = await cleaner.clear(true);
      expect(result.name).toBe("pnpm");
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("BunCleaner", () => {
    const cleaner = BunCleaner;

    it("should have correct properties", () => {
      expect(cleaner.name).toBe("bun");
      expect(cleaner.type).toBe("package-manager");
      expect(cleaner.description).toContain("Bun");
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
      expect(cacheInfo.name).toBe("bun");
      expect(cacheInfo.type).toBe("package-manager");

      const result = await cleaner.clear(true);
      expect(result.name).toBe("bun");
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("PipCleaner", () => {
    const cleaner = PipCleaner;

    it("should have correct properties", () => {
      expect(cleaner.name).toBe("pip");
      expect(cleaner.type).toBe("package-manager");
      expect(cleaner.description).toContain("pip");
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
      expect(cacheInfo.name).toBe("pip");
      expect(cacheInfo.type).toBe("package-manager");

      const result = await cleaner.clear(true);
      expect(result.name).toBe("pip");
      expect(typeof result.success).toBe("boolean");
    });
  });
});
