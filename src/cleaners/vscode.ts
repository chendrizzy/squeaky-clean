import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CacheInfo, ClearResult, CleanerModule } from '../types';
import { getDirectorySize, getEstimatedDirectorySize, pathExists, safeRmrf } from '../utils/fs';
import { printVerbose } from '../utils/cli';

export class VSCodeCleaner implements CleanerModule {
  name = 'vscode';
  type = 'ide' as const;
  description = 'VS Code extensions cache, workspace storage, logs, and temporary files';

  private getCachePaths(): Array<{ path: string; description: string; category: string }> {
    const homeDir = os.homedir();
    const platform = process.platform;
    
    let vscodeConfigDir: string;
    let vscodeExtensionsDir: string;
    
    if (platform === 'darwin') {
      vscodeConfigDir = path.join(homeDir, 'Library', 'Application Support', 'Code');
      vscodeExtensionsDir = path.join(homeDir, '.vscode', 'extensions');
    } else if (platform === 'win32') {
      vscodeConfigDir = path.join(homeDir, 'AppData', 'Roaming', 'Code');
      vscodeExtensionsDir = path.join(homeDir, '.vscode', 'extensions');
    } else {
      vscodeConfigDir = path.join(homeDir, '.config', 'Code');
      vscodeExtensionsDir = path.join(homeDir, '.vscode', 'extensions');
    }

    return [
      // Extension host cache and logs
      {
        path: path.join(vscodeConfigDir, 'logs'),
        description: 'VS Code application logs',
        category: 'Logs'
      },
      {
        path: path.join(vscodeConfigDir, 'CachedExtensions'),
        description: 'Cached extension metadata',
        category: 'Extensions'
      },
      {
        path: path.join(vscodeConfigDir, 'CachedExtensionVSIXs'),
        description: 'Cached extension VSIX files',
        category: 'Extensions'
      },
      
      // Workspace storage and state
      {
        path: path.join(vscodeConfigDir, 'User', 'workspaceStorage'),
        description: 'Workspace-specific cache and state',
        category: 'Workspaces'
      },
      {
        path: path.join(vscodeConfigDir, 'User', 'History'),
        description: 'File history and timeline cache',
        category: 'History'
      },
      
      // Language server and IntelliSense caches
      {
        path: path.join(vscodeConfigDir, 'User', 'globalStorage'),
        description: 'Extension global storage (some safe to clear)',
        category: 'Storage'
      },
      
      // Crash dumps and diagnostic data
      {
        path: path.join(vscodeConfigDir, 'CrashDumps'),
        description: 'Application crash dumps',
        category: 'Diagnostics'
      },
      
      // Extension-specific caches in extensions folder
      {
        path: path.join(vscodeExtensionsDir, '.obsolete'),
        description: 'Obsolete extension files',
        category: 'Extensions'
      },
      
      // Platform-specific additional locations
      ...(platform === 'darwin' ? [
        {
          path: path.join(homeDir, 'Library', 'Caches', 'com.microsoft.VSCode'),
          description: 'macOS VS Code application cache',
          category: 'App Cache'
        },
        {
          path: path.join(homeDir, 'Library', 'Logs', 'Microsoft VS Code'),
          description: 'macOS VS Code system logs',
          category: 'Logs'
        }
      ] : []),
      
      ...(platform === 'win32' ? [
        {
          path: path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'vscode-cpptools'),
          description: 'C++ extension cache',
          category: 'Language Servers'
        }
      ] : []),
      
      // Common language server caches (cross-platform)
      {
        path: path.join(homeDir, '.vscode-server', 'data', 'logs'),
        description: 'Remote development server logs',
        category: 'Remote'
      }
    ];
  }

  async isAvailable(): Promise<boolean> {
    try {
      printVerbose('Checking if VS Code is installed...');
      
      const platform = process.platform;
      const vscodeInstalls = [
        // macOS
        '/Applications/Visual Studio Code.app',
        '/Applications/Visual Studio Code - Insiders.app',
        // Windows
        path.join(process.env.PROGRAMFILES || '', 'Microsoft VS Code', 'Code.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
        // Linux
        '/usr/bin/code',
        '/snap/code/current/usr/share/code/code',
        '/usr/share/code/code'
      ];
      
      for (const install of vscodeInstalls) {
        if (await pathExists(install)) {
          printVerbose(`Found VS Code at ${install}`);
          return true;
        }
      }
      
      // Also check if we have VS Code config directories (indicates usage)
      const homeDir = os.homedir();
      let configDir: string;
      
      if (platform === 'darwin') {
        configDir = path.join(homeDir, 'Library', 'Application Support', 'Code');
      } else if (platform === 'win32') {
        configDir = path.join(homeDir, 'AppData', 'Roaming', 'Code');
      } else {
        configDir = path.join(homeDir, '.config', 'Code');
      }
      
      if (await pathExists(configDir)) {
        printVerbose(`Found VS Code config directory at ${configDir}`);
        return true;
      }
      
      return false;
    } catch {
      return false;
    }
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const allPaths = this.getCachePaths();
    const existingPaths: string[] = [];
    let totalSize = 0;
    let lastModified: Date | undefined;
    const categories = new Map<string, { size: number; count: number }>();

    printVerbose(`Checking ${allPaths.length} VS Code cache locations...`);

    for (const { path: cachePath, description, category } of allPaths) {
      if (await pathExists(cachePath)) {
        existingPaths.push(cachePath);
        
        try {
          // Use estimation for potentially large directories to avoid timeouts
          const isLargeDirectory = category === 'Storage' || category === 'Workspaces' || cachePath.includes('extensions');
          const size = isLargeDirectory ? 
            await getEstimatedDirectorySize(cachePath) : 
            await getDirectorySize(cachePath);
            
          totalSize += size;
          
          // Track by category
          const existing = categories.get(category) || { size: 0, count: 0 };
          categories.set(category, { 
            size: existing.size + size, 
            count: existing.count + 1 
          });
          
          const stats = await fs.stat(cachePath);
          if (!lastModified || stats.mtime > lastModified) {
            lastModified = stats.mtime;
          }
          
          const sizeInMB = (size / (1024 * 1024)).toFixed(1);
          const sizeType = isLargeDirectory ? ' estimated' : '';
          printVerbose(`Found ${category}: ${cachePath} (${sizeInMB} MB${sizeType}) - ${description}`);
        } catch (error) {
          printVerbose(`Error checking ${cachePath}: ${error}`);
        }
      }
    }

    // Log category summary
    if (categories.size > 0) {
      printVerbose('=== VS Code Cache Summary by Category ===');
      categories.forEach((info, category) => {
        const sizeInMB = (info.size / (1024 * 1024)).toFixed(1);
        printVerbose(`${category}: ${info.count} locations, ${sizeInMB} MB`);
      });
    }

    return {
      name: this.name,
      type: this.type,
      description: this.description,
      paths: existingPaths,
      isInstalled: await this.isAvailable(),
      size: totalSize,
      lastModified,
    };
  }

  async clear(dryRun = false, criteria?: CacheSelectionCriteria, cacheInfo?: CacheInfo): Promise<ClearResult> {
    const info = cacheInfo || await this.getCacheInfo();
    const clearedPaths: string[] = [];
    const sizeBefore = info.size || 0;
    let success = true;
    let error: string | undefined;

    if (!info.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'VS Code is not installed or configured',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    if (info.paths.length === 0) {
      printVerbose('No VS Code cache directories found');
      return {
        name: this.name,
        success: true,
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    try {
      if (dryRun) {
        printVerbose(`[DRY RUN] Would clear ${info.paths.length} VS Code cache locations:`);
        const pathsWithInfo = this.getCachePaths();
        for (const cachePath of info.paths) {
          const pathInfo = pathsWithInfo.find(p => p.path === cachePath);
          printVerbose(`  • ${pathInfo?.category || 'Unknown'}: ${cachePath}`);
          if (pathInfo?.description) {
            printVerbose(`    ${pathInfo.description}`);
          }
        }
        return {
          name: this.name,
          success: true,
          sizeBefore,
          sizeAfter: sizeBefore,
          clearedPaths: info.paths,
        };
      }

      const pathsWithInfo = this.getCachePaths();
      
      // Clear caches by category priority (safest first)
      const priorityOrder = [
        'Logs',
        'Diagnostics', 
        'App Cache',
        'Extensions',
        'History',
        'Language Servers',
        'Remote',
        'Workspaces',  // More careful - contains workspace state
        'Storage'      // Most careful - contains extension settings
      ];

      const categorizedPaths = new Map<string, string[]>();
      for (const cachePath of info.paths) {
        const pathInfo = pathsWithInfo.find(p => p.path === cachePath);
        const category = pathInfo?.category || 'Other';
        
        if (!categorizedPaths.has(category)) {
          categorizedPaths.set(category, []);
        }
        categorizedPaths.get(category)!.push(cachePath);
      }

      // Clear in priority order
      for (const category of priorityOrder) {
        const paths = categorizedPaths.get(category);
        if (!paths) continue;

        printVerbose(`Clearing ${category} caches...`);
        
        for (const cachePath of paths) {
          try {
            if (await pathExists(cachePath)) {
              const pathInfo = pathsWithInfo.find(p => p.path === cachePath);
              
              printVerbose(`Clearing ${category}: ${cachePath}`);
              if (pathInfo?.description) {
                printVerbose(`  Purpose: ${pathInfo.description}`);
              }
              
              await safeRmrf(cachePath);
              clearedPaths.push(cachePath);
            }
          } catch (pathError) {
            printVerbose(`Failed to clear ${cachePath}: ${pathError}`);
            success = false;
            if (!error) {
              error = `Failed to clear some VS Code cache directories: ${pathError}`;
            }
          }
        }
      }

      // Handle any remaining uncategorized paths
      const remainingPaths = info.paths.filter(p => !clearedPaths.includes(p));
      for (const cachePath of remainingPaths) {
        try {
          if (await pathExists(cachePath)) {
            printVerbose(`Clearing remaining cache: ${cachePath}`);
            await safeRmrf(cachePath);
            clearedPaths.push(cachePath);
          }
        } catch (pathError) {
          printVerbose(`Failed to clear ${cachePath}: ${pathError}`);
          success = false;
          if (!error) {
            error = `Failed to clear some cache directories: ${pathError}`;
          }
        }
      }

      if (sizeBefore > 0) {
        printVerbose(`Freed space from VS Code cache data`);
      }

      return {
        name: this.name,
        success,
        sizeBefore,
        sizeAfter: 0, // Set to 0 as we don't want to rescan
        error,
        clearedPaths,
      };
    } catch (clearError) {
      return {
        name: this.name,
        success: false,
        sizeBefore,
        sizeAfter: sizeBefore,
        error: clearError instanceof Error ? clearError.message : String(clearError),
        clearedPaths,
      };
    }
  }

  static create(): VSCodeCleaner {
    return new VSCodeCleaner();
  }
}

export default VSCodeCleaner.create();
