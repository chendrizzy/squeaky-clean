// Real-path OS-behavior test for protected-path matching. Uses real platform
// paths (os.tmpdir(), path.join) rather than POSIX literals so it validates
// BaseCleaner.isProtectedPath on the actual OS - on Windows resolve() yields
// backslash paths, which the separator normalization must handle.
import { describe, it, expect } from "vitest";
import * as os from "os";
import * as path from "path";
import { BaseCleaner } from "../../cleaners/BaseCleaner";
import { CacheInfo, CacheType } from "../../types";

class TestCleaner extends BaseCleaner {
  name = "test";
  type: CacheType = "system";
  description = "test cleaner";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: [],
      isInstalled: true,
      size: 0,
    };
  }

  checkProtected(p: string, protectedPaths: string[]): boolean {
    return this.isProtectedPath(p, protectedPaths);
  }
}

describe(`isProtectedPath (real platform paths, ${os.platform()})`, () => {
  const cleaner = new TestCleaner();
  const baseDir = path.join(os.tmpdir(), "squeaky-protected-base");

  it("protects an exact real path", () => {
    expect(cleaner.checkProtected(baseDir, [baseDir])).toBe(true);
  });

  it("protects a real nested path under a protected directory", () => {
    const nested = path.join(baseDir, "sub", "deep", "file.bin");
    expect(cleaner.checkProtected(nested, [baseDir])).toBe(true);
  });

  it("does not protect an unrelated real path", () => {
    const other = path.join(os.tmpdir(), "squeaky-unrelated");
    expect(cleaner.checkProtected(other, [baseDir])).toBe(false);
  });

  it("does not protect a sibling that shares a name prefix", () => {
    // baseDir + "x" must not be treated as living inside baseDir.
    expect(cleaner.checkProtected(baseDir + "x", [baseDir])).toBe(false);
  });
});
