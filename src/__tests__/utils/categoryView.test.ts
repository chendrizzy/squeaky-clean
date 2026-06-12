import { describe, it, expect } from "vitest";
import {
  groupCategories,
  renderCategoryTree,
  summarizeAppCaches,
  tierBadge,
  CategoryViewItem,
} from "../../utils/categoryView";

const items: CategoryViewItem[] = [
  {
    id: "app-caches:library-caches/com.spotify.client",
    name: "Spotify Cache",
    size: 900_000_000,
    safety: "probably-safe",
    appKey: "com.spotify.client",
  },
  {
    id: "app-caches:library-caches/com.google.chrome",
    name: "Chrome Cache",
    size: 2_000_000_000,
    safety: "caution",
    appKey: "com.google.chrome",
  },
  {
    id: "app-caches:app-support/Code/Cache",
    name: "Code/Cache",
    size: 100_000_000,
    safety: "safe",
    appKey: "code",
  },
  {
    id: "app-caches:app-support/Code/Code Cache",
    name: "Code/Code Cache",
    size: 50_000_000,
    safety: "safe",
    appKey: "code",
  },
];

describe("groupCategories", () => {
  it("groups by app, collapsing one app's many caches together", () => {
    const groups = groupCategories(items, "app");
    const code = groups.find((g) => g.key === "code");
    expect(code).toBeDefined();
    expect(code!.items).toHaveLength(2);
    expect(code!.total).toBe(150_000_000);
  });

  it("groups by tier ordered safe -> probably-safe -> caution", () => {
    const groups = groupCategories(items, "tier");
    expect(groups.map((g) => g.key)).toEqual([
      "safe",
      "probably-safe",
      "caution",
    ]);
  });

  it("groups by kind from the id's first segment", () => {
    const groups = groupCategories(items, "kind");
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("library-caches");
    expect(keys).toContain("app-support");
  });

  it("none = a single bucket sorted by size, largest first", () => {
    const groups = groupCategories(items, "none");
    expect(groups).toHaveLength(1);
    expect(groups[0].items[0].size).toBe(2_000_000_000);
  });
});

describe("summarizeAppCaches", () => {
  it("reports total, cache count, app count, and the top-N apps", () => {
    const s = summarizeAppCaches(items, { topN: 2, useColor: false });
    expect(s).toContain("4 caches");
    // Code's two caches collapse to one app -> 3 distinct apps.
    expect(s).toContain("3 apps");
    expect(s).toMatch(/top: com\.google\.chrome/); // largest app first
    expect(s).toContain("(-v for all)");
  });

  it("includes an action verb when provided", () => {
    const s = summarizeAppCaches(items, {
      topN: 0,
      useColor: false,
      action: "would be freed",
    });
    expect(s).toContain("would be freed");
  });

  it("omits the verbose hint when verboseHint is false", () => {
    const s = summarizeAppCaches(items, {
      topN: 0,
      useColor: false,
      verboseHint: false,
    });
    expect(s).not.toContain("-v for all");
  });
});

describe("renderCategoryTree", () => {
  it("emits a header per group with a count, plus indented item rows", () => {
    const lines = renderCategoryTree(items, {
      groupBy: "app",
      useColor: false,
      emojiMode: "off",
    });
    const codeHeader = lines.find(
      (l) => l.startsWith("code ") && l.includes("(2)"),
    );
    expect(codeHeader).toBeDefined();
  });

  it("shows text tier badges under non-tier grouping", () => {
    const lines = renderCategoryTree(items, {
      groupBy: "app",
      useColor: false,
      emojiMode: "off",
    });
    expect(lines.some((l) => l.includes("[CAUTION]"))).toBe(true);
  });

  it("puts the tier badge on the header (not every row) under tier grouping", () => {
    const lines = renderCategoryTree(items, {
      groupBy: "tier",
      useColor: false,
      emojiMode: "off",
    });
    expect(lines.some((l) => l.startsWith("[SAFE]"))).toBe(true);
  });

  it("appends id sub-lines when showId is set", () => {
    const lines = renderCategoryTree(items, {
      groupBy: "none",
      useColor: false,
      emojiMode: "off",
      showId: true,
    });
    expect(
      lines.some((l) =>
        l.includes("app-caches:library-caches/com.spotify.client"),
      ),
    ).toBe(true);
  });

  it("returns no lines for empty input", () => {
    expect(
      renderCategoryTree([], {
        groupBy: "app",
        useColor: false,
        emojiMode: "off",
      }),
    ).toEqual([]);
  });
});

describe("renderCategoryTree hierarchy", () => {
  it("nests tier → app and drops the per-leaf badge when tier is a level", () => {
    const lines = renderCategoryTree(items, {
      groupBy: ["tier", "app"],
      useColor: false,
      emojiMode: "off",
    });
    // Top level: tier headers.
    expect(lines.some((l) => l.startsWith("[SAFE]"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[CAUTION]"))).toBe(true);
    // Second level: app sub-headers indented under their tier.
    expect(lines.some((l) => l.startsWith("  code "))).toBe(true);
    // Leaves indented further with NO tier badge (tier is already a header).
    const leaf = lines.find((l) => l.includes("Chrome Cache"));
    expect(leaf).toBeDefined();
    expect(leaf).not.toContain("[CAUTION]");
    expect(leaf?.startsWith("    ")).toBe(true);
  });

  it("a single-axis array matches the legacy single-string behavior", () => {
    const asArray = renderCategoryTree(items, {
      groupBy: ["app"],
      useColor: false,
      emojiMode: "off",
    });
    const asString = renderCategoryTree(items, {
      groupBy: "app",
      useColor: false,
      emojiMode: "off",
    });
    expect(asArray).toEqual(asString);
  });
});

describe("tierBadge", () => {
  it("uses the text label as the primary (color-independent) signal", () => {
    expect(tierBadge("manual", false)).toBe("[MANUAL]");
    expect(tierBadge("safe", false)).toBe("[SAFE]");
  });
});
