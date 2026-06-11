import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheManager } from "../../cleaners";
import { BaseCleaner } from "../../cleaners/BaseCleaner";
import { CacheCategory, ClearResult } from "../../types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("manual-tier architectural invariant", () => {
  it("only BaseCleaner subclasses may declare manual-tier categories", async () => {
    // The manual-tier consent gate lives in BaseCleaner.filterCategories /
    // clearByCategory. Any cleaner that declares a manual category without
    // inheriting from BaseCleaner would bypass the gate entirely, so the
    // registry must never contain such a cleaner.
    const cleaners = cacheManager.getAllCleaners();
    expect(cleaners.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const cleaner of cleaners) {
      let categories: CacheCategory[] = [];
      try {
        categories = (await cleaner.getCacheCategories?.()) ?? [];
      } catch {
        // In the memfs test environment some cleaners cannot enumerate
        // categories (missing binaries, mocked execa); treat as empty.
        categories = [];
      }

      for (const category of categories) {
        if (category.safety === "manual" && !(cleaner instanceof BaseCleaner)) {
          violations.push(`${cleaner.name} -> ${category.id}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("registers the app-caches discovery cleaner as a BaseCleaner gate inheritor", () => {
    // app-caches is the cleaner that produces manual-tier categories in
    // production (e.g. Spotify PersistentCache, ML model stores), so it must
    // inherit the BaseCleaner consent gate.
    const appCaches = cacheManager.getCleaner("app-caches");
    expect(appCaches).toBeDefined();
    expect(appCaches).toBeInstanceOf(BaseCleaner);
  });
});

describe("cleanAllCaches forwards manual consent to clearByCategory", () => {
  function stubResult(name: string): ClearResult {
    return {
      name,
      success: true,
      sizeBefore: 0,
      sizeAfter: 0,
      clearedPaths: [],
      clearedCategories: [],
    };
  }

  function stubAppCachesCleaner() {
    const appCaches = cacheManager.getCleaner("app-caches")!;
    vi.spyOn(cacheManager, "getEnabledCleaners").mockReturnValue([appCaches]);
    vi.spyOn(appCaches, "getCacheInfo").mockResolvedValue({
      name: appCaches.name,
      type: appCaches.type,
      description: appCaches.description,
      paths: [],
      isInstalled: true,
      size: 0,
    });
    const spy = vi
      .spyOn(appCaches, "clearByCategory")
      .mockResolvedValue(stubResult(appCaches.name));
    return spy;
  }

  it("passes criteria.allowManualIds through as the 5th clearByCategory argument", async () => {
    const spy = stubAppCachesCleaner();

    const results = await cacheManager.cleanAllCaches({
      include: ["app-caches"],
      subCachesToClear: new Map([["app-caches", ["some-id"]]]),
      criteria: { allowManualIds: ["some-id"] },
      dryRun: true,
    });

    expect(results).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);

    const call = spy.mock.calls[0];
    expect(call[0]).toEqual(["some-id"]); // categoryIds
    expect(call[1]).toBe(true); // dryRun
    expect(call[4]).toEqual(["some-id"]); // allowManualIds (5th argument)
  });

  it("forwards undefined consent when criteria carries no allowManualIds", async () => {
    const spy = stubAppCachesCleaner();

    await cacheManager.cleanAllCaches({
      include: ["app-caches"],
      subCachesToClear: new Map([["app-caches", ["some-id"]]]),
      criteria: {},
      dryRun: true,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][4]).toBeUndefined();
  });
});
