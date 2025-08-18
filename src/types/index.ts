export interface CacheInfo {
  name: string;
  type: CacheType;
  description: string;
  paths: string[];
  isInstalled: boolean;
  size?: number;
  lastModified?: Date;
}

export type CacheType = 'package-manager' | 'build-tool' | 'browser' | 'ide' | 'system' | 'other';

export interface ClearResult {
  name: string;
  success: boolean;
  sizeBefore?: number;
  sizeAfter?: number;
  error?: string;
  clearedPaths: string[];
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
  
  // Specific tool preferences
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
  
  // Safety settings
  safety: {
    requireConfirmation: boolean;
    dryRunDefault: boolean;
    backupBeforeClearing: boolean;
    excludeSystemCritical: boolean;
  };
  
  // Custom paths
  customPaths: string[];
  
  // Output preferences
  output: {
    verbose: boolean;
    showSizes: boolean;
    useColors: boolean;
  };
}

export interface CleanerModule {
  name: string;
  type: CacheType;
  description: string;
  isAvailable: () => Promise<boolean>;
  getCacheInfo: () => Promise<CacheInfo>;
  clear: (dryRun?: boolean) => Promise<ClearResult>;
}

export interface CommandOptions {
  all?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  types?: string[];
  exclude?: string[];
  config?: boolean;
  sizes?: boolean;
}

export interface CacheSizeInfo {
  total: number;
  byType: Record<CacheType, number>;
  byTool: Record<string, number>;
}
