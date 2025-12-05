import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";

// Mock rimraf since it doesn't work well with memfs
vi.mock("rimraf", () => ({
  rimraf: vi.fn().mockResolvedValue(undefined),
}));
import {
  pathExists,
  getDirectorySize,
  getEstimatedDirectorySize,
  safeRmrf,
  createDirectoryIfNotExists,
  isWritable,
  getFileModificationTime,
  sanitizePath,
} from "../../utils/fs";

describe("File System Utilities", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  describe("pathExists", () => {
    it("should return true for existing files", async () => {
      vol.mkdirSync("/test", { recursive: true });
      vol.writeFileSync("/test/file.txt", "content");

      const exists = await pathExists("/test/file.txt");
      expect(exists).toBe(true);
    });

    it("should return true for existing directories", async () => {
      vol.mkdirSync("/test/dir", { recursive: true });

      const exists = await pathExists("/test/dir");
      expect(exists).toBe(true);
    });

    it("should return false for non-existing paths", async () => {
      const exists = await pathExists("/non/existing/path");
      expect(exists).toBe(false);
    });

    it("should handle permission errors gracefully", async () => {
      // Mock fs.access to throw permission error
      const fs = await import("fs/promises");
      vi.spyOn(fs, "access").mockRejectedValueOnce(
        new Error("EACCES: permission denied"),
      );

      const exists = await pathExists("/restricted/path");
      expect(exists).toBe(false);
    });
  });

  describe("getDirectorySize", () => {
    it("should return file size for a single file", async () => {
      const content = "Hello, World!";
      vol.mkdirSync("/test", { recursive: true });
      vol.writeFileSync("/test/file.txt", content);

      const size = await getDirectorySize("/test/file.txt");
      expect(size).toBe(content.length);
    });

    it("should calculate total size for directory", async () => {
      vol.mkdirSync("/test/dir", { recursive: true });
      vol.writeFileSync("/test/dir/file1.txt", "12345"); // 5 bytes
      vol.writeFileSync("/test/dir/file2.txt", "1234567890"); // 10 bytes

      const size = await getDirectorySize("/test/dir");
      expect(size).toBe(15);
    });

    it("should handle nested directories", async () => {
      vol.mkdirSync("/test/dir/subdir", { recursive: true });
      vol.writeFileSync("/test/dir/file1.txt", "12345"); // 5 bytes
      vol.writeFileSync("/test/dir/subdir/file2.txt", "1234567890"); // 10 bytes

      const size = await getDirectorySize("/test/dir");
      expect(size).toBe(15);
    });

    it("should respect item limit to prevent memory issues", async () => {
      // Create more than the maxItems limit
      vol.mkdirSync("/test/bigdir", { recursive: true });
      for (let i = 0; i < 20000; i++) {
        vol.writeFileSync(`/test/bigdir/file${i}.txt`, "content");
      }

      const size = await getDirectorySize("/test/bigdir");
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(20000 * 7); // Should stop before processing all files
    });

    it("should use estimated size when skipLargeDirectories is true", async () => {
      vol.mkdirSync("/test/dir", { recursive: true });
      vol.writeFileSync("/test/dir/file1.txt", "12345");

      const size = await getDirectorySize("/test/dir", true);
      expect(size).toBeGreaterThan(0);
    });

    it("should return 0 for non-existing paths", async () => {
      const size = await getDirectorySize("/non/existing/path");
      expect(size).toBe(0);
    });
  });

  describe("getEstimatedDirectorySize", () => {
    it("should return file size for single file", async () => {
      const content = "Hello, World!";
      vol.mkdirSync("/test", { recursive: true });
      vol.writeFileSync("/test/file.txt", content);

      const size = await getEstimatedDirectorySize("/test/file.txt");
      expect(size).toBe(content.length);
    });

    it("should estimate directory size based on sample", async () => {
      vol.mkdirSync("/test/dir", { recursive: true });
      // Create files with consistent size for predictable estimation
      for (let i = 0; i < 10; i++) {
        vol.writeFileSync(`/test/dir/file${i}.txt`, "1234567890"); // 10 bytes each
      }

      const estimatedSize = await getEstimatedDirectorySize("/test/dir");
      expect(estimatedSize).toBe(100); // 10 files * 10 bytes = 100 bytes
    });

    it("should return 0 for empty directory", async () => {
      vol.mkdirSync("/test/empty", { recursive: true });

      const size = await getEstimatedDirectorySize("/test/empty");
      expect(size).toBe(0);
    });

    it("should return 0 for non-existing paths", async () => {
      const size = await getEstimatedDirectorySize("/non/existing/path");
      expect(size).toBe(0);
    });
  });

  describe("safeRmrf", () => {
    it("should delete existing files", async () => {
      vol.mkdirSync("/home/testuser/.cache", { recursive: true });
      vol.writeFileSync("/home/testuser/.cache/test-file.txt", "content");

      // Simulate file deletion after rimraf is called
      const { rimraf } = await import("rimraf");
      vi.mocked(rimraf).mockImplementationOnce(async (path) => {
        vol.rmSync(path as string, { recursive: true, force: true });
        return undefined;
      });

      await safeRmrf("/home/testuser/.cache/test-file.txt");

      const exists = await pathExists("/home/testuser/.cache/test-file.txt");
      expect(exists).toBe(false);
    });

    it("should delete directories recursively", async () => {
      vol.mkdirSync("/home/testuser/.cache/test-dir/subdir", {
        recursive: true,
      });
      vol.writeFileSync("/home/testuser/.cache/test-dir/file.txt", "content");
      vol.writeFileSync(
        "/home/testuser/.cache/test-dir/subdir/nested.txt",
        "nested",
      );

      // Simulate directory deletion after rimraf is called
      const { rimraf } = await import("rimraf");
      vi.mocked(rimraf).mockImplementationOnce(async (path) => {
        vol.rmSync(path as string, { recursive: true, force: true });
        return undefined;
      });

      await safeRmrf("/home/testuser/.cache/test-dir");

      const exists = await pathExists("/home/testuser/.cache/test-dir");
      expect(exists).toBe(false);
    });

    it("should handle non-existing paths gracefully", async () => {
      await expect(safeRmrf("/non/existing/path")).resolves.not.toThrow();
    });

    it("should reject unsafe paths outside home/cache directories", async () => {
      vol.mkdirSync("/system/important", { recursive: true });
      vol.writeFileSync("/system/important/file.txt", "critical data");

      await expect(safeRmrf("/system/important/file.txt")).rejects.toThrow(
        "Refusing to delete path outside safe directories",
      );
    });

    it("should allow deletion of cache directories", async () => {
      vol.mkdirSync("/home/testuser/cache", { recursive: true });
      vol.writeFileSync("/home/testuser/cache/file.txt", "cache data");

      await expect(
        safeRmrf("/home/testuser/cache/file.txt"),
      ).resolves.not.toThrow();
    });

    it("should allow deletion of node_modules", async () => {
      vol.mkdirSync("/home/testuser/project/node_modules", { recursive: true });
      vol.writeFileSync(
        "/home/testuser/project/node_modules/package.json",
        "{}",
      );

      await expect(
        safeRmrf("/home/testuser/project/node_modules"),
      ).resolves.not.toThrow();
    });

    it("should allow deletion of temp directories", async () => {
      vol.mkdirSync("/tmp", { recursive: true });
      vol.writeFileSync("/tmp/temp-file.txt", "temp data");

      await expect(safeRmrf("/tmp/temp-file.txt")).resolves.not.toThrow();
    });
  });

  describe("createDirectoryIfNotExists", () => {
    it("should create directory if it does not exist", async () => {
      await createDirectoryIfNotExists("/test/new/directory");

      const exists = await pathExists("/test/new/directory");
      expect(exists).toBe(true);
    });

    it("should not throw if directory already exists", async () => {
      vol.mkdirSync("/test/existing", { recursive: true });

      await expect(
        createDirectoryIfNotExists("/test/existing"),
      ).resolves.not.toThrow();
    });

    it("should create parent directories recursively", async () => {
      await createDirectoryIfNotExists("/test/deep/nested/directory");

      const exists = await pathExists("/test/deep/nested/directory");
      expect(exists).toBe(true);
    });
  });

  describe("isWritable", () => {
    it("should return true for writable directory", async () => {
      vol.mkdirSync("/test/writable", { recursive: true });

      const writable = await isWritable("/test/writable");
      expect(writable).toBe(true);
    });

    it("should return false for non-existing directory", async () => {
      const writable = await isWritable("/non/existing/path");
      expect(writable).toBe(false);
    });

    it("should handle permission errors", async () => {
      // Mock fs.access to throw permission error
      const fs = await import("fs/promises");
      vi.spyOn(fs, "access").mockRejectedValueOnce(
        new Error("EACCES: permission denied"),
      );

      const writable = await isWritable("/restricted/path");
      expect(writable).toBe(false);
    });
  });

  describe("getFileModificationTime", () => {
    it("should return modification time for existing file", async () => {
      const testDate = new Date("2023-01-01T00:00:00.000Z");
      vol.mkdirSync("/test", { recursive: true });
      vol.writeFileSync("/test/file.txt", "content");

      // Mock stat to return specific mtime
      const fs = await import("fs/promises");
      vi.spyOn(fs, "stat").mockResolvedValueOnce({
        mtime: testDate,
      } as any);

      const mtime = await getFileModificationTime("/test/file.txt");
      expect(mtime).toEqual(testDate);
    });

    it("should return null for non-existing file", async () => {
      const mtime = await getFileModificationTime("/non/existing/file.txt");
      expect(mtime).toBeNull();
    });

    it("should handle stat errors gracefully", async () => {
      const fs = await import("fs/promises");
      vi.spyOn(fs, "stat").mockRejectedValueOnce(
        new Error("ENOENT: no such file"),
      );

      const mtime = await getFileModificationTime("/test/file.txt");
      expect(mtime).toBeNull();
    });
  });

  describe("sanitizePath", () => {
    it("should normalize path separators", () => {
      const sanitized = sanitizePath("path\\with\\backslashes");
      expect(sanitized).toBe("path/with/backslashes");
    });

    it("should remove invalid characters", () => {
      const sanitized = sanitizePath('path<with>invalid:chars"and|more*stuff?');
      expect(sanitized).toBe("pathwithinvalidcharsandmorestuff");
    });

    it("should handle empty string", () => {
      const sanitized = sanitizePath("");
      expect(sanitized).toBe(".");
    });

    it("should normalize relative paths", () => {
      const sanitized = sanitizePath("../parent/./current/../file.txt");
      expect(sanitized).toBe("../parent/file.txt");
    });
  });
});
