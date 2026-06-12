import { describe, it, expect } from "vitest";
import {
  appKeyForRelId,
  matchesExclude,
} from "../../cleaners/appCacheDiscovery";

describe("appKeyForRelId", () => {
  it("extracts and slugs the app segment from per-app relIds", () => {
    expect(appKeyForRelId("library-caches/com.spotify.client")).toBe(
      "com.spotify.client",
    );
    expect(appKeyForRelId("xdg-config/Code/Cache")).toBe("code");
    expect(appKeyForRelId("containers/com.apple.Safari")).toBe(
      "com.apple.safari",
    );
    expect(appKeyForRelId("flatpak/com.spotify.Client/cache")).toBe(
      "com.spotify.client",
    );
  });

  it("falls back to the whole relId for single-segment roots", () => {
    expect(appKeyForRelId("local-temp")).toBe("local-temp");
  });

  it("resolves the same app to the same key across OS layouts (cross-platform invariant)", () => {
    // The same exclude pattern must work whether Spotify is found under macOS
    // containers or Linux flatpak.
    expect(appKeyForRelId("containers/com.spotify.client")).toBe(
      appKeyForRelId("flatpak/com.spotify.client/cache"),
    );
  });
});

describe("matchesExclude", () => {
  it("matches glob patterns", () => {
    expect(matchesExclude("com.apple.safari", ["com.apple.*"])).toBe(true);
    expect(matchesExclude("com.google.chrome", ["com.apple.*"])).toBe(false);
  });

  it("matches plain patterns as a case-insensitive substring", () => {
    expect(matchesExclude("com.spotify.client", ["spotify"])).toBe(true);
    expect(matchesExclude("com.spotify.client", ["Spotify"])).toBe(true);
  });

  it("matches exactly", () => {
    expect(matchesExclude("code", ["code"])).toBe(true);
  });

  it("ignores blank patterns and returns false when nothing matches", () => {
    expect(matchesExclude("com.foo.bar", ["", "   "])).toBe(false);
    expect(matchesExclude("com.foo.bar", ["baz"])).toBe(false);
  });
});
