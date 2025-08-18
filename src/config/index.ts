import Conf from 'conf';
import { UserConfig } from '../types';

export const defaultConfig: UserConfig = {
  enabledCaches: {
    packageManagers: true,
    buildTools: true,
    browsers: false, // More conservative default
    ides: false,     // More conservative default
    system: false,   // More conservative default
  },
  
  tools: {
    // Package managers
    npm: true,
    yarn: true,
    pnpm: true,
    bun: true,
    pip: true,      // Python pip caches are generally safe to clear
    
    // Build tools
    webpack: true,
    vite: true,
    nx: true,
    turbo: true,
    flutter: true,  // Flutter caches are safe and can be large
    
    // Browsers
    chrome: false,  // More conservative - browser caches can affect user experience
    firefox: false,
    
    // IDEs
    vscode: true,       // VS Code caches are generally safe to clear
    xcode: true,        // Xcode can accumulate huge caches
    androidstudio: true, // Android Studio caches are safe and can be large
    jetbrains: false,   // More conservative for JetBrains IDEs
    
    // System tools
    docker: false,  // More conservative - Docker cleanup affects containers
    gradle: true,   // Gradle caches are safe and can be large
    maven: true,    // Maven caches are safe and can be large
  },
  
  safety: {
    requireConfirmation: true,
    dryRunDefault: false,
    backupBeforeClearing: false,
    excludeSystemCritical: true,
  },
  
  customPaths: [],
  
  output: {
    verbose: false,
    showSizes: true,
    useColors: true,
  },
};

class ConfigManager {
  private conf: Conf<UserConfig>;

  constructor() {
    this.conf = new Conf<UserConfig>({
      projectName: 'squeaky-clean',
      projectVersion: '1.0.0',
      defaults: defaultConfig,
      schema: {
        enabledCaches: {
          type: 'object',
          properties: {
            packageManagers: { type: 'boolean' },
            buildTools: { type: 'boolean' },
            browsers: { type: 'boolean' },
            ides: { type: 'boolean' },
            system: { type: 'boolean' },
          },
        },
        tools: {
          type: 'object',
          properties: {
            // Package managers
            npm: { type: 'boolean' },
            yarn: { type: 'boolean' },
            pnpm: { type: 'boolean' },
            bun: { type: 'boolean' },
            pip: { type: 'boolean' },
            
            // Build tools
            webpack: { type: 'boolean' },
            vite: { type: 'boolean' },
            nx: { type: 'boolean' },
            turbo: { type: 'boolean' },
            flutter: { type: 'boolean' },
            
            // Browsers
            chrome: { type: 'boolean' },
            firefox: { type: 'boolean' },
            
            // IDEs
            vscode: { type: 'boolean' },
            xcode: { type: 'boolean' },
            androidstudio: { type: 'boolean' },
            jetbrains: { type: 'boolean' },
            
            // System tools
            docker: { type: 'boolean' },
            gradle: { type: 'boolean' },
            maven: { type: 'boolean' },
          },
        },
        safety: {
          type: 'object',
          properties: {
            requireConfirmation: { type: 'boolean' },
            dryRunDefault: { type: 'boolean' },
            backupBeforeClearing: { type: 'boolean' },
            excludeSystemCritical: { type: 'boolean' },
          },
        },
        customPaths: {
          type: 'array',
          items: { type: 'string' },
        },
        output: {
          type: 'object',
          properties: {
            verbose: { type: 'boolean' },
            showSizes: { type: 'boolean' },
            useColors: { type: 'boolean' },
          },
        },
      },
    });
  }

  get(): UserConfig {
    return this.conf.store;
  }

  set(config: Partial<UserConfig>): void {
    this.conf.set(config);
  }

  reset(): void {
    this.conf.clear();
  }

  getConfigPath(): string {
    return this.conf.path;
  }

  // Specific getters for convenience
  isToolEnabled(tool: keyof UserConfig['tools']): boolean {
    return this.conf.get(`tools.${tool}`, defaultConfig.tools[tool]);
  }

  isCacheTypeEnabled(type: keyof UserConfig['enabledCaches']): boolean {
    return this.conf.get(`enabledCaches.${type}`, defaultConfig.enabledCaches[type]);
  }

  shouldRequireConfirmation(): boolean {
    return this.conf.get('safety.requireConfirmation', defaultConfig.safety.requireConfirmation);
  }

  shouldUseDryRunDefault(): boolean {
    return this.conf.get('safety.dryRunDefault', defaultConfig.safety.dryRunDefault);
  }

  shouldShowSizes(): boolean {
    return this.conf.get('output.showSizes', defaultConfig.output.showSizes);
  }

  shouldUseColors(): boolean {
    return this.conf.get('output.useColors', defaultConfig.output.useColors);
  }

  isVerbose(): boolean {
    return this.conf.get('output.verbose', defaultConfig.output.verbose);
  }

  getCustomPaths(): string[] {
    return this.conf.get('customPaths', defaultConfig.customPaths);
  }
}

export const config = new ConfigManager();
export { ConfigManager };
