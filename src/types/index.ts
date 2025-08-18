// Cache category for granular control
export interface CacheCategory {
  id: string;
  name: string;
  description: string;
  paths: string[];
  size?: number;
  lastAccessed?: Date;
  lastModified?: Date;
  priority: 'critical' | 'important' | 'normal' | 'low';
  useCase: 'development' | 'testing' | 'production' | 'experimental' | 'archived';
  isProjectSpecific?: boolean;
  projectPath?: string;
  ageInDays?: number;
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

export type CacheType = 'package-manager' | 'build-tool' | 'browser' | 'ide' | 'system' | 'other';

// Cache selection criteria
export interface CacheSelectionCriteria {
  olderThanDays?: number;
  newerThanDays?: number;
  largerThanMB?: number;
  smallerThanMB?: number;
  useCases?: Array<'development' | 'testing' | 'production' | 'experimental' | 'archived'>;
  priorities?: Array<'critical' | 'important' | 'normal' | 'low'>;
  projectSpecific?: boolean;
  categories?: string[];
}

export interface ClearResult {
  name: string;
  success: boolean;
  sizeBefore?: number;
  sizeAfter?: number;
  error?: string;
  clearedPaths: string[];
  clearedCategories?: string[];
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
}

export interface UserConfig {
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
    
    // Build tools
    webpack: boolean;
    vite: boolean;
    nx: boolean;
    turbo: boolean;
    flutter: boolean;
    
    // Browsers
    chrome: boolean;
    firefox: boolean;
    
    // IDEs
    vscode: boolean;
    xcode: boolean;
    androidstudio: boolean;
    jetbrains: boolean;
    
    // System tools
    docker: boolean;
    gradle: boolean;
    maven: boolean;
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
    defaultUseCase?: 'development' | 'testing' | 'production' | 'experimental' | 'archived';
  };
  
  // Safety settings
  safety: {
    requireConfirmation: boolean;
    dryRunDefault: boolean;
    backupBeforeClearing: boolean;
    excludeSystemCritical: boolean;
    preserveActiveDevelopment?: boolean; // new
  };
  
  // Custom paths
  customPaths: string[];
  
  // Output preferences
  output: {
    verbose: boolean;
    showSizes: boolean;
    useColors: boolean;
    quiet?: boolean;
    format?: 'json' | 'text';
    showCategories?: boolean; // new
    showRecency?: boolean; // new
  };
}

export interface CleanerModule {
  name: string;
  type: CacheType;
  description: string;
  isAvailable: () => Promise<boolean>;
  getCacheInfo: () => Promise<CacheInfo>;
  getCacheCategories?: () => Promise<CacheCategory[]>;
  clear: (dryRun?: boolean, criteria?: CacheSelectionCriteria) => Promise<ClearResult>;
  clearByCategory?: (categoryIds: string[], dryRun?: boolean) => Promise<ClearResult>;
}

export interface CommandOptions {
  all?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  types?: string[];
  exclude?: string[];
  // Granular selection options
  olderThan?: string; // e.g., "7d", "2w", "1m"
  newerThan?: string;
  largerThan?: string; // e.g., "100MB", "1GB"
  smallerThan?: string;
  useCase?: string; // development, testing, production, etc.
  priority?: string; // critical, important, normal, low
  categories?: string[]; // specific category IDs
  showCategories?: boolean; // show available categories
  config?: boolean;
  sizes?: boolean;
}

export interface CacheSizeInfo {
  total: number;
  byType: Record<CacheType, number>;
  byTool: Record<string, number>;
}
