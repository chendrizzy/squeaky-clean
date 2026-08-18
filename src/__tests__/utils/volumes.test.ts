import { describe, expect, it, vi } from "vitest";
import * as path from "path";
import {
  aggregateVolumeBreakdown,
  computeVolumeBreakdown,
  resolveVolume,
  volumeLabel,
  volumeOf,
} from "../../utils/volumes";
import { BaseCleaner } from "../../cleaners/BaseCleaner";
import { CacheCategory, CacheInfo, CacheType } from "../../types";

describe("volumeOf", () => {
  it("maps /Volumes/<name> paths to their mount", () => {
    expect(volumeOf("/Volumes/BOLT/cache/npm")).toBe("/Volumes/BOLT");
    expect(volumeOf("/Volumes/CHENDRIX/GitHub/x")).toBe("/Volumes/CHENDRIX");
  });

  it("maps everything else to the boot volume", () => {
    expect(volumeOf("/Users/justin/.npm")).toBe("/");
    expect(volumeOf("/private/tmp/x")).toBe("/");
    expect(volumeOf("/Volumes")).toBe("/");
  });

  it("maps Windows paths to their drive", () => {
    expect(volumeOf("C:\\Users\\x\\AppData")).toBe("C:\\");
    expect(volumeOf("d:/temp/cache")).toBe("D:\\");
  });
});

describe("resolveVolume", () => {
  it("walks up to an existing ancestor for deleted paths", async () => {
    // The leaf does not exist; the ancestor walk must terminate and resolve
    // against the nearest real directory.
    await expect(
      resolveVolume("/definitely/not/a/real/path/on/any/machine"),
    ).resolves.toBe("/");
  });

  it("resolves an existing path", async () => {
    const volume = await resolveVolume(process.cwd());
    // This repo lives on an external volume on the dev machine and on "/" in
    // CI - either way the result must be a well-formed volume label.
    expect(volume === "/" || volume.startsWith("/Volumes/")).toBe(true);
  });
});

/** Deterministic resolver: /ext/** is on BOLT, everything else internal. */
const fakeResolve = async (p: string): Promise<string> =>
  p.startsWith("/ext/") ? "/Volumes/BOLT" : "/";

describe("computeVolumeBreakdown", () => {
  it("attributes each entry's size to its path's volume", async () => {
    const totals = await computeVolumeBreakdown(
      [
        { paths: ["/ext/cargo/registry"], size: 100 },
        { paths: ["/home/u/.npm"], size: 50 },
        { paths: ["/ext/bun/cache"], size: 25 },
      ],
      fakeResolve,
    );
    expect(totals).toEqual({ "/Volumes/BOLT": 125, "/": 50 });
  });

  it("splits a multi-path entry evenly across volumes", async () => {
    const totals = await computeVolumeBreakdown(
      [{ paths: ["/ext/a", "/home/b"], size: 100 }],
      fakeResolve,
    );
    expect(totals).toEqual({ "/Volumes/BOLT": 50, "/": 50 });
  });

  it("skips empty and zero-size entries", async () => {
    const totals = await computeVolumeBreakdown(
      [
        { paths: [], size: 100 },
        { paths: ["/ext/a"], size: 0 },
      ],
      fakeResolve,
    );
    expect(totals).toEqual({});
  });
});

describe("aggregateVolumeBreakdown", () => {
  it("uses a result's own volumeBreakdown when present", async () => {
    const resolve = vi.fn(fakeResolve);
    const totals = await aggregateVolumeBreakdown(
      [
        {
          success: true,
          sizeBefore: 100,
          sizeAfter: 0,
          clearedPaths: ["/home/u/.npm"],
          volumeBreakdown: { "/Volumes/BOLT": 100 },
        },
      ],
      false,
      resolve,
    );
    expect(totals).toEqual({ "/Volumes/BOLT": 100 });
    // The pre-computed breakdown wins; clearedPaths are not re-resolved.
    expect(resolve).not.toHaveBeenCalled();
  });

  it("falls back to clearedPaths for results without a breakdown", async () => {
    const totals = await aggregateVolumeBreakdown(
      [
        {
          success: true,
          sizeBefore: 80,
          sizeAfter: 0,
          clearedPaths: ["/ext/yarn-cache"],
        },
      ],
      false,
      fakeResolve,
    );
    expect(totals).toEqual({ "/Volumes/BOLT": 80 });
  });

  it("sums across results and skips failures and zero-freed", async () => {
    const totals = await aggregateVolumeBreakdown(
      [
        {
          success: true,
          sizeBefore: 100,
          sizeAfter: 0,
          clearedPaths: [],
          volumeBreakdown: { "/": 100 },
        },
        {
          success: true,
          sizeBefore: 40,
          sizeAfter: 0,
          clearedPaths: ["/ext/x"],
        },
        {
          success: false,
          sizeBefore: 999,
          sizeAfter: 0,
          clearedPaths: ["/ext/y"],
        },
        { success: true, sizeBefore: 0, sizeAfter: 0, clearedPaths: ["/z"] },
      ],
      false,
      fakeResolve,
    );
    expect(totals).toEqual({ "/": 100, "/Volumes/BOLT": 40 });
  });

  it("weights the clearedPaths fallback by per-path cached size", async () => {
    // A cleaner whose paths straddle volumes (symlinked store + local cache)
    // must attribute bytes where they actually were, not split them evenly.
    const sizeOf = async (p: string) => (p === "/ext/store" ? 900 : 100);
    const totals = await aggregateVolumeBreakdown(
      [
        {
          success: true,
          sizeBefore: 1000,
          sizeAfter: 0,
          clearedPaths: ["/ext/store", "/home/u/cache"],
        },
      ],
      false,
      fakeResolve,
      sizeOf,
    );
    expect(totals).toEqual({ "/Volumes/BOLT": 900, "/": 100 });
  });

  it("splits evenly when no path sizes are known", async () => {
    const sizeOf = async () => 0;
    const totals = await aggregateVolumeBreakdown(
      [
        {
          success: true,
          sizeBefore: 100,
          sizeAfter: 0,
          clearedPaths: ["/ext/a", "/home/b"],
        },
      ],
      false,
      fakeResolve,
      sizeOf,
    );
    expect(totals).toEqual({ "/Volumes/BOLT": 50, "/": 50 });
  });

  it("uses sizeBefore as freed under dry-run", async () => {
    const totals = await aggregateVolumeBreakdown(
      [
        {
          success: true,
          sizeBefore: 60,
          // Dry runs report sizeAfter === sizeBefore; freed must still be 60.
          sizeAfter: 60,
          clearedPaths: ["/ext/x"],
        },
      ],
      true,
      fakeResolve,
    );
    expect(totals).toEqual({ "/Volumes/BOLT": 60 });
  });
});

describe("volumeLabel", () => {
  it("labels the boot volume and keeps mounts verbatim", () => {
    expect(volumeLabel("/")).toBe("/ (internal)");
    expect(volumeLabel("/Volumes/BOLT")).toBe("/Volumes/BOLT");
  });
});

/** BaseCleaner wiring: clear() must ship a volumeBreakdown per category. */
class VolumeTestCleaner extends BaseCleaner {
  name = "volume-test";
  type: CacheType = "system";
  description = "test cleaner";

  constructor(private categories: CacheCategory[]) {
    super();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: this.categories.flatMap((c) => c.paths),
      isInstalled: true,
      size: 0,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    return this.categories;
  }
}

describe("BaseCleaner volumeBreakdown wiring", () => {
  it("clear() reports freed bytes grouped by volume", async () => {
    const fakePath = path.join("/no-such-root", "cache-a");
    const cleaner = new VolumeTestCleaner([
      {
        id: "a",
        name: "A",
        description: "cache a",
        paths: [fakePath],
        size: 128,
        priority: "normal",
        useCase: "development",
        safety: "safe",
      },
    ]);

    const result = await cleaner.clear(true);
    // Real resolver: the fake path ancestor-walks to the boot volume.
    expect(result.volumeBreakdown).toEqual({ "/": 128 });
  });
});
