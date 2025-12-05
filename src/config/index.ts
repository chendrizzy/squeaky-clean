import { UserConfig } from "../types";
import fs from "fs";
import path from "path";
import os from "os";

export const defaultConfig: UserConfig = {
  enabledCaches: {
    packageManagers: true,
    buildTools: true,
    browsers: false, // More conservative default
    ides: false, // More conservative default
    system: false, // More conservative default
  },

  tools: {
    // Package managers
    npm: true,
    yarn: true,
    pnpm: true,
    bun: true,
    pip: true,
    cargo: true, // Rust cargo caches can be 5-50GB
    poetry: true, // Python Poetry caches
    pipenv: true, // Python Pipenv caches
    cocoapods: true, // CocoaPods caches (macOS)
    swiftpm: true, // Swift Package Manager caches (macOS)
    nuget: true, // .NET NuGet caches can be 6-100GB
    brew: true, // Homebrew caches (macOS)
    nix: true, // Nix package manager caches

    // Build tools
    webpack: true,
    vite: true,
    nx: true,
    turbo: true,
    flutter: true,
    "node-gyp": true, // Node native addon build caches
    "go-build": true, // Go build caches
    maven: true,
    playwright: true, // Playwright browser binaries can be 1-2GB

    // Browsers
    chrome: false, // More conservative - browser caches can affect user experience
    firefox: false,

    // IDEs
    vscode: true,
    xcode: true, // Xcode can accumulate huge caches
    androidstudio: true,
    jetbrains: false, // More conservative for JetBrains IDEs
    windsurf: true, // Windsurf IDE (Codeium) caches
    cursor: true, // Cursor AI IDE caches
    zed: true, // Zed editor caches

    // System tools
    docker: false, // More conservative - Docker cleanup affects containers
    gradle: true,
    "universal-binary": false, // More conservative - modifies application binaries
  },

  safety: {
    requireConfirmation: true,
    dryRunDefault: false,
    backupBeforeClearing: false,
    excludeSystemCritical: true,
  },

  customPaths: [],
  protectedPaths: [], // New property

  output: {
    verbose: false,
    showSizes: true,
    useColors: true,
    emojis: "on",
  },
};

// Simple file-based config store (replaces 'conf' package)
function getConfigDir(): string {
  const platform = process.platform;
  const homeDir = os.homedir();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "squeaky-clean");
  } else if (platform === "darwin") {
    return path.join(homeDir, "Library", "Preferences", "squeaky-clean");
  } else {
    // Linux/Unix - follow XDG spec
    return path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "squeaky-clean");
  }
}

function ensureConfigDir(configDir: string): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

class ConfigManager {
  private store: UserConfig;
  private configPath: string;
  private customConfig: UserConfig | null = null;
  private customConfigPath: string | null = null;

  constructor() {
    const configDir = getConfigDir();
    this.configPath = path.join(configDir, "config.json");
    this.store = this.loadStore();
  }

  private loadStore(): UserConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return this.deepMerge(defaultConfig, parsed);
      }
    } catch {
      // Corrupted config - use defaults
    }
    return { ...defaultConfig };
  }

  private saveStore(): void {
    try {
      ensureConfigDir(path.dirname(this.configPath));
      fs.writeFileSync(this.configPath, JSON.stringify(this.store, null, 2));
    } catch {
      // Ignore write errors (e.g., in tests or sandboxed environments)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deepMerge(base: any, override: any): any {
    if (!override || typeof override !== "object") return base;
    if (Array.isArray(override)) return override;
    const result = { ...base };
    for (const key of Object.keys(override)) {
      const val = override[key];
      if (val !== undefined && val !== null && typeof val === "object" && !Array.isArray(val)) {
        result[key] = this.deepMerge(base[key] || {}, val);
      } else if (val !== undefined) {
        result[key] = val;
      }
    }
    return result;
  }

  loadCustomConfig(configPath: string): void {
    try {
      const resolvedPath = path.resolve(configPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Config file not found: ${resolvedPath}`);
      }

      const configContent = fs.readFileSync(resolvedPath, "utf-8");
      this.customConfig = JSON.parse(configContent);
      this.customConfigPath = resolvedPath;
    } catch (error) {
      throw new Error(`Failed to load config from ${configPath}: ${error}`);
    }
  }

  get(): UserConfig {
    // If custom config is loaded, return it instead of the default
    if (this.customConfig) {
      return this.customConfig;
    }
    return this.store;
  }

  set(config: Partial<UserConfig>): void {
    if (this.customConfig) {
      // Update custom config in memory (but don't save to file)
      this.customConfig = { ...this.customConfig, ...config };
    } else {
      this.store = this.deepMerge(this.store, config);
      this.saveStore();
    }
  }

  reset(): void {
    if (this.customConfig) {
      this.customConfig = null;
      this.customConfigPath = null;
    } else {
      this.store = { ...defaultConfig };
      try {
        if (fs.existsSync(this.configPath)) {
          fs.unlinkSync(this.configPath);
        }
      } catch {
        // Ignore errors during reset
      }
    }
  }

  getConfigPath(): string {
    if (this.customConfigPath) {
      return this.customConfigPath;
    }
    return this.configPath;
  }

  // Specific getters for convenience
  isToolEnabled(tool: keyof UserConfig["tools"]): boolean {
    const config = this.get();
    return config.tools?.[tool] ?? defaultConfig.tools[tool];
  }

  isCacheTypeEnabled(type: keyof UserConfig["enabledCaches"]): boolean {
    const config = this.get();
    return config.enabledCaches?.[type] ?? defaultConfig.enabledCaches[type];
  }

  shouldRequireConfirmation(): boolean {
    const config = this.get();
    return (
      config.safety?.requireConfirmation ??
      defaultConfig.safety.requireConfirmation
    );
  }

  shouldUseDryRunDefault(): boolean {
    const config = this.get();
    return config.safety?.dryRunDefault ?? defaultConfig.safety.dryRunDefault;
  }

  shouldShowSizes(): boolean {
    const config = this.get();
    return config.output?.showSizes ?? defaultConfig.output.showSizes;
  }

  shouldUseColors(): boolean {
    const config = this.get();
    return config.output?.useColors ?? defaultConfig.output.useColors;
  }

  isVerbose(): boolean {
    const config = this.get();
    return config.output?.verbose ?? defaultConfig.output.verbose;
  }

  getEmojiMode(): "on" | "off" | "minimal" {
    const config = this.get();
    const output = config.output as any;
    return output?.emojis ?? defaultConfig.output.emojis;
  }

  getCustomPaths(): string[] {
    const config = this.get();
    return config.customPaths ?? defaultConfig.customPaths;
  }

  getProtectedPaths(): string[] {
    const config = this.get();
    return config.protectedPaths ?? [];
  }

  /**
   * Check if fun mode is enabled via environment variable.
   * SQUEAKY_FUN_MODE=1 enables, SQUEAKY_FUN_MODE=0 disables.
   */
  isFunModeEnabled(): boolean {
    const envValue = process.env.SQUEAKY_FUN_MODE;
    if (envValue === "0") return false;
    if (envValue === "1") return true;
    // Default to true if not explicitly set
    return true;
  }
}

export const config = new ConfigManager();
export { ConfigManager };
