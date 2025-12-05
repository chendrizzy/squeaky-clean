import { beforeEach, describe, expect, it } from "vitest";
import { DockerCleaner } from "../../cleaners/docker.js";

describe("DockerCleaner - Basic Interface", () => {
  let cleaner: DockerCleaner;

  beforeEach(() => {
    cleaner = new DockerCleaner();
  });

  it("should have the correct name, type, and description", () => {
    expect(cleaner.name).toBe("docker");
    expect(cleaner.type).toBe("system");
    expect(cleaner.description).toBe(
      "Docker images, containers, volumes, networks, and build cache",
    );
  });

  it("should have the required CleanerModule methods", () => {
    expect(typeof cleaner.isAvailable).toBe("function");
    expect(typeof cleaner.getCacheInfo).toBe("function");
    expect(typeof cleaner.clear).toBe("function");
  });

  it("should handle Docker not being available gracefully", async () => {
    // This will actually try to run docker commands, but that's ok for testing the interface
    const isAvailable = await cleaner.isAvailable();
    expect(typeof isAvailable).toBe("boolean");

    const cacheInfo = await cleaner.getCacheInfo();
    expect(cacheInfo).toHaveProperty("name", "docker");
    expect(cacheInfo).toHaveProperty("type", "system");
    expect(cacheInfo).toHaveProperty("description");
    expect(cacheInfo).toHaveProperty("paths");
    expect(cacheInfo).toHaveProperty("isInstalled");
    expect(cacheInfo).toHaveProperty("size");
    expect(Array.isArray(cacheInfo.paths)).toBe(true);
    expect(typeof cacheInfo.isInstalled).toBe("boolean");
    expect(typeof cacheInfo.size).toBe("number");
  });

  it("should handle clear operation gracefully", async () => {
    const result = await cleaner.clear(true); // dry run

    expect(result).toHaveProperty("name", "docker");
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("clearedPaths");
    expect(typeof result.success).toBe("boolean");
    expect(Array.isArray(result.clearedPaths)).toBe(true);
    expect(typeof result.sizeBefore).toBe("number");
    expect(typeof result.sizeAfter).toBe("number");
  });

  it("should parse Docker sizes correctly", () => {
    // Test the private parseDockerSize method
    const parseMethod = (cleaner as any).parseDockerSize.bind(cleaner);

    expect(parseMethod("1B")).toBe(1);
    expect(parseMethod("1KB")).toBe(1024);
    expect(parseMethod("1MB")).toBe(1024 * 1024);
    expect(parseMethod("1GB")).toBe(1024 * 1024 * 1024);
    expect(parseMethod("2.5GB")).toBe(2.5 * 1024 * 1024 * 1024);
    expect(parseMethod("0B")).toBe(0);
    expect(parseMethod("--")).toBe(0);
    expect(parseMethod("")).toBe(0);
  });
});
