import * as os from "os";
import * as path from "path";
import { SafetyTier } from "../types";

/**
 * Verdict for a discovered cache path. Beyond the four user-facing safety
 * tiers, the rule engine can also exclude paths entirely:
 * - "never": not a cache (or user-data adjacent enough that deleting it can
 *   destroy data). Never shown, never cleaned.
 * - "claimed": already covered by a dedicated cleaner module; excluded from
 *   discovery to avoid double-counting and double-cleaning.
 */
export type RuleVerdict = SafetyTier | "never" | "claimed";

export interface RuleMatch {
  verdict: RuleVerdict;
  reason: string;
}

interface PathContext {
  /** Normalized full path: forward slashes, lowercase. */
  full: string;
  /** Lowercase path segments. */
  segments: string[];
  /** Lowercase basename (last segment). */
  base: string;
}

type RulePredicate = (ctx: PathContext) => boolean;

interface ClassificationRule {
  /** A RegExp is tested against every path segment; predicates get the
   * full context (segments, basename, normalized full path). */
  test: RegExp | RulePredicate;
  verdict: RuleVerdict;
  reason: string;
}

/** Predicate factory: basename matches. */
const base =
  (re: RegExp): RulePredicate =>
  (ctx) =>
    re.test(ctx.base);

/** Predicate factory: normalized full path matches. */
const full =
  (re: RegExp): RulePredicate =>
  (ctx) =>
    re.test(ctx.full);

/**
 * Ordered, first-match-wins classification rules. Priority:
 * never > claimed > manual > caution > safe; anything unmatched falls
 * through to the "probably-safe" default in classifyCachePath().
 */
const RULES: ClassificationRule[] = [
  // ---------------------------------------------------------------- never
  {
    test: /^com\.apple\.bird$/i,
    verdict: "never",
    reason: "iCloud Drive daemon state; deleting can corrupt iCloud sync",
  },
  {
    test: /^cloudkit$/i,
    verdict: "never",
    reason: "CloudKit sync state; deleting can corrupt iCloud sync",
  },
  {
    test: /^com\.apple\.cloudkit/i,
    verdict: "never",
    reason: "CloudKit daemon state; deleting can corrupt iCloud sync",
  },
  {
    test: /^com\.apple\.mail/i,
    verdict: "never",
    reason: "Mail attachments and message index; user-data adjacent",
  },
  {
    test: /^com\.apple\.mobilesync/i,
    verdict: "never",
    reason: "Device backups (MobileSync); deleting destroys backups",
  },
  {
    test: /^com\.docker\.docker$/i,
    verdict: "never",
    reason: "Docker VM disk image; not a cache",
  },
  {
    test: /^com\.apple\.photolibraryd/i,
    verdict: "never",
    reason: "Photos library daemon state; user-data adjacent",
  },
  {
    test: /^com\.apple\.photos/i,
    verdict: "never",
    reason: "Photos app state; user-data adjacent",
  },
  {
    test: full(/\.photoslibrary(\/|$)/i),
    verdict: "never",
    reason: "Inside a Photos library bundle; user data",
  },
  {
    test: /1password/i,
    verdict: "never",
    reason: "Password manager data; never touched",
  },
  {
    test: /bitwarden/i,
    verdict: "never",
    reason: "Password manager data; never touched",
  },
  {
    test: /keepass/i,
    verdict: "never",
    reason: "Password manager data; never touched",
  },
  {
    test: /^keychains$/i,
    verdict: "never",
    reason: "Keychain storage; never touched",
  },
  {
    test: /^signal$/i,
    verdict: "never",
    reason: "Signal messenger data; messages are user data",
  },
  {
    test: /^com\.apple\.security/i,
    verdict: "never",
    reason: "Security daemon state; never touched",
  },
  {
    test: /^clouddocs$/i,
    verdict: "never",
    reason: "iCloud Documents sync state; deleting can corrupt sync",
  },

  // -------------------------------------------------------------- claimed
  {
    test: /^homebrew$/i,
    verdict: "claimed",
    reason: "Covered by the brew cleaner",
  },
  {
    test: /^portable-ruby$/i,
    verdict: "claimed",
    reason: "Covered by the brew cleaner",
  },
  {
    test: /^cask$/i,
    verdict: "claimed",
    reason: "Covered by the brew cleaner",
  },
  {
    test: /^\.?npm$/i,
    verdict: "claimed",
    reason: "Covered by the npm cleaner",
  },
  {
    test: /^\.?yarn$/i,
    verdict: "claimed",
    reason: "Covered by the yarn cleaner",
  },
  {
    test: /^\.?bun$/i,
    verdict: "claimed",
    reason: "Covered by the bun cleaner",
  },
  {
    test: /^pip$/i,
    verdict: "claimed",
    reason: "Covered by the pip cleaner",
  },
  {
    test: /^pip-tools$/i,
    verdict: "claimed",
    reason: "Covered by the pip cleaner",
  },
  {
    test: /^pipenv$/i,
    verdict: "claimed",
    reason: "Covered by the pipenv cleaner",
  },
  {
    test: /^node-gyp$/i,
    verdict: "claimed",
    reason: "Covered by the node-gyp cleaner",
  },
  {
    test: /^go-build$/i,
    verdict: "claimed",
    reason: "Covered by the go-build cleaner",
  },
  {
    test: /^org\.swift\.swiftpm$/i,
    verdict: "claimed",
    reason: "Covered by the swiftpm cleaner",
  },
  {
    test: /^cocoapods$/i,
    verdict: "claimed",
    reason: "Covered by the cocoapods cleaner",
  },
  {
    test: /^turborepo$/i,
    verdict: "claimed",
    reason: "Covered by the turbo cleaner",
  },
  {
    test: /^ms-playwright/i,
    verdict: "claimed",
    reason: "Covered by the playwright cleaner",
  },
  {
    test: full(/\/google\/chrome(\/|$)/i),
    verdict: "claimed",
    reason: "Covered by the chrome cleaner",
  },
  {
    test: full(/\/mozilla\/firefox(\/|$)/i),
    verdict: "claimed",
    reason: "Covered by the firefox cleaner",
  },
  {
    test: /^firefox$/i,
    verdict: "claimed",
    reason: "Covered by the firefox cleaner",
  },
  {
    test: /^com\.microsoft\.vscode/i,
    verdict: "claimed",
    reason: "Covered by the vscode cleaner",
  },
  {
    test: /^com\.vscodium/i,
    verdict: "claimed",
    reason: "Covered by the vscode cleaner",
  },
  {
    test: /^com\.todesktop\./i,
    verdict: "claimed",
    reason: "Covered by the cursor cleaner",
  },
  {
    test: /^com\.exafunction\.windsurf/i,
    verdict: "claimed",
    reason: "Covered by the windsurf cleaner",
  },
  {
    test: /^com\.google\.antigravity/i,
    verdict: "claimed",
    reason: "Covered by an existing IDE cleaner",
  },
  {
    test: /^dev\.zed\.zed/i,
    verdict: "claimed",
    reason: "Covered by the zed cleaner",
  },
  {
    test: /^jetbrains$/i,
    verdict: "claimed",
    reason: "Covered by the jetbrains cleaner",
  },
  {
    test: /^androidstudio/i,
    verdict: "claimed",
    reason: "Covered by the androidstudio cleaner",
  },
  {
    test: /^com\.apple\.dt\./i,
    verdict: "claimed",
    reason: "Covered by the xcode cleaner",
  },
  {
    test: /\.shipit$/i,
    verdict: "claimed",
    reason: "Covered by the shipit cleaner",
  },
  {
    test: /keystone/i,
    verdict: "claimed",
    reason: "Covered by the shipit cleaner (Google Keystone)",
  },

  // --------------------------------------------------------------- manual
  {
    test: /^huggingface$/i,
    verdict: "manual",
    reason: "ML model store; regenerable but re-downloads can exceed 100GB",
  },
  {
    test: /^torch$/i,
    verdict: "manual",
    reason: "ML model store; regenerable but re-downloads can exceed 100GB",
  },
  {
    test: /^whisper$/i,
    verdict: "manual",
    reason: "ML model store; regenerable but re-downloads can exceed 100GB",
  },
  {
    test: /^suno$/i,
    verdict: "manual",
    reason: "ML model store; regenerable but re-downloads can exceed 100GB",
  },
  {
    test: /^modelscope$/i,
    verdict: "manual",
    reason: "ML model store; regenerable but re-downloads can exceed 100GB",
  },
  {
    test: /^ollama$/i,
    verdict: "manual",
    reason: "ML model store; regenerable but re-downloads can exceed 100GB",
  },
  {
    // Exact segment match: "spotify-ui-widgets" or "my-spotify-backup"
    // must NOT be pulled into the manual tier.
    test: (ctx) =>
      ctx.segments.some(
        (s) => s === "spotify" || s === "com.spotify.client",
      ) && ctx.segments.some((s) => s === "persistentcache"),
    verdict: "manual",
    reason: "Spotify PersistentCache; offline downloads may live here",
  },

  // -------------------------------------------------------------- caution
  {
    test: /^com\.apple\./i,
    verdict: "caution",
    reason: "Apple system daemon cache; long-running daemons may misbehave",
  },
  {
    test: /^arc$/i,
    verdict: "caution",
    reason: "Browser cache; risky while the browser is running",
  },
  {
    test: /^company\.thebrowser\./i,
    verdict: "caution",
    reason: "Browser cache; risky while the browser is running",
  },
  {
    test: /^dia$/i,
    verdict: "caution",
    reason: "Browser cache; risky while the browser is running",
  },
  {
    test: /^slack$/i,
    verdict: "caution",
    reason: "Chat/meeting app cache; risky while the app is running",
  },
  {
    test: /^discord$/i,
    verdict: "caution",
    reason: "Chat/meeting app cache; risky while the app is running",
  },
  {
    test: /^microsoft teams$/i,
    verdict: "caution",
    reason: "Chat/meeting app cache; risky while the app is running",
  },
  {
    test: /^teams$/i,
    verdict: "caution",
    reason: "Chat/meeting app cache; risky while the app is running",
  },
  {
    test: /^skype$/i,
    verdict: "caution",
    reason: "Chat/meeting app cache; risky while the app is running",
  },
  {
    test: /^zoom\.us$/i,
    verdict: "caution",
    reason: "Chat/meeting app cache; risky while the app is running",
  },
  {
    test: /^uv$/i,
    verdict: "caution",
    reason:
      "uv package cache; 80GB-class re-downloads, prefer `uv cache clean`",
  },

  // ----------------------------------------------------------------- safe
  {
    test: base(
      /^(gpucache|code cache|shadercache|grshadercache|dawncache|dawngraphitecache|cacheddata)$/i,
    ),
    verdict: "safe",
    reason: "GPU/shader/code cache; regenerated transparently",
  },
  {
    test: (ctx) =>
      ctx.full.includes("/application support/caches/") &&
      /(-updater|\.update)$/i.test(ctx.base),
    verdict: "safe",
    reason: "Electron updater staging directory; regenerated transparently",
  },
  {
    test: base(/^\.?thumbnails$/i),
    verdict: "safe",
    reason: "Thumbnail cache; regenerated transparently",
  },
  {
    test: base(/^fontconfig$/i),
    verdict: "safe",
    reason: "Font cache; regenerated transparently",
  },
  {
    test: base(/^mesa_shader_cache$/i),
    verdict: "safe",
    reason: "Shader cache; regenerated transparently",
  },
];

/**
 * Classify a discovered cache directory. First-match-wins over the ordered
 * rule list; unmatched paths default to "probably-safe" because every
 * discovery root is a platform cache/log location whose contents apps must
 * tolerate losing (Apple's Caches API contract, XDG cache spec).
 */
export function classifyCachePath(absolutePath: string): RuleMatch {
  const normalized = absolutePath.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const ctx: PathContext = {
    full: normalized,
    segments,
    base: segments[segments.length - 1] ?? "",
  };

  for (const rule of RULES) {
    const test = rule.test;
    const matched =
      test instanceof RegExp
        ? segments.some((segment) => test.test(segment))
        : test(ctx);
    if (matched) {
      return { verdict: rule.verdict, reason: rule.reason };
    }
  }

  if (ctx.full.includes("/library/logs/")) {
    return {
      verdict: "probably-safe",
      reason: "Log directory; regenerable, apps recreate logs as needed",
    };
  }
  return {
    verdict: "probably-safe",
    reason:
      "App cache; apps must tolerate cache deletion, next launch may rebuild",
  };
}

/**
 * Top-level discovery roots for the current platform. Computed at call time
 * so os.homedir()/env mocks and changes are respected.
 */
export function getDiscoveryRoots(): string[] {
  const home = os.homedir();
  let roots: string[];
  switch (os.platform()) {
    case "darwin":
      roots = [
        path.join(home, "Library", "Caches"),
        path.join(home, "Library", "Application Support", "Caches"),
        path.join(home, "Library", "Application Support"),
        path.join(home, "Library", "Logs"),
        path.join(home, ".cache"),
      ];
      break;
    case "win32": {
      const local =
        process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
      const roaming =
        process.env.APPDATA || path.join(home, "AppData", "Roaming");
      roots = [local, roaming];
      break;
    }
    default:
      roots = [process.env.XDG_CACHE_HOME || path.join(home, ".cache")];
  }

  // Drop any relative root. An empty os.homedir() (stripped env in some CI or
  // service accounts) would otherwise yield paths like "Library/Caches" that
  // resolve against the current working directory.
  return roots.filter((root) => path.isAbsolute(root));
}
