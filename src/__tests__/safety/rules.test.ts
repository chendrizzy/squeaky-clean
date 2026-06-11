import { describe, expect, it, vi } from "vitest";
import * as os from "os";
import {
  classifyCachePath,
  getDiscoveryRoots,
  RuleVerdict,
} from "../../safety/rules";

const H = "/home/testuser";

describe("classifyCachePath", () => {
  const expectVerdict = (p: string, verdict: RuleVerdict): void => {
    expect(classifyCachePath(p).verdict, p).toBe(verdict);
  };

  describe("never (excluded entirely)", () => {
    const neverPaths = [
      `${H}/Library/Caches/com.apple.bird`,
      `${H}/Library/Caches/CloudKit`,
      `${H}/Library/Caches/com.apple.cloudkit.launchservices`,
      `${H}/Library/Caches/com.apple.Mail`,
      `${H}/Library/Caches/com.apple.MobileSync`,
      `${H}/Library/Caches/com.docker.docker`,
      `${H}/Library/Caches/com.apple.Photos`,
      `${H}/Library/Caches/com.apple.photolibraryd`,
      `${H}/Pictures/Photos Library.photoslibrary/resources`,
      `${H}/Library/Caches/1Password`,
      `${H}/Library/Application Support/Bitwarden/Cache`,
      `${H}/Library/Caches/KeePassXC`,
      `${H}/Library/Keychains`,
      `${H}/Library/Application Support/Signal`,
      `${H}/Library/Caches/com.apple.securityd`,
      `${H}/Library/Caches/CloudDocs`,
    ];

    for (const p of neverPaths) {
      it(`classifies ${p} as never`, () => expectVerdict(p, "never"));
    }
  });

  describe("claimed (covered by existing cleaners)", () => {
    const claimedPaths = [
      `${H}/Library/Caches/Homebrew`,
      `${H}/Library/Caches/Homebrew/downloads`,
      `${H}/Library/Caches/portable-ruby`,
      `${H}/Library/Caches/npm`,
      `${H}/Library/Caches/Yarn`,
      `${H}/.cache/bun`,
      `${H}/Library/Caches/pip`,
      `${H}/Library/Caches/pipenv`,
      `${H}/Library/Caches/node-gyp`,
      `${H}/Library/Caches/go-build`,
      `${H}/Library/Caches/org.swift.swiftpm`,
      `${H}/Library/Caches/CocoaPods`,
      `${H}/Library/Caches/turborepo`,
      `${H}/Library/Caches/ms-playwright`,
      `${H}/Library/Application Support/Google/Chrome`,
      `${H}/.cache/mozilla/firefox`,
      `${H}/Library/Caches/Firefox`,
      `${H}/Library/Caches/com.microsoft.VSCode`,
      `${H}/Library/Caches/com.vscodium.VSCodium`,
      `${H}/Library/Caches/com.todesktop.230313mzl4w4u92`,
      `${H}/Library/Caches/com.exafunction.windsurf`,
      `${H}/Library/Caches/com.google.antigravity`,
      `${H}/Library/Caches/dev.zed.Zed`,
      `${H}/Library/Caches/JetBrains`,
      `${H}/Library/Caches/AndroidStudio2024.1`,
      `${H}/Library/Caches/com.apple.dt.Xcode`,
      `${H}/Library/Caches/com.google.Chrome.ShipIt`,
      `${H}/Library/Caches/com.google.Keystone.agent`,
    ];

    for (const p of claimedPaths) {
      it(`classifies ${p} as claimed`, () => expectVerdict(p, "claimed"));
    }

    it("does NOT claim claude-cli (no existing cleaner covers it)", () => {
      expectVerdict(`${H}/Library/Caches/claude-cli-nodejs`, "probably-safe");
    });
  });

  describe("manual (per-item confirmation required)", () => {
    const manualPaths = [
      `${H}/.cache/huggingface`,
      `${H}/.cache/torch`,
      `${H}/.cache/whisper`,
      `${H}/.cache/suno`,
      `${H}/.cache/modelscope`,
      `${H}/Library/Caches/ollama`,
      `${H}/Library/Caches/com.spotify.client/PersistentCache`,
    ];

    for (const p of manualPaths) {
      it(`classifies ${p} as manual`, () => expectVerdict(p, "manual"));
    }
  });

  describe("Spotify rule requires exact segment match", () => {
    it("does NOT mark spotify-ui-widgets/PersistentCache as manual", () => {
      // "spotify" appears only as a substring of another app's directory
      // name; the rule must not pull unrelated apps into the manual tier.
      expectVerdict(
        `${H}/Library/Caches/spotify-ui-widgets/PersistentCache`,
        "probably-safe",
      );
    });

    it("does NOT mark my-spotify-backup/PersistentCache as manual", () => {
      expectVerdict(
        `${H}/Library/Caches/my-spotify-backup/PersistentCache`,
        "probably-safe",
      );
    });

    it("marks Application Support/Spotify/PersistentCache as manual", () => {
      expectVerdict(
        `${H}/Library/Application Support/Spotify/PersistentCache`,
        "manual",
      );
    });

    it("marks com.spotify.client/persistentcache as manual", () => {
      expectVerdict(
        `${H}/Library/Caches/com.spotify.client/persistentcache`,
        "manual",
      );
    });
  });

  describe("caution", () => {
    const cautionPaths = [
      `${H}/Library/Caches/com.apple.helpd`,
      `${H}/Library/Caches/com.apple.GeoServices`,
      `${H}/Library/Caches/Arc`,
      `${H}/Library/Caches/company.thebrowser.Browser`,
      `${H}/Library/Application Support/Slack/Cache`,
      `${H}/Library/Application Support/discord/Cache`,
      `${H}/Library/Application Support/Microsoft Teams/Cache`,
      `${H}/Library/Caches/Skype`,
      `${H}/Library/Caches/zoom.us`,
      `${H}/.cache/uv`,
    ];

    for (const p of cautionPaths) {
      it(`classifies ${p} as caution`, () => expectVerdict(p, "caution"));
    }

    it("caution outranks safe (Slack/GPUCache stays caution)", () => {
      expectVerdict(
        `${H}/Library/Application Support/Slack/GPUCache`,
        "caution",
      );
    });
  });

  describe("safe", () => {
    const safePaths = [
      `${H}/Library/Application Support/SomeApp/GPUCache`,
      `${H}/Library/Application Support/SomeApp/Code Cache`,
      `${H}/Library/Application Support/SomeApp/ShaderCache`,
      `${H}/Library/Application Support/SomeApp/GrShaderCache`,
      `${H}/Library/Application Support/SomeApp/DawnCache`,
      `${H}/Library/Application Support/SomeApp/DawnGraphiteCache`,
      `${H}/Library/Application Support/SomeApp/CachedData`,
      `${H}/Library/Application Support/Caches/someapp-updater`,
      `${H}/Library/Application Support/Caches/com.foo.bar.update`,
      `${H}/.cache/thumbnails`,
      `${H}/.thumbnails`,
      `${H}/.cache/fontconfig`,
      `${H}/.cache/mesa_shader_cache`,
    ];

    for (const p of safePaths) {
      it(`classifies ${p} as safe`, () => expectVerdict(p, "safe"));
    }

    it("does not treat blob_storage as safe", () => {
      expectVerdict(
        `${H}/Library/Application Support/SomeApp/blob_storage`,
        "probably-safe",
      );
    });
  });

  describe("probably-safe defaults", () => {
    const probablySafePaths = [
      `${H}/Library/Caches/com.randomvendor.coolapp`,
      `${H}/Library/Logs/CoolApp`,
      `${H}/.cache/some-random-tool`,
    ];

    for (const p of probablySafePaths) {
      it(`classifies ${p} as probably-safe`, () =>
        expectVerdict(p, "probably-safe"));
    }
  });

  describe("rule priority ordering", () => {
    it("never outranks the com.apple.* caution catch-all", () => {
      expectVerdict(`${H}/Library/Caches/com.apple.Photos`, "never");
    });

    it("claimed outranks the com.apple.* caution catch-all", () => {
      expectVerdict(`${H}/Library/Caches/com.apple.dt.Xcode`, "claimed");
    });

    it("classification is case-insensitive", () => {
      expectVerdict(`${H}/LIBRARY/CACHES/HOMEBREW`, "claimed");
      expectVerdict(`${H}/library/caches/COM.APPLE.BIRD`, "never");
    });
  });

  it("returns a non-empty reason for every verdict", () => {
    const samples = [
      `${H}/Library/Caches/com.apple.bird`,
      `${H}/Library/Caches/Homebrew`,
      `${H}/.cache/huggingface`,
      `${H}/Library/Caches/com.apple.helpd`,
      `${H}/Library/Application Support/SomeApp/GPUCache`,
      `${H}/Library/Caches/com.randomvendor.coolapp`,
    ];
    for (const p of samples) {
      expect(classifyCachePath(p).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("getDiscoveryRoots", () => {
  it("returns macOS roots under the mocked home directory", () => {
    // Global test setup mocks os.platform() -> darwin, os.homedir() -> H
    const roots = getDiscoveryRoots();

    expect(roots).toContain(`${H}/Library/Caches`);
    expect(roots).toContain(`${H}/Library/Application Support/Caches`);
    expect(roots).toContain(`${H}/Library/Application Support`);
    expect(roots).toContain(`${H}/Library/Logs`);
    expect(roots).toContain(`${H}/.cache`);
  });

  it("drops relative roots when os.homedir() is empty", () => {
    // A stripped-env / service account can yield an empty home; path.join then
    // produces relative roots like "Library/Caches" that must not be returned.
    vi.mocked(os.homedir).mockReturnValueOnce("");

    const roots = getDiscoveryRoots();

    expect(roots).toEqual([]);
    expect(roots.every((r) => r.startsWith("/"))).toBe(true);
  });
});
