import { describe, expect, it } from "vitest";
import { BaseCleaner } from "../../cleaners/BaseCleaner";
import { CacheInfo, CacheType } from "../../types";

/** Minimal concrete cleaner to exercise BaseCleaner's protected helpers. */
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

describe("BaseCleaner.isProtectedPath", () => {
  const cleaner = new TestCleaner();

  it("returns false when there are no protected paths", () => {
    expect(cleaner.checkProtected("/home/u/.cache/foo", [])).toBe(false);
  });

  it("matches an exact protected path", () => {
    expect(
      cleaner.checkProtected("/home/u/.cache/foo", ["/home/u/.cache/foo"]),
    ).toBe(true);
  });

  it("matches a path inside a protected directory", () => {
    expect(
      cleaner.checkProtected("/home/u/.cache/foo/bar", ["/home/u/.cache/foo"]),
    ).toBe(true);
  });

  it("does not match an unrelated path", () => {
    expect(
      cleaner.checkProtected("/home/u/.cache/other", ["/home/u/.cache/foo"]),
    ).toBe(false);
  });

  it("does not match a sibling that shares a name prefix", () => {
    // "/a/foobar" must not be treated as living inside "/a/foo".
    expect(cleaner.checkProtected("/a/foobar", ["/a/foo"])).toBe(false);
  });

  it("protects case-insensitively (case-mismatched pattern still matches)", () => {
    // On case-insensitive filesystems these denote the same location; a missed
    // match would let explicitly-protected data be deleted.
    expect(
      cleaner.checkProtected("/Users/U/Library/Caches/MyApp", [
        "/users/u/library/caches/myapp",
      ]),
    ).toBe(true);
    expect(
      cleaner.checkProtected("/Users/U/Library/Caches/MyApp/sub", [
        "/users/u/library/caches/myapp",
      ]),
    ).toBe(true);
  });

  it("supports glob protected patterns", () => {
    expect(
      cleaner.checkProtected("/home/u/.cache/foo", ["/home/u/.cache/*"]),
    ).toBe(true);
  });
});
