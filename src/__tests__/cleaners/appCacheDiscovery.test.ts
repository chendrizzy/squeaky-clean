import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import * as os from "os";
import { AppCacheDiscoveryCleaner } from "../../cleaners/appCacheDiscovery";
import { getCachedDirectorySize } from "../../utils/fs";

// Keep the real fs helpers (memfs-backed via global setup) but stub sizing
// so tests never shell out to `du`.
vi.mock("../../utils/fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/fs")>();
  return {
    ...actual,
    getCachedDirectorySize: vi.fn(async () => 1024),
  };
});

const H = "/home/testuser";

const EXPECTED_IDS = {
  randomApp: "app-caches:library-caches/com.randomvendor.coolapp",
  slackCache: "app-caches:app-support/slack/cache",
  gpuCache: "app-caches:app-support/someapp/gpucache",
  updater: "app-caches:app-support-caches/someapp-updater",
  huggingface: "app-caches:dot-cache/huggingface",
} as const;

function buildFixture(): void {
  vol.fromJSON({
    // claimed - must never surface
    [`${H}/Library/Caches/npm/cache-entry`]: "x",
    // never - must never surface
    [`${H}/Library/Caches/com.apple.bird/state`]: "x",
    // probably-safe default under Library/Caches
    [`${H}/Library/Caches/com.randomvendor.coolapp/blob`]: "x",
    // caution: chat app cache under Application Support
    [`${H}/Library/Application Support/Slack/Cache/f`]: "x",
    // safe: GPU cache under an Application Support app dir
    [`${H}/Library/Application Support/SomeApp/GPUCache/f`]: "x",
    // safe: electron updater dir under Application Support/Caches
    [`${H}/Library/Application Support/Caches/someapp-updater/f`]: "x",
    // manual: ML model store under ~/.cache
    [`${H}/.cache/huggingface/model.bin`]: "x",
  });
}

describe("AppCacheDiscoveryCleaner", () => {
  beforeEach(() => {
    buildFixture();
    vi.mocked(getCachedDirectorySize).mockResolvedValue(1024);
  });

  describe("basic properties", () => {
    it("has the expected name, type, and description", () => {
      const cleaner = new AppCacheDiscoveryCleaner();
      expect(cleaner.name).toBe("app-caches");
      expect(cleaner.type).toBe("system");
      expect(cleaner.description).toContain("safety classification");
    });
  });

  describe("isAvailable", () => {
    it("is available when a discovery root exists", async () => {
      expect(await new AppCacheDiscoveryCleaner().isAvailable()).toBe(true);
    });

    it("is unavailable when no discovery root exists", async () => {
      vol.reset();
      expect(await new AppCacheDiscoveryCleaner().isAvailable()).toBe(false);
    });
  });

  describe("discovery", () => {
    it("returns exactly the expected categories with stable slug ids", async () => {
      const categories =
        await new AppCacheDiscoveryCleaner().getCacheCategories();
      const ids = categories.map((c) => c.id).sort();

      expect(ids).toEqual(Object.values(EXPECTED_IDS).sort());
    });

    it("never surfaces claimed or never-verdict directories", async () => {
      const categories =
        await new AppCacheDiscoveryCleaner().getCacheCategories();
      const blob = JSON.stringify(categories);

      expect(blob).not.toContain("npm");
      expect(blob).not.toContain("com.apple.bird");
    });

    it("assigns the right safety tier to each category", async () => {
      const categories =
        await new AppCacheDiscoveryCleaner().getCacheCategories();
      const byId = new Map(categories.map((c) => [c.id, c]));

      expect(byId.get(EXPECTED_IDS.randomApp)?.safety).toBe("probably-safe");
      expect(byId.get(EXPECTED_IDS.slackCache)?.safety).toBe("caution");
      expect(byId.get(EXPECTED_IDS.gpuCache)?.safety).toBe("safe");
      expect(byId.get(EXPECTED_IDS.updater)?.safety).toBe("safe");
      expect(byId.get(EXPECTED_IDS.huggingface)?.safety).toBe("manual");
    });

    it("produces lowercase filesystem-derived ids and reproducible results", async () => {
      const first = await new AppCacheDiscoveryCleaner().getCacheCategories();
      const second = await new AppCacheDiscoveryCleaner().getCacheCategories();

      for (const category of first) {
        expect(category.id).toMatch(/^app-caches:[a-z0-9._/-]+$/);
        expect(category.id).toBe(category.id.toLowerCase());
      }
      expect(first.map((c) => c.id).sort()).toEqual(
        second.map((c) => c.id).sort(),
      );
    });

    it("includes path and rule reason in the category description", async () => {
      const categories =
        await new AppCacheDiscoveryCleaner().getCacheCategories();
      const slack = categories.find((c) => c.id === EXPECTED_IDS.slackCache);

      expect(slack?.paths).toEqual([
        `${H}/Library/Application Support/Slack/Cache`,
      ]);
      expect(slack?.description).toContain(
        `${H}/Library/Application Support/Slack/Cache`,
      );
      expect(slack?.description.length).toBeGreaterThan(slack!.paths[0].length);
    });

    it("caches discovery on the instance within the TTL", async () => {
      const cleaner = new AppCacheDiscoveryCleaner();
      const first = await cleaner.getCacheCategories();

      // New directory appears after the first scan - cached result reused.
      vol.fromJSON({ [`${H}/Library/Caches/late-arrival/f`]: "x" });
      const second = await cleaner.getCacheCategories();

      expect(second.map((c) => c.id).sort()).toEqual(
        first.map((c) => c.id).sort(),
      );

      // A fresh instance sees the new directory.
      const fresh = await new AppCacheDiscoveryCleaner().getCacheCategories();
      expect(fresh.map((c) => c.id)).toContain(
        "app-caches:library-caches/late-arrival",
      );
    });
  });

  describe("getCacheInfo", () => {
    it("aggregates categories, paths, and sizes", async () => {
      const info = await new AppCacheDiscoveryCleaner().getCacheInfo();

      expect(info.name).toBe("app-caches");
      expect(info.type).toBe("system");
      expect(info.isInstalled).toBe(true);
      expect(info.categories).toHaveLength(5);
      expect(info.paths).toHaveLength(5);
      expect(info.size).toBe(5 * 1024);
    });
  });

  describe("clear (inherited gated implementation)", () => {
    it("only includes safe categories with safetyTiers: [safe]", async () => {
      const result = await new AppCacheDiscoveryCleaner().clear(true, {
        safetyTiers: ["safe"],
      });

      expect(result.success).toBe(true);
      expect(result.clearedCategories?.sort()).toEqual(
        [EXPECTED_IDS.gpuCache, EXPECTED_IDS.updater].sort(),
      );
    });

    it("skips manual categories without explicit consent", async () => {
      const result = await new AppCacheDiscoveryCleaner().clear(true, {});

      expect(result.clearedCategories).not.toContain(EXPECTED_IDS.huggingface);
      expect(result.clearedCategories).toContain(EXPECTED_IDS.randomApp);
    });

    it("includes manual categories only with allowManualIds consent", async () => {
      const result = await new AppCacheDiscoveryCleaner().clear(true, {
        allowManualIds: [EXPECTED_IDS.huggingface],
      });

      expect(result.clearedCategories).toContain(EXPECTED_IDS.huggingface);
    });
  });

  describe("linux discovery (xdg-config, flatpak, snap)", () => {
    beforeEach(() => {
      vi.mocked(os.platform).mockReturnValue("linux");
      vol.fromJSON({
        // ~/.config Electron/Chromium app caches (not under ~/.cache)
        [`${H}/.config/SomeChatApp/Cache/f`]: "x",
        [`${H}/.config/SomeChatApp/GPUCache/f`]: "x",
        // Flatpak per-app cache: ~/.var/app/<id>/cache
        [`${H}/.var/app/com.example.App/cache/f`]: "x",
        // Snap per-app cache: ~/snap/<name>/current/.cache
        [`${H}/snap/somesnap/current/.cache/f`]: "x",
      });
    });

    afterEach(() => {
      // Restore the default platform; clearAllMocks keeps mockReturnValue.
      vi.mocked(os.platform).mockReturnValue("darwin");
    });

    it("discovers ~/.config child caches, Flatpak, and Snap caches", async () => {
      const ids = (
        await new AppCacheDiscoveryCleaner().getCacheCategories()
      ).map((c) => c.id);

      expect(ids).toContain("app-caches:xdg-config/somechatapp/gpucache");
      expect(ids).toContain("app-caches:flatpak/com.example.app/cache");
      expect(ids).toContain("app-caches:snap/somesnap/current/.cache");
    });
  });
});
