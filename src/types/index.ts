// Safety classification for cache categories:
// - "safe": regenerable transparently; cleaning has no observable downside
// - "probably-safe": regenerable, but next launch may be slower or re-download
// - "caution": can lose useful state (offline content, long re-downloads) or
//   misbehave if the owning app is running
// - "manual": user-data adjacent; requires explicit per-item confirmation and
//   is never cleaned implicitly (not even with --force)
export type SafetyTier = "safe" | "probably-safe" | "caution" | "manual";

// How a multi-category cleaner's breakdown is grouped for display.
// - "app": collapse a single app's many cache dirs under one heading (appKey)
// - "tier": group by safety tier (safe/probably-safe/caution/manual)
// - "kind": group by cache kind (Cache/Code Cache/containers/library-caches...)
// - "none": flat list sorted by size
export type AppCacheGroupBy = "app" | "tier" | "kind" | "none";

// A single axis within a grouping hierarchy. "none" is not an axis - an empty
// hierarchy (`[]`) means a flat list. The display config stores an ordered
// list of these (e.g. ["tier","kind","app"]) for nested grouping.
export type AppCacheGroupAxis = "tier" | "kind" | "app";

// Cache category for granular control
export interface CacheCategory {
  id: string;
  name: string;
  description: string;
  paths: string[];
  size?: number;
  lastAccessed?: Date;
  lastModified?: Date;
  priority: "critical" | "important" | "normal" | "low";
  safety?: SafetyTier;
  useCase:
    | "development"
    | "testing"
    | "production"
    | "experimental"
    | "archived";
  isProjectSpecific?: boolean;
  projectPath?: string;
  ageInDays?: number;
  // Normalized, OS-neutral app identity (e.g. "com.spotify.client", "code").
  // Set by system-wide app-cache discovery so a single app's many cache dirs
  // can be grouped or excluded together regardless of platform layout.
  appKey?: string;
}

// Enhanced cache info with categories
export interface CacheInfo {
  name: string;
  type: CacheType;
  description: string;
  paths: string[];
  isInstalled: boolean;
  size?: number;
  lastModified?: Date;
  categories?: CacheCategory[];
  totalSize?: number;
  oldestCache?: Date;
  newestCache?: Date;
}

export type CacheType =
  | "package-manager"
  | "build-tool"
  | "browser"
  | "ide"
  | "system"
  | "other";

// Cache selection criteria
export interface CacheSelectionCriteria {
  olderThanDays?: number;
  newerThanDays?: number;
  largerThanMB?: number;
  smallerThanMB?: number;
  useCases?: Array<
    "development" | "testing" | "production" | "experimental" | "archived"
  >;
  priorities?: Array<"critical" | "important" | "normal" | "low">;
  projectSpecific?: boolean;
  categories?: string[];
  // Allowed safety tiers; categories outside these tiers are skipped.
  safetyTiers?: SafetyTier[];
  // Explicit per-category consent for "manual" tier categories. A manual
  // category is only cleaned when its id appears here - force flags do not
  // bypass this.
  allowManualIds?: string[];
}

// One row of a multi-category cleaner's per-category breakdown, captured while
// the cleaner sums category sizes so output can break a cleaner down without a
// second filesystem scan.
export interface CategoryBreakdownEntry {
  id: string;
  name: string;
  size: number;
  safety: SafetyTier;
  appKey?: string;
  ageInDays?: number;
}

export interface ClearResult {
  name: string;
  success: boolean;
  sizeBefore?: number;
  sizeAfter?: number;
  error?: string;
  clearedPaths: string[];
  clearedCategories?: string[];
  // Per-category detail for cleaners that expose categories (notably
  // app-caches). Only populated when there is more than one category, so
  // simple single-cache cleaners stay unaffected. Reuses sizes already
  // computed during clearing - no extra scan.
  categoryBreakdown?: CategoryBreakdownEntry[];
}

// Tool-specific granular settings
export interface ToolGranularSettings {
  enabled: boolean;
  categories?: {
    [categoryId: string]: {
      enabled: boolean;
      autoClean?: boolean;
      maxAge?: number; // days
      maxSize?: number; // MB
    };
  };
  defaultSelectionCriteria?: CacheSelectionCriteria;
  // Display preferences for cleaners that expose many categories (app-caches).
  // Purely presentational - never affects what is selected for cleaning.
  display?: {
    expand?: boolean; // expand the per-category tree by default (else summary)
    // Ordered grouping hierarchy, e.g. ["tier","kind","app"]. An empty array
    // means a flat list. Legacy single-string values are coerced on read.
    groupBy?: AppCacheGroupAxis[];
    topN?: number; // apps shown inline in the collapsed summary line
  };
  // appKey globs (e.g. "com.apple.*", "spotify") dropped from discovery before
  // sizing and tier logic. Orthogonal to the manual-consent gate: excluding an
  // app removes it entirely; it does not relax protection on anything kept.
  exclude?: string[];
}

export interface UserConfig {
  // Profile settings
  activeProfile?: string;

  // Protected paths that should never be cleaned
  protectedPaths?: string[];

  // Cache type preferences
  enabledCaches: {
    packageManagers: boolean;
    buildTools: boolean;
    browsers: boolean;
    ides: boolean;
    system: boolean;
  };

  // Specific tool preferences (backward compatible)
  tools: {
    // Package managers
    npm: boolean;
    yarn: boolean;
    pnpm: boolean;
    bun: boolean;
    pip: boolean;
    cargo: boolean;
    poetry: boolean;
    pipenv: boolean;
    cocoapods: boolean;
    swiftpm: boolean;
    nuget: boolean;
    brew: boolean;
    nix: boolean;

    // Build tools
    webpack: boolean;
    vite: boolean;
    nx: boolean;
    turbo: boolean;
    flutter: boolean;
    "node-gyp": boolean;
    "go-build": boolean;
    maven: boolean;
    playwright: boolean;

    // Browsers
    chrome: boolean;
    firefox: boolean;

    // IDEs
    vscode: boolean;
    xcode: boolean;
    androidstudio: boolean;
    jetbrains: boolean;
    windsurf: boolean;
    cursor: boolean;
    zed: boolean;

    // System tools
    docker: boolean;
    gradle: boolean;
    "universal-binary": boolean;
    // Optional so existing literal configs/profiles stay assignable; the
    // default config enables it.
    "app-caches"?: boolean;
  };

  // Granular tool settings (new)
  toolSettings?: {
    [toolName: string]: ToolGranularSettings;
  };

  // Global cache policies (new)
  cachePolicies?: {
    autoCleanOlderThan?: number; // days
    preserveRecentlyUsed?: number; // days
    preserveProjectSpecific?: boolean;
    preserveCriticalPriority?: boolean;
    defaultUseCase?:
      | "development"
      | "testing"
      | "production"
      | "experimental"
      | "archived";
  };

  // Safety settings
  safety: {
    requireConfirmation: boolean;
    dryRunDefault: boolean;
    backupBeforeClearing: boolean;
    excludeSystemCritical: boolean;
    preserveActiveDevelopment?: boolean; // new
    // Highest safety tier cleaned without per-item confirmation.
    // Derived from the active cleaning profile when unset.
    maxTier?: SafetyTier;
  };

  // Custom paths
  customPaths: string[];

  // Output preferences
  output: {
    verbose: boolean;
    showSizes: boolean;
    useColors: boolean;
    quiet?: boolean;
    format?: "json" | "text";
    showCategories?: boolean; // new
    showRecency?: boolean; // new
    emojis?: "on" | "off" | "minimal"; // emoji support
  };

  // Scheduling settings
  scheduler?: {
    enabled: boolean;
    schedule?: string; // cron expression
    lastRun?: string; // ISO date string
    nextRun?: string; // ISO date string
  };

  // Auto-update settings
  autoUpdate?: {
    enabled: boolean; // check for updates (default: true)
    checkIntervalHours?: number; // hours between checks (default: 24)
    lastCheck?: string; // ISO date string of last check
  };
}

export interface CleanerModule {
  name: string;
  type: CacheType;
  description: string;
  isAvailable: () => Promise<boolean>;
  getCacheInfo: () => Promise<CacheInfo>;
  getCacheCategories?: () => Promise<CacheCategory[]>;
  clear: (
    dryRun?: boolean,
    criteria?: CacheSelectionCriteria,
    cacheInfo?: CacheInfo,
    protectedPaths?: string[],
  ) => Promise<ClearResult>;
  clearByCategory?: (
    categoryIds: string[],
    dryRun?: boolean,
    cacheInfo?: CacheInfo,
    protectedPaths?: string[],
    allowManualIds?: string[],
  ) => Promise<ClearResult>;
}

export interface CommandOptions {
  all?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  types?: string[];
  exclude?: string[];
  include?: string[]; // Added missing include property
  subCaches?: string[]; // Added missing subCaches property
  // Granular selection options
  olderThan?: string; // e.g., "7d", "2w", "1m"
  newerThan?: string;
  largerThan?: string; // e.g., "100MB", "1GB"
  smallerThan?: string;
  useCase?: string; // development, testing, production, etc.
  priority?: string; // critical, important, normal, low
  categories?: string[]; // specific category IDs
  showCategories?: boolean; // show available categories
  groupBy?: string; // app-cache breakdown grouping: app|tier|kind|none
  config?: boolean;
  sizes?: boolean;
  // Safety / cleaning-profile options
  profile?: string; // conservative | balanced | aggressive
  safety?: string; // comma-separated safety tiers to include
  allowManual?: string[]; // category ids confirmed for manual-tier cleaning
}

export interface CacheSizeInfo {
  total: number;
  byType: Record<CacheType, number>;
  byTool: Record<string, number>;
}
