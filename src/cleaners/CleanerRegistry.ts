import { CleanerModule, CacheType } from '../types';

import { printVerbose } from '../utils/cli';

/**
 * Metadata for cleaner registration
 */
export interface CleanerMetadata {
  name: string;
  type: CacheType;
  description: string;
  patterns?: string[];  // Path patterns to detect this tool
  commands?: string[];  // Commands to check for availability
  platforms?: NodeJS.Platform[];  // Supported platforms
  priority?: number;    // Priority for detection (higher = check first)
}

/**
 * Registry for managing cleaners dynamically
 */
export class CleanerRegistry {
  private static instance: CleanerRegistry;
  private cleaners: Map<string, CleanerModule> = new Map();
  private metadata: Map<string, CleanerMetadata> = new Map();
  
  private constructor() {}
  
  static getInstance(): CleanerRegistry {
    if (!CleanerRegistry.instance) {
      CleanerRegistry.instance = new CleanerRegistry();
    }
    return CleanerRegistry.instance;
  }
  
  /**
   * Register a cleaner with metadata
   */
  register(cleaner: CleanerModule, metadata?: CleanerMetadata): void {
    this.cleaners.set(cleaner.name, cleaner);
    if (metadata) {
      this.metadata.set(cleaner.name, metadata);
    }
    printVerbose(`Registered cleaner: ${cleaner.name}`);
  }
  
  /**
   * Register a cleaner class (will be instantiated on demand)
   */
  registerClass(
    CleanerClass: new () => CleanerModule,
    metadata?: CleanerMetadata
  ): void {
    const instance = new CleanerClass();
    this.register(instance, metadata);
  }
  
  /**
   * Get a cleaner by name
   */
  getCleaner(name: string): CleanerModule | undefined {
    return this.cleaners.get(name);
  }
  
  /**
   * Get all registered cleaners
   */
  getAllCleaners(): CleanerModule[] {
    return Array.from(this.cleaners.values());
  }
  
  /**
   * Get cleaners by type
   */
  getCleanersByType(type: CacheType): CleanerModule[] {
    return this.getAllCleaners().filter(cleaner => cleaner.type === type);
  }
  
  /**
   * Get available cleaners (ones that are installed)
   */
  async getAvailableCleaners(): Promise<CleanerModule[]> {
    const available: CleanerModule[] = [];
    
    for (const cleaner of this.getAllCleaners()) {
      if (await cleaner.isAvailable()) {
        available.push(cleaner);
      }
    }
    
    return available;
  }
  
  /**
   * Auto-detect and register cleaners based on system
   */
  async autoDetect(): Promise<void> {
    printVerbose('Auto-detecting available cleaners...');
    
    // Sort by priority for detection
    const sortedCleaners = Array.from(this.metadata.entries())
      .sort((a, b) => (b[1].priority || 0) - (a[1].priority || 0));
    
    for (const [name, meta] of sortedCleaners) {
      const cleaner = this.cleaners.get(name);
      if (!cleaner) continue;
      
      // Check platform compatibility
      if (meta.platforms && !meta.platforms.includes(process.platform)) {
        printVerbose(`Skipping ${name} - not supported on ${process.platform}`);
        continue;
      }
      
      // Check if available
      if (await cleaner.isAvailable()) {
        printVerbose(`Detected: ${name}`);
      }
    }
  }
  
  /**
   * Get metadata for a cleaner
   */
  getMetadata(name: string): CleanerMetadata | undefined {
    return this.metadata.get(name);
  }
  
  /**
   * Remove a cleaner from the registry
   */
  unregister(name: string): boolean {
    this.metadata.delete(name);
    return this.cleaners.delete(name);
  }
  
  /**
   * Clear all registered cleaners
   */
  clear(): void {
    this.cleaners.clear();
    this.metadata.clear();
  }
}

// Export singleton instance
export const cleanerRegistry = CleanerRegistry.getInstance();