import { describe, expect, it } from "vitest";
import { BaseCleaner } from "../../cleaners/BaseCleaner";
import { effectiveSafety } from "../../safety";
import { CacheCategory, CacheInfo, CacheType, SafetyTier } from "../../types";

function makeCategory(
  id: string,
  safety: SafetyTier | undefined,
  priority: CacheCategory["priority"] = "normal",
): CacheCategory {
  return {
    id,
    name: id,
    description: `category ${id}`,
    paths: [`/home/testuser/fake/${id}`],
    size: 1024,
    priority,
    safety,
    useCase: "development",
  };
}

class StubCleaner extends BaseCleaner {
  name = "stub";
  type: CacheType = "system";
  description = "stub cleaner for safety gate tests";

  constructor(private readonly categories: CacheCategory[]) {
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
      categories: this.categories,
    };
  }

  async getCacheCategories(): Promise<CacheCategory[]> {
    return this.categories;
  }
}

const SAFE_ID = "stub:safe";
const MANUAL_ID = "stub:manual";

function makeCleaner(): StubCleaner {
  return new StubCleaner([
    makeCategory(SAFE_ID, "safe"),
    makeCategory(MANUAL_ID, "manual"),
  ]);
}

describe("BaseCleaner manual-tier safety gate", () => {
  describe("clear()", () => {
    it("skips manual categories when criteria is undefined", async () => {
      const result = await makeCleaner().clear(false, undefined);

      expect(result.success).toBe(true);
      expect(result.clearedCategories).toContain(SAFE_ID);
      expect(result.clearedCategories).not.toContain(MANUAL_ID);
    });

    it("skips manual categories with empty criteria", async () => {
      const result = await makeCleaner().clear(false, {});

      expect(result.clearedCategories).toContain(SAFE_ID);
      expect(result.clearedCategories).not.toContain(MANUAL_ID);
    });

    it("includes manual categories with explicit allowManualIds consent", async () => {
      const result = await makeCleaner().clear(false, {
        allowManualIds: [MANUAL_ID],
      });

      expect(result.clearedCategories).toContain(SAFE_ID);
      expect(result.clearedCategories).toContain(MANUAL_ID);
    });

    it("does not unlock manual categories for consent to a different id", async () => {
      const result = await makeCleaner().clear(false, {
        allowManualIds: ["some-other-id"],
      });

      expect(result.clearedCategories).not.toContain(MANUAL_ID);
    });

    it("force-style invocation does not unlock manual categories", async () => {
      // A --force/--yes style run supplies every tier but never per-id
      // consent. If the manual gate in filterCategories were deleted, the
      // "manual" entry in safetyTiers would let MANUAL_ID through here.
      const allTiersNoConsent = await makeCleaner().clear(false, {
        safetyTiers: ["safe", "probably-safe", "caution", "manual"],
        allowManualIds: undefined,
      });

      expect(allTiersNoConsent.clearedCategories).toContain(SAFE_ID);
      expect(allTiersNoConsent.clearedCategories).not.toContain(MANUAL_ID);

      // An explicitly empty consent list must behave identically: empty is
      // not consent, so the manual category stays locked.
      const emptyConsent = await makeCleaner().clear(false, {
        allowManualIds: [],
      });

      expect(emptyConsent.clearedCategories).toContain(SAFE_ID);
      expect(emptyConsent.clearedCategories).not.toContain(MANUAL_ID);
    });
  });

  describe("clearByCategory()", () => {
    it("skips manual categories without allowManualIds even when selected by id", async () => {
      const result = await makeCleaner().clearByCategory(
        [SAFE_ID, MANUAL_ID],
        true,
      );

      expect(result.clearedCategories).toContain(SAFE_ID);
      expect(result.clearedCategories).not.toContain(MANUAL_ID);
    });

    it("includes manual categories when the allowManualIds param lists them", async () => {
      const result = await makeCleaner().clearByCategory(
        [SAFE_ID, MANUAL_ID],
        true,
        undefined,
        undefined,
        [MANUAL_ID],
      );

      expect(result.clearedCategories).toContain(SAFE_ID);
      expect(result.clearedCategories).toContain(MANUAL_ID);
    });
  });

  describe("safetyTiers filtering", () => {
    it("excludes tiers not listed in criteria.safetyTiers", async () => {
      const cleaner = new StubCleaner([
        makeCategory("stub:safe", "safe"),
        makeCategory("stub:probably", "probably-safe"),
        makeCategory("stub:caution", "caution"),
      ]);

      const result = await cleaner.clear(true, { safetyTiers: ["safe"] });

      expect(result.clearedCategories).toEqual(["stub:safe"]);
    });

    it("allows multiple listed tiers", async () => {
      const cleaner = new StubCleaner([
        makeCategory("stub:safe", "safe"),
        makeCategory("stub:probably", "probably-safe"),
        makeCategory("stub:caution", "caution"),
      ]);

      const result = await cleaner.clear(true, {
        safetyTiers: ["safe", "probably-safe"],
      });

      expect(result.clearedCategories).toContain("stub:safe");
      expect(result.clearedCategories).toContain("stub:probably");
      expect(result.clearedCategories).not.toContain("stub:caution");
    });
  });

  describe("effectiveSafety derivation", () => {
    it("derives caution from critical priority", () => {
      expect(effectiveSafety(makeCategory("c", undefined, "critical"))).toBe(
        "caution",
      );
    });

    it("derives safe from low priority", () => {
      expect(effectiveSafety(makeCategory("l", undefined, "low"))).toBe("safe");
    });

    it("derives probably-safe from normal priority", () => {
      expect(effectiveSafety(makeCategory("n", undefined, "normal"))).toBe(
        "probably-safe",
      );
    });

    it("derives probably-safe from important priority", () => {
      expect(effectiveSafety(makeCategory("i", undefined, "important"))).toBe(
        "probably-safe",
      );
    });

    it("explicit safety wins over priority derivation", () => {
      expect(effectiveSafety(makeCategory("e", "safe", "critical"))).toBe(
        "safe",
      );
      expect(effectiveSafety(makeCategory("m", "manual", "low"))).toBe(
        "manual",
      );
    });
  });
});
