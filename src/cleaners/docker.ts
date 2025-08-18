import execa from 'execa';
import { CacheInfo, ClearResult, CleanerModule } from '../types';
import { printVerbose } from '../utils/cli';

export class DockerCleaner implements CleanerModule {
  name = 'docker';
  type = 'system' as const;
  description = 'Docker images, containers, volumes, networks, and build cache';

  async isAvailable(): Promise<boolean> {
    try {
      printVerbose('Checking if Docker is installed and running...');
      const result = await execa('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 10000 });
      if (result.exitCode === 0 && result.stdout) {
        printVerbose(`Found Docker server version: ${result.stdout.trim()}`);
        return true;
      }
      return false;
    } catch (error) {
      // Docker might be installed but not running
      try {
        await execa('docker', ['--version'], { timeout: 5000 });
        printVerbose('Docker is installed but server might not be running');
        return true;
      } catch {
        return false;
      }
    }
  }

  async getDockerSystemInfo(): Promise<{
    images: { count: number; size: number };
    containers: { count: number; size: number };
    volumes: { count: number; size: number };
    buildCache: { count: number; size: number };
    networks: { count: number };
  }> {
    const info = {
      images: { count: 0, size: 0 },
      containers: { count: 0, size: 0 },
      volumes: { count: 0, size: 0 },
      buildCache: { count: 0, size: 0 },
      networks: { count: 0 }
    };

    try {
      // Get system df info (most comprehensive)
      const systemDf = await execa('docker', ['system', 'df', '--format', 'table {{.Type}}\\t{{.TotalCount}}\\t{{.Size}}\\t{{.Reclaimable}}'], { timeout: 30000 });
      const lines = systemDf.stdout.split('\n').slice(1); // Skip header
      
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('\t').map(s => s.trim());
        if (parts.length >= 4) {
          const [type, totalCount, size, reclaimable] = parts;
          const count = parseInt(totalCount) || 0;
          const sizeBytes = this.parseDockerSize(size);
          const reclaimableBytes = this.parseDockerSize(reclaimable);
          
          switch (type.toLowerCase()) {
            case 'images':
              info.images = { count, size: reclaimableBytes || sizeBytes };
              break;
            case 'containers':
              info.containers = { count, size: reclaimableBytes || sizeBytes };
              break;
            case 'local volumes':
              info.volumes = { count, size: reclaimableBytes || sizeBytes };
              break;
            case 'build cache':
              info.buildCache = { count, size: reclaimableBytes || sizeBytes };
              break;
          }
        }
      }

      // Get networks count separately
      const networks = await execa('docker', ['network', 'ls', '--filter', 'type=custom', '--format', '{{.ID}}'], { timeout: 10000 });
      info.networks.count = networks.stdout.split('\n').filter(line => line.trim()).length;

    } catch (error) {
      printVerbose(`Error getting Docker system info: ${error}`);
    }

    return info;
  }

  private parseDockerSize(sizeStr: string): number {
    if (!sizeStr || sizeStr === '0B' || sizeStr === '--') return 0;
    
    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024
    };
    
    const match = sizeStr.match(/^([\d.]+)\s*([A-Z]{1,2})$/);
    if (match) {
      const [, value, unit] = match;
      const multiplier = units[unit] || 1;
      return parseFloat(value) * multiplier;
    }
    
    return 0;
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

    try {
      const systemInfo = await this.getDockerSystemInfo();
      
      const totalSize = 
        systemInfo.images.size + 
        systemInfo.containers.size + 
        systemInfo.volumes.size + 
        systemInfo.buildCache.size;

      const totalItems = 
        systemInfo.images.count + 
        systemInfo.containers.count + 
        systemInfo.volumes.count + 
        systemInfo.buildCache.count +
        systemInfo.networks.count;

      printVerbose('=== Docker System Summary ===');
      printVerbose(`Images: ${systemInfo.images.count} (${(systemInfo.images.size / (1024 * 1024)).toFixed(1)} MB)`);
      printVerbose(`Containers: ${systemInfo.containers.count} (${(systemInfo.containers.size / (1024 * 1024)).toFixed(1)} MB)`);
      printVerbose(`Volumes: ${systemInfo.volumes.count} (${(systemInfo.volumes.size / (1024 * 1024)).toFixed(1)} MB)`);
      printVerbose(`Build Cache: ${systemInfo.buildCache.count} (${(systemInfo.buildCache.size / (1024 * 1024)).toFixed(1)} MB)`);
      printVerbose(`Networks: ${systemInfo.networks.count}`);
      printVerbose(`Total reclaimable: ${(totalSize / (1024 * 1024)).toFixed(1)} MB`);

      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [`Docker System (${totalItems} items)`], // Conceptual path for display
        isInstalled,
        size: totalSize,
      };
    } catch (error) {
      printVerbose(`Error getting Docker cache info: ${error}`);
      return {
        name: this.name,
        type: this.type,
        description: this.description,
        paths: [],
        isInstalled,
        size: 0,
      };
    }
  }

  async clear(dryRun = false): Promise<ClearResult> {
    const cacheInfo = await this.getCacheInfo();
    const sizeBefore = cacheInfo.size || 0;
    let success = true;
    let error: string | undefined;
    const clearedItems: string[] = [];

    if (!cacheInfo.isInstalled) {
      return {
        name: this.name,
        success: false,
        error: 'Docker is not installed or running',
        clearedPaths: [],
        sizeBefore: 0,
        sizeAfter: 0,
      };
    }

    if (sizeBefore === 0) {
      printVerbose('No Docker items to clean');
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
        printVerbose('[DRY RUN] Would clean Docker system with the following:');
        printVerbose('  • docker system prune -af --volumes');
        printVerbose('  • docker builder prune -af');
        printVerbose('  This would remove:');
        printVerbose('    - All stopped containers');
        printVerbose('    - All networks not used by at least one container');
        printVerbose('    - All images without at least one container associated to them');
        printVerbose('    - All build cache');
        printVerbose('    - All anonymous volumes not used by at least one container');
        
        return {
          name: this.name,
          success: true,
          sizeBefore,
          sizeAfter: sizeBefore, // No change in dry run
          clearedPaths: ['Docker system (dry run)'],
        };
      }

      printVerbose('Running Docker system cleanup...');

      // Clean up system: containers, networks, images, and volumes
      try {
        printVerbose('Running: docker system prune -af --volumes');
        const systemPrune = await execa('docker', ['system', 'prune', '-af', '--volumes']);
        if (systemPrune.stdout) {
          printVerbose(`System prune output: ${systemPrune.stdout}`);
        }
        clearedItems.push('System resources (containers, networks, images, volumes)');
      } catch (systemError) {
        printVerbose(`System prune failed: ${systemError}`);
        error = `System prune failed: ${systemError}`;
        success = false;
      }

      // Clean up build cache separately for thoroughness
      try {
        printVerbose('Running: docker builder prune -af');
        const builderPrune = await execa('docker', ['builder', 'prune', '-af']);
        if (builderPrune.stdout) {
          printVerbose(`Builder prune output: ${builderPrune.stdout}`);
        }
        clearedItems.push('Build cache');
      } catch (builderError) {
        printVerbose(`Builder prune failed: ${builderError}`);
        if (!error) {
          error = `Builder prune failed: ${builderError}`;
        }
        success = false;
      }

      // Get new size info
      const newCacheInfo = await this.getCacheInfo();
      const sizeAfter = newCacheInfo.size || 0;
      const savedMB = ((sizeBefore - sizeAfter) / (1024 * 1024)).toFixed(1);
      
      if (sizeBefore > sizeAfter) {
        printVerbose(`Freed ${savedMB} MB of Docker data`);
      }

      return {
        name: this.name,
        success,
        sizeBefore,
        sizeAfter,
        error,
        clearedPaths: clearedItems,
      };
    } catch (clearError) {
      return {
        name: this.name,
        success: false,
        sizeBefore,
        sizeAfter: sizeBefore,
        error: clearError instanceof Error ? clearError.message : String(clearError),
        clearedPaths: [],
      };
    }
  }

  static create(): DockerCleaner {
    return new DockerCleaner();
  }
}

export default DockerCleaner.create();
