import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { DockerCleaner } from "../../cleaners/docker.js";
import { resetMocks } from "../testUtils.js";
import execa from "execa";

// Mock execa to handle both CommonJS require() and ES6 import styles
vi.mock("execa", () => {
  const mockExeca = vi.fn();
  return {
    default: mockExeca,
    __esModule: true,
    ...mockExeca,
  };
});

describe("DockerCleaner", () => {
  let cleaner: DockerCleaner;

  beforeEach(() => {
    resetMocks();
    cleaner = new DockerCleaner();
    vi.clearAllMocks();
  });

  describe("isAvailable", () => {
    it("should return true when Docker server is running", async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "24.0.7",
        stderr: "",
        exitCode: 0,
        failed: false,
        killed: false,
        signal: undefined,
        timedOut: false,
        command: "docker version --format {{.Server.Version}}",
        escapedCommand: "docker version --format {{.Server.Version}}",
      } as any);

      const available = await cleaner.isAvailable();
      expect(available).toBe(true);
      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "docker",
        ["version", "--format", "{{.Server.Version}}"],
        { timeout: 10000 },
      );
    });

    it("should return true when Docker is installed but server not running", async () => {
      // First call fails (server not running)
      vi.mocked(execa).mockRejectedValueOnce(
        new Error("Cannot connect to the Docker daemon"),
      );
      // Second call succeeds (docker --version works)
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "Docker version 24.0.7",
        stderr: "",
        exitCode: 0,
        failed: false,
        killed: false,
        signal: undefined,
        timedOut: false,
        command: "docker --version",
        escapedCommand: "docker --version",
      } as any);

      const available = await cleaner.isAvailable();
      expect(available).toBe(true);
    });

    it("should return false when Docker is not installed", async () => {
      vi.mocked(execa).mockRejectedValue(
        new Error("command not found: docker"),
      );

      const available = await cleaner.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe("getCacheInfo", () => {
    it("should return empty info when Docker is not available", async () => {
      vi.mocked(execa).mockRejectedValue(
        new Error("command not found: docker"),
      );

      const info = await cleaner.getCacheInfo();

      expect(info).toMatchObject({
        name: "docker",
        type: "system",
        description:
          "Docker images, containers, volumes, networks, and build cache",
        paths: [],
        isInstalled: false,
        size: 0,
      });
    });

    it("should parse Docker system df output correctly", async () => {
      // Mock isAvailable to return true
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "24.0.7",
        exitCode: 0,
      } as any);

      // Mock system df command
      vi.mocked(execa).mockResolvedValueOnce({
        stdout:
          "TYPE\tTOTAL\tSIZE\tRECLAIMABLE\nImages\t5\t1.2GB\t800MB\nContainers\t3\t500MB\t300MB\nLocal Volumes\t2\t2GB\t1.5GB\nBuild Cache\t10\t3GB\t2.8GB",
        exitCode: 0,
      } as any);

      // Mock networks command
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "net1\nnet2\nnet3",
        exitCode: 0,
      } as any);

      const info = await cleaner.getCacheInfo();

      expect(info.isInstalled).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      expect(info.paths).toHaveLength(1);
      expect(info.paths[0]).toContain("Docker System");
    });

    it("should handle Docker command errors gracefully", async () => {
      // Mock isAvailable to return true
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "24.0.7",
        exitCode: 0,
      } as any);

      // Mock both system df command and networks command to fail
      vi.mocked(execa).mockRejectedValueOnce(
        new Error("Docker daemon not running"),
      );
      vi.mocked(execa).mockRejectedValueOnce(
        new Error("Docker daemon not running"),
      );

      const info = await cleaner.getCacheInfo();

      expect(info.isInstalled).toBe(true);
      expect(info.size).toBe(0);
      expect(info.paths).toEqual(["Docker System (0 items)"]);
    });
  });

  describe("clear", () => {
    beforeEach(() => {
      // Mock isAvailable to return true
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "24.0.7",
        exitCode: 0,
      } as any);
    });

    it("should perform dry run without actual cleanup", async () => {
      // Mock getCacheInfo call inside clear
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "TYPE\tTOTAL\tSIZE\tRECLAIMABLE\nImages\t1\t1GB\t800MB",
        exitCode: 0,
      } as any);
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "",
        exitCode: 0,
      } as any);

      const result = await cleaner.clear(true);

      expect(result.success).toBe(true);
      expect(result.clearedPaths).toContain("Docker system (dry run)");
      expect(result.sizeBefore).toBeGreaterThan(0);
      expect(result.sizeAfter).toBe(result.sizeBefore); // No change in dry run
    });

    it("should successfully clean Docker system", async () => {
      // Mock initial getCacheInfo
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "TYPE\tTOTAL\tSIZE\tRECLAIMABLE\nImages\t5\t2GB\t1.5GB",
        exitCode: 0,
      } as any);
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "net1\nnet2",
        exitCode: 0,
      } as any);

      // Mock system prune command
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "Total reclaimed space: 1.2GB",
        exitCode: 0,
      } as any);

      // Mock builder prune command
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "Total reclaimed space: 500MB",
        exitCode: 0,
      } as any);

      // Mock final getCacheInfo (after cleanup)
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "TYPE\tTOTAL\tSIZE\tRECLAIMABLE\nImages\t2\t500MB\t200MB",
        exitCode: 0,
      } as any);
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "net1",
        exitCode: 0,
      } as any);

      const result = await cleaner.clear(false);

      expect(result.success).toBe(true);
      expect(result.clearedPaths).toContain(
        "System resources (containers, networks, images, volumes)",
      );
      expect(result.clearedPaths).toContain("Build cache");
      expect(result.sizeBefore).toBeGreaterThan(result.sizeAfter!);
    });

    it("should handle Docker not available", async () => {
      // Override the default mock to simulate Docker not available
      vi.mocked(execa).mockReset();
      vi.mocked(execa).mockRejectedValue(
        new Error("command not found: docker"),
      );

      const result = await cleaner.clear();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Docker is not installed or running");
      expect(result.sizeBefore).toBe(0);
      expect(result.sizeAfter).toBe(0);
    });

    it("should handle partial cleanup failures", async () => {
      // Mock initial getCacheInfo
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "TYPE\tTOTAL\tSIZE\tRECLAIMABLE\nImages\t3\t1GB\t800MB",
        exitCode: 0,
      } as any);
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "",
        exitCode: 0,
      } as any);

      // Mock system prune to succeed
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "Total reclaimed space: 600MB",
        exitCode: 0,
      } as any);

      // Mock builder prune to fail
      vi.mocked(execa).mockRejectedValueOnce(new Error("permission denied"));

      // Mock final getCacheInfo
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "TYPE\tTOTAL\tSIZE\tRECLAIMABLE\nImages\t1\t400MB\t200MB",
        exitCode: 0,
      } as any);
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "",
        exitCode: 0,
      } as any);

      const result = await cleaner.clear();

      expect(result.success).toBe(false); // Overall failure due to builder prune
      expect(result.clearedPaths).toContain(
        "System resources (containers, networks, images, volumes)",
      );
      expect(result.error).toContain("Builder prune failed");
    });

    it("should handle no Docker items to clean", async () => {
      // Mock getCacheInfo to return zero size
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "",
        exitCode: 0,
      } as any);
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "",
        exitCode: 0,
      } as any);

      const result = await cleaner.clear();

      expect(result.success).toBe(true);
      expect(result.sizeBefore).toBe(0);
      expect(result.sizeAfter).toBe(0);
      expect(result.clearedPaths).toEqual([]);
    });
  });

  describe("parseDockerSize", () => {
    it("should parse different size units correctly", () => {
      // Access the private method for testing (this is a bit hacky but useful for unit testing)
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
});
