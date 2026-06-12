import { describe, it, expect } from "vitest";
import {
  normalizeHierarchy,
  resolveStoredHierarchy,
  formatHierarchy,
  isGroupAxis,
  DEFAULT_GROUP_HIERARCHY,
} from "../../utils/groupHierarchy";

describe("normalizeHierarchy", () => {
  it("parses a comma-list string into ordered axes", () => {
    expect(normalizeHierarchy("tier,kind,app")).toEqual([
      "tier",
      "kind",
      "app",
    ]);
  });

  it("accepts a single axis", () => {
    expect(normalizeHierarchy("tier")).toEqual(["tier"]);
  });

  it("treats none/blank/undefined as flat", () => {
    expect(normalizeHierarchy("none")).toEqual([]);
    expect(normalizeHierarchy("")).toEqual([]);
    expect(normalizeHierarchy(undefined)).toEqual([]);
  });

  it("dedupes and drops unknown axes, case-insensitively", () => {
    expect(normalizeHierarchy("App, TIER, app, bogus")).toEqual([
      "app",
      "tier",
    ]);
  });

  it("accepts an array", () => {
    expect(normalizeHierarchy(["kind", "app"])).toEqual(["kind", "app"]);
  });
});

describe("resolveStoredHierarchy", () => {
  it("uses the default when unset", () => {
    expect(resolveStoredHierarchy(undefined)).toEqual(DEFAULT_GROUP_HIERARCHY);
    expect(resolveStoredHierarchy(null)).toEqual(DEFAULT_GROUP_HIERARCHY);
  });

  it("honors an explicit flat ([]) choice rather than the default", () => {
    expect(resolveStoredHierarchy([])).toEqual([]);
  });

  it("coerces a legacy single-string value", () => {
    expect(resolveStoredHierarchy("app")).toEqual(["app"]);
  });
});

describe("formatHierarchy", () => {
  it("joins with arrows or says flat", () => {
    expect(formatHierarchy(["tier", "kind", "app"])).toBe("tier → kind → app");
    expect(formatHierarchy([])).toBe("flat (no grouping)");
  });
});

describe("isGroupAxis", () => {
  it("recognizes valid axes and rejects others", () => {
    expect(isGroupAxis("tier")).toBe(true);
    expect(isGroupAxis("app")).toBe(true);
    expect(isGroupAxis("none")).toBe(false);
    expect(isGroupAxis("bogus")).toBe(false);
  });
});
