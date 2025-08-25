import { CleanerModule, CacheInfo, ClearResult } from '../types';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathExists, getDirectorySize, safeRmrf } from '../utils/fs';
import { printVerbose, symbols } from '../utils/cli';
import minimatch from 'minimatch';

export class AndroidStudioCleaner implements CleanerModule {
  name = 'androidstudio';
  type = 'ide' as const;
  description = 'Android Studio IDE caches, build files, and gradle wrapper';

  private async findAndroidStudioInstallation(): Promise<string | null> {
    const platform = os.platform();
    
    if (platform === 'darwin') {
      // macOS
      const macPaths = [
        '/Applications/Android Studio.app',
        '/Applications/Android Studio Preview.app',
      ];
      
      for (const appPath of macPaths) {
        if (await pathExists(appPath)) {
          return appPath;
        }
      }
    } else if (platform === 'win32') {
      // Windows
      const windowsPaths = [
        'C:\\Program Files\\Android\\Android Studio',
        'C:\\Program Files (x86)\\Android\\Android Studio',
      ];
      
      for (const installPath of windowsPaths) {
        if (await pathExists(installPath)) {
          return installPath;
        }
      }
    } else {
      // Linux
      const linuxPaths = [
        '/opt/android-studio',
        '/usr/local/android-studio',
        path.join(os.homedir(), 'android-studio'),
      ];
      
      for (const installPath of linuxPaths) {
        if (await pathExists(installPath)) {
          return installPath;
        }
      }
    }
    
    return null;
  }

  private async getAndroidStudioCachePaths(): Promise<string[]> {
    const paths: string[] = [];
    const homeDir = os.homedir();
    const platform = os.platform();
    
    // Platform-specific Android Studio cache paths
    if (platform === 'darwin') {
      // macOS paths
      const macPaths = [
        path.join(homeDir, 'Library', 'Caches', 'AndroidStudio*'),
        path.join(homeDir, 'Library', 'Application Support', 'AndroidStudio*'),
        path.join(homeDir, 'Library', 'Logs', 'AndroidStudio*'),
        path.join(homeDir, 'Library', 'Preferences', 'AndroidStudio*'),
        path.join(homeDir, '.android'),
        path.join(homeDir, '.gradle', 'caches'),
      ];
      
      for (const cachePath of macPaths) {
        if (cachePath.includes('*')) {
          // Handle glob patterns for versioned directories
          const baseDir = path.dirname(cachePath);
          const pattern = path.basename(cachePath).replace('*', '');
          try {
            if (await pathExists(baseDir)) {
              const entries = await fs.readdir(baseDir);
              for (const entry of entries) {
                if (entry.startsWith(pattern)) {
                  paths.push(path.join(baseDir, entry));
                }
              }
            }
          } catch {
            // Ignore errors
          }
        } else if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else if (platform === 'win32') {
      // Windows paths
      const windowsPaths = [
        path.join(homeDir, 'AppData', 'Local', 'Android', 'Sdk', '.temp'),
        path.join(homeDir, 'AppData', 'Local', 'Google', 'AndroidStudio*'),
        path.join(homeDir, 'AppData', 'Roaming', 'Google', 'AndroidStudio*'),
        path.join(homeDir, '.android'),
        path.join(homeDir, '.gradle', 'caches'),
      ];
      
      for (const cachePath of windowsPaths) {
        if (cachePath.includes('*')) {
          const baseDir = path.dirname(cachePath);
          const pattern = path.basename(cachePath).replace('*', '');
          try {
            if (await pathExists(baseDir)) {
              const entries = await fs.readdir(baseDir);
              for (const entry of entries) {
                if (entry.startsWith(pattern)) {
                  paths.push(path.join(baseDir, entry));
                }
              }
            }
          } catch {
            // Ignore errors
          }
        } else if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    } else {
      // Linux paths
      const linuxPaths = [
        path.join(homeDir, '.cache', 'Google', 'AndroidStudio*'),
        path.join(homeDir, '.config', 'Google', 'AndroidStudio*'),
        path.join(homeDir, '.local', 'share', 'Google', 'AndroidStudio*'),
        path.join(homeDir, '.android'),
        path.join(homeDir, '.gradle', 'caches'),
      ];
      
      for (const cachePath of linuxPaths) {
        if (cachePath.includes('*')) {
          const baseDir = path.dirname(cachePath);
          const pattern = path.basename(cachePath).replace('*', '');
          try {
            if (await pathExists(baseDir)) {
              const entries = await fs.readdir(baseDir);
              for (const entry of entries) {
                if (entry.startsWith(pattern)) {
                  paths.push(path.join(baseDir, entry));
                }
              }
            }
          } catch {
            // Ignore errors
          }
        } else if (await pathExists(cachePath)) {
          paths.push(cachePath);
        }
      }
    }

    // Look for Android projects with build directories
    try {
      const projectBuildDirs = await this.findAndroidProjectBuildDirs();
      paths.push(...projectBuildDirs);
    } catch (error) {
      printVerbose(`Error finding Android project build dirs: ${error}`);
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  private async findAndroidProjectBuildDirs(): Promise<string[]> {
    const buildDirs: string[] = [];
    const homeDir = os.homedir();
    
    // Common project directories
    const searchDirs = [
      path.join(homeDir, 'AndroidStudioProjects'),
      path.join(homeDir, 'Projects'),
      path.join(homeDir, 'Development'),
      path.join(homeDir, 'dev'),
      path.join(homeDir, 'Documents'),
      process.cwd(),
    ];

    for (const searchDir of searchDirs) {
      if (await pathExists(searchDir)) {
        try {
          const projects = await this.findAndroidProjectsRecursively(searchDir, 2);
          buildDirs.push(...projects);
        } catch (error) {
          printVerbose(`Error searching ${searchDir}: ${error}`);
        }
      }
    }

    return buildDirs;
  }

  private async findAndroidProjectsRecursively(dir: string, maxDepth: number): Promise<string[]> {
    if (maxDepth <= 0) return [];

    const buildDirs: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const fullPath = path.join(dir, entry.name);
          
          // Check if this is an Android project
          const gradleFile = path.join(fullPath, 'build.gradle');
          const gradleKtsFile = path.join(fullPath, 'build.gradle.kts');
          const androidManifest = path.join(fullPath, 'app', 'src', 'main', 'AndroidManifest.xml');
          
          if ((await pathExists(gradleFile) || await pathExists(gradleKtsFile)) || await pathExists(androidManifest)) {
            // This looks like an Android project, add build directories
            const buildLocations = [
              path.join(fullPath, 'build'),
              path.join(fullPath, 'app', 'build'),
              path.join(fullPath, '.gradle'),
            ];
            
            for (const buildDir of buildLocations) {
              if (await pathExists(buildDir)) {
                buildDirs.push(buildDir);
              }
            }
          }
          
          // Recursively search subdirectories
          const subBuildDirs = await this.findAndroidProjectsRecursively(fullPath, maxDepth - 1);
          buildDirs.push(...subBuildDirs);
        }
      }
    } catch {
      // Ignore permission errors
    }

    return buildDirs;
  }

  async isAvailable(): Promise<boolean> {
    // Check if Android Studio is installed OR if there are Android projects
    const installation = await this.findAndroidStudioInstallation();
    
    if (installation) {
      printVerbose(`Found Android Studio at ${installation}`);
      return true;
    }

    // Check for Android SDK
    const homeDir = os.homedir();
    const sdkPaths = [
      path.join(homeDir, 'Android', 'Sdk'),
      path.join(homeDir, 'Library', 'Android', 'sdk'), // macOS
      '/opt/android-sdk',
    ];

    for (const sdkPath of sdkPaths) {
      if (await pathExists(sdkPath)) {
        printVerbose(`Found Android SDK at ${sdkPath}`);
        return true;
      }
    }

    return false;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const isInstalled = await this.isAvailable();
    
    if (!isInstalled) {
      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [],
        isInstalled: false,
        size: 0,
      };
    }

    const cachePaths = await this.getAndroidStudioCachePaths();
    let totalSize = 0;
    const validPaths: string[] = [];

    for (const cachePath of cachePaths) {
      try {
        const size = await getDirectorySize(cachePath, true); // Use estimated size for large dirs
        totalSize += size;
        validPaths.push(cachePath);
        printVerbose(`${symbols.folder} ${cachePath}: ${(size / (1024 * 1024)).toFixed(1)} MB`);
      } catch (error) {
        printVerbose(`Error calculating size for ${cachePath}: ${error}`);
      }
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: validPaths,
      isInstalled: true,
      size: totalSize,
    };
  }

  async clear(dryRun = false, criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo, protectedPaths: string[] = []): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    
    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'Android Studio is not available',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    const sizeBefore = info.size || 0;
    const clearedPaths: string[] = [];
    let errors: string[] = [];

    for (const cachePath of info.paths) {
      // Check if the path is protected
      const isProtected = protectedPaths.some(protectedPattern => 
        minimatch(cachePath, protectedPattern, { dot: true })
      );

      if (isProtected) {
        printVerbose(`Skipping protected path: ${cachePath}`);
        continue; // Skip this path
      }

      try {
        if (dryRun) {
          printVerbose(`${symbols.soap} Would clear: ${cachePath}`);
          clearedPaths.push(cachePath);
        } else {
          printVerbose(`${symbols.soap} Clearing: ${cachePath}`);
          await safeRmrf(cachePath);
          clearedPaths.push(cachePath);
        }
      } catch (error) {
        const errorMsg = `Failed to clear ${cachePath}: ${error}`;
        errors.push(errorMsg);
        printVerbose(errorMsg);
      }
    }

    return {
      name: this.name,
      success: errors.length === 0,
      sizeBefore,
      sizeAfter: 0, // Set to 0 as we don't want to rescan
      error: errors.length > 0 ? errors.join('; ') : undefined,
      clearedPaths,
    };
  }
}

export default new AndroidStudioCleaner();
