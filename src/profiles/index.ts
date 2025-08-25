import { UserConfig } from '../types';

/**
 * User profile definition
 */
export interface UserProfile {
  id: string;
  name: string;
  description: string;
  icon?: string;
  config: Partial<UserConfig>;
  recommendedCleaners: string[];
  autoCleanSchedule?: string; // cron expression
}

/**
 * Predefined user profiles for different workflows
 */
export const profiles: Map<string, UserProfile> = new Map([
  ['developer', {
    id: 'developer',
    name: 'Developer',
    description: 'Optimized for software development workflows',
    icon: '👨‍💻',
    config: {
      enabledCaches: {
        packageManagers: true,
        buildTools: true,
        browsers: false,
        ides: true,
        system: false,
      },
      tools: {
        npm: true,
        yarn: true,
        pnpm: true,
        bun: true,
        pip: true,
        webpack: true,
        vite: true,
        nx: true,
        turbo: true,
        flutter: true,
        chrome: false,
        firefox: false,
        vscode: true,
        xcode: true,
        androidstudio: true,
        jetbrains: true,
        docker: true,
        gradle: true,
        maven: true,
      },
      cachePolicies: {
        autoCleanOlderThan: 30,
        preserveRecentlyUsed: 7,
        preserveProjectSpecific: true,
        preserveCriticalPriority: true,
        defaultUseCase: 'development',
      },
    },
    recommendedCleaners: [
      'npm', 'yarn', 'pnpm', 'pip', 'gradle', 'maven',
      'vscode', 'jetbrains', 'docker', 'node-gyp', 'go-build'
    ],
    autoCleanSchedule: '0 0 * * 0', // Weekly on Sunday
  }],
  
  ['content-creator', {
    id: 'content-creator',
    name: 'Content Creator',
    description: 'Optimized for video editing and streaming',
    icon: '🎬',
    config: {
      enabledCaches: {
        packageManagers: false,
        buildTools: false,
        browsers: true,
        ides: false,
        system: true,
      },
      tools: {
        npm: false,
        yarn: false,
        pnpm: false,
        bun: false,
        pip: false,
        webpack: false,
        vite: false,
        nx: false,
        turbo: false,
        flutter: false,
        chrome: true,
        firefox: true,
        vscode: false,
        xcode: false,
        androidstudio: false,
        jetbrains: false,
        docker: false,
        gradle: false,
        maven: false,
      },
    },
    recommendedCleaners: [
      'adobe-creative-cloud', 'final-cut', 'davinci-resolve',
      'obs', 'chrome', 'firefox', 'zoom', 'discord'
    ],
    autoCleanSchedule: '0 0 * * 1,4', // Monday and Thursday
  }],
  
  ['photographer', {
    id: 'photographer',
    name: 'Photographer',
    description: 'Optimized for photo editing workflows',
    icon: '📸',
    config: {
      enabledCaches: {
        packageManagers: false,
        buildTools: false,
        browsers: true,
        ides: false,
        system: true,
      },
    },
    recommendedCleaners: [
      'adobe-lightroom', 'adobe-photoshop', 'capture-one',
      'affinity-photo', 'chrome', 'firefox'
    ],
    autoCleanSchedule: '0 0 * * 0', // Weekly
  }],
  
  ['musician', {
    id: 'musician',
    name: 'Musician',
    description: 'Optimized for music production',
    icon: '🎵',
    config: {
      enabledCaches: {
        packageManagers: false,
        buildTools: false,
        browsers: false,
        ides: false,
        system: true,
      },
    },
    recommendedCleaners: [
      'ableton', 'logic-pro', 'pro-tools', 'fl-studio',
      'native-instruments', 'vst-cache'
    ],
    autoCleanSchedule: '0 0 * * 0', // Weekly
  }],
  
  ['general', {
    id: 'general',
    name: 'General User',
    description: 'Balanced settings for general use',
    icon: '🏠',
    config: {
      enabledCaches: {
        packageManagers: false,
        buildTools: false,
        browsers: true,
        ides: false,
        system: true,
      },
      tools: {
        npm: false,
        yarn: false,
        pnpm: false,
        bun: false,
        pip: false,
        webpack: false,
        vite: false,
        nx: false,
        turbo: false,
        flutter: false,
        chrome: true,
        firefox: true,
        vscode: false,
        xcode: false,
        androidstudio: false,
        jetbrains: false,
        docker: false,
        gradle: false,
        maven: false,
      },
      cachePolicies: {
        autoCleanOlderThan: 60,
        preserveRecentlyUsed: 14,
        preserveProjectSpecific: false,
        preserveCriticalPriority: true,
        defaultUseCase: 'production',
      },
    },
    recommendedCleaners: [
      'chrome', 'firefox', 'macos-cache', 'windows-temp',
      'downloads-old', 'trash'
    ],
    autoCleanSchedule: '0 0 * * 0', // Weekly
  }],
  
  ['power-user', {
    id: 'power-user',
    name: 'Power User',
    description: 'Comprehensive cleaning for experienced users',
    icon: '⚡',
    config: {
      enabledCaches: {
        packageManagers: true,
        buildTools: true,
        browsers: true,
        ides: true,
        system: true,
      },
      cachePolicies: {
        autoCleanOlderThan: 14,
        preserveRecentlyUsed: 3,
        preserveProjectSpecific: true,
        preserveCriticalPriority: false,
        defaultUseCase: 'experimental',
      },
      safety: {
        requireConfirmation: false,
        dryRunDefault: false,
        backupBeforeClearing: true,
        excludeSystemCritical: false,
      },
    },
    recommendedCleaners: ['*'], // All cleaners
    autoCleanSchedule: '0 0 * * *', // Daily
  }],
]);

/**
 * Profile manager for handling user profiles
 */
export class ProfileManager {
  private activeProfile: UserProfile | null = null;
  
  /**
   * Get a profile by ID
   */
  getProfile(id: string): UserProfile | undefined {
    return profiles.get(id);
  }
  
  /**
   * Get all available profiles
   */
  getAllProfiles(): UserProfile[] {
    return Array.from(profiles.values());
  }
  
  /**
   * Set the active profile
   */
  setActiveProfile(id: string): boolean {
    const profile = this.getProfile(id);
    if (profile) {
      this.activeProfile = profile;
      return true;
    }
    return false;
  }
  
  /**
   * Get the active profile
   */
  getActiveProfile(): UserProfile | null {
    return this.activeProfile;
  }
  
  /**
   * Apply a profile's configuration
   */
  applyProfile(id: string): Partial<UserConfig> | null {
    const profile = this.getProfile(id);
    if (profile) {
      this.activeProfile = profile;
      return profile.config;
    }
    return null;
  }
  
  /**
   * Create a custom profile
   */
  createCustomProfile(profile: UserProfile): void {
    profiles.set(profile.id, profile);
  }
  
  /**
   * Remove a profile
   */
  removeProfile(id: string): boolean {
    // Don't allow removing default profiles
    const defaultProfiles = [
      'developer', 'content-creator', 'photographer',
      'musician', 'general', 'power-user'
    ];
    
    if (defaultProfiles.includes(id)) {
      return false;
    }
    
    return profiles.delete(id);
  }
  
  /**
   * Export profile as JSON
   */
  exportProfile(id: string): string | null {
    const profile = this.getProfile(id);
    if (profile) {
      return JSON.stringify(profile, null, 2);
    }
    return null;
  }
  
  /**
   * Import profile from JSON
   */
  importProfile(json: string): boolean {
    try {
      const profile = JSON.parse(json) as UserProfile;
      if (profile.id && profile.name && profile.config) {
        this.createCustomProfile(profile);
        return true;
      }
    } catch (error) {
      console.error('Failed to import profile:', error);
    }
    return false;
  }
}

export const profileManager = new ProfileManager();