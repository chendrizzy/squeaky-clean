import Conf from "conf";
import { UserConfig } from "../types";
import fs from "fs";
import path from "path";

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
    pip: true, // Python pip caches are generally safe to clear

    // Build tools
    webpack: true,
    vite: true,
    nx: true,
    turbo: true,
    flutter: true, // Flutter caches are safe and can be large

    // Browsers
    chrome: false, // More conservative - browser caches can affect user experience
    firefox: false,

    // IDEs
    vscode: true, // VS Code caches are generally safe to clear
    xcode: true, // Xcode can accumulate huge caches
    androidstudio: true, // Android Studio caches are safe and can be large
    jetbrains: false, // More conservative for JetBrains IDEs

    // System tools
    docker: false, // More conservative - Docker cleanup affects containers
    gradle: true, // Gradle caches are safe and can be large
    maven: true, // Maven caches are safe and can be large
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

class ConfigManager {
  private conf: Conf<UserConfig>;
  private customConfig: UserConfig | null = null;
  private customConfigPath: string | null = null;

  constructor() {
    this.conf = new Conf<UserConfig>({
      projectName: "squeaky-clean",
      projectVersion: "1.0.0",
      defaults: defaultConfig,
      schema: {
        enabledCaches: {
          type: "object",
          properties: {
            packageManagers: { type: "boolean" },
            buildTools: { type: "boolean" },
            browsers: { type: "boolean" },
            ides: { type: "boolean" },
            system: { type: "boolean" },
          },
        },
        tools: {
          type: "object",
          properties: {
            // Package managers
            npm: { type: "boolean" },
            yarn: { type: "boolean" },
            pnpm: { type: "boolean" },
            bun: { type: "boolean" },
            pip: { type: "boolean" },

            // Build tools
            webpack: { type: "boolean" },
            vite: { type: "boolean" },
            nx: { type: "boolean" },
            turbo: { type: "boolean" },
            flutter: { type: "boolean" },

            // Browsers
            chrome: { type: "boolean" },
            firefox: { type: "boolean" },

            // IDEs
            vscode: { type: "boolean" },
            xcode: { type: "boolean" },
            androidstudio: { type: "boolean" },
            jetbrains: { type: "boolean" },

            // System tools
            docker: { type: "boolean" },
            gradle: { type: "boolean" },
            maven: { type: "boolean" },
          },
        },
        safety: {
          type: "object",
          properties: {
            requireConfirmation: { type: "boolean" },
            dryRunDefault: { type: "boolean" },
            backupBeforeClearing: { type: "boolean" },
            excludeSystemCritical: { type: "boolean" },
          },
        },
        customPaths: {
          type: "array",
          items: { type: "string" },
        },
        protectedPaths: {
          // New property
          type: "array",
          items: { type: "string" },
        },
        output: {
          type: "object",
          properties: {
            verbose: { type: "boolean" },
            showSizes: { type: "boolean" },
            useColors: { type: "boolean" },
            emojis: { type: "string", enum: ["on", "off", "minimal"] },
          },
        },
      },
    });
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
    return this.conf.store;
  }

  set(config: Partial<UserConfig>): void {
    if (this.customConfig) {
      // Update custom config in memory (but don't save to file)
      this.customConfig = { ...this.customConfig, ...config };
    } else {
      this.conf.set(config);
    }
  }

  reset(): void {
    if (this.customConfig) {
      this.customConfig = null;
      this.customConfigPath = null;
    } else {
      this.conf.clear();
    }
  }

  getConfigPath(): string {
    if (this.customConfigPath) {
      return this.customConfigPath;
    }
    return this.conf.path;
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
