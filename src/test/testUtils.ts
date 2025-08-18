import { beforeAll, beforeEach, vi } from 'vitest';
import { vol } from 'memfs';
import os from 'os';
import path from 'path';

// Mock the fs module to use memfs
vi.mock('fs', async () => {
  const memfs = await vi.importActual('memfs');
  return memfs.fs;
});

vi.mock('fs/promises', async () => {
  const memfs = await vi.importActual('memfs');
  return memfs.fs.promises;
});

// Create a mock home directory structure
export const MOCK_HOME = '/Users/testuser';
export const MOCK_CACHE_DIR = path.join(MOCK_HOME, '.cache');

export function setupMockFileSystem() {
  beforeEach(() => {
    vol.reset();
    
    // Create basic directory structure
    vol.mkdirSync(MOCK_HOME, { recursive: true });
    vol.mkdirSync(MOCK_CACHE_DIR, { recursive: true });
    vol.mkdirSync(path.join(MOCK_HOME, 'Documents'), { recursive: true });
    vol.mkdirSync(path.join(MOCK_HOME, 'Desktop'), { recursive: true });
    vol.mkdirSync('/tmp', { recursive: true });
    vol.mkdirSync('/var/tmp', { recursive: true });
    
    // Mock os.homedir to return our test home
    vi.spyOn(os, 'homedir').mockReturnValue(MOCK_HOME);
    
    vi.clearAllMocks();
  });
}

export function createMockCacheDirectory(relativePath: string, files: Record<string, string | number> = {}) {
  const fullPath = path.join(MOCK_CACHE_DIR, relativePath);
  vol.mkdirSync(fullPath, { recursive: true });
  
  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(fullPath, filename);
    if (typeof content === 'string') {
      vol.writeFileSync(filePath, content);
    } else {
      // Create file with specific size
      vol.writeFileSync(filePath, 'x'.repeat(content));
    }
  }
  
  return fullPath;
}

export function createMockProjectStructure(projectPath: string, structure: any) {
  const fullPath = path.join(MOCK_HOME, projectPath);
  
  function createStructure(basePath: string, struct: any) {
    vol.mkdirSync(basePath, { recursive: true });
    
    for (const [name, content] of Object.entries(struct)) {
      const itemPath = path.join(basePath, name);
      
      if (typeof content === 'string') {
        vol.writeFileSync(itemPath, content);
      } else if (typeof content === 'number') {
        vol.writeFileSync(itemPath, 'x'.repeat(content));
      } else if (typeof content === 'object') {
        createStructure(itemPath, content);
      }
    }
  }
  
  createStructure(fullPath, structure);
  return fullPath;
}

// Mock process.platform
export function mockPlatform(platform: 'darwin' | 'win32' | 'linux') {
  Object.defineProperty(process, 'platform', {
    value: platform,
    writable: true,
    configurable: true,
  });
}

// Mock environment variables
export function mockEnvVar(key: string, value: string) {
  process.env[key] = value;
}

export function clearEnvVar(key: string) {
  delete process.env[key];
}

// Mock command execution
export function mockExecSuccess(command: string, output: string) {
  const { exec } = require('child_process');
  vi.mocked(exec).mockImplementation((cmd, callback) => {
    if (cmd.includes(command)) {
      callback(null, { stdout: output, stderr: '' });
    }
  });
}

export function mockExecError(command: string, error: string) {
  const { exec } = require('child_process');
  vi.mocked(exec).mockImplementation((cmd, callback) => {
    if (cmd.includes(command)) {
      callback(new Error(error), null);
    }
  });
}

// Mock console methods for testing output
export function mockConsole() {
  const consoleSpy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
  };
  
  return {
    ...consoleSpy,
    getOutput: () => ({
      log: consoleSpy.log.mock.calls,
      error: consoleSpy.error.mock.calls,
      warn: consoleSpy.warn.mock.calls,
      info: consoleSpy.info.mock.calls,
    }),
    clear: () => {
      Object.values(consoleSpy).forEach(spy => spy.mockClear());
    },
  };
}

// Test data factories
export const testCacheData = {
  npm: {
    paths: ['_cacache', '_logs', '_locks'],
    files: {
      '_cacache/index-v5/abc123': 1024,
      '_logs/2023-01-01-debug.log': 512,
      '_locks/staging-123.lock': 64,
    },
  },
  yarn: {
    paths: ['berry', 'v6'],
    files: {
      'berry/.yarn-metadata.json': 256,
      'v6/npm-react-18.2.0-cache.json': 2048,
    },
  },
  docker: {
    paths: ['containers', 'images', 'volumes'],
    files: {
      'containers/abc123/config.json': 512,
      'images/sha256/layer.tar': 10485760, // 10MB
      'volumes/metadata.db': 1024,
    },
  },
  gradle: {
    paths: ['caches', 'daemon', 'wrapper'],
    files: {
      'caches/8.0/fileHashes.bin': 4096,
      'daemon/8.0/daemon-123.log': 2048,
      'wrapper/dists/gradle-8.0-bin.zip': 104857600, // 100MB
    },
  },
};

// Size formatting helper for tests
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// Async test utilities
export function waitForPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

export async function waitForCondition(condition: () => boolean, timeout = 1000) {
  const start = Date.now();
  while (!condition() && Date.now() - start < timeout) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!condition()) {
    throw new Error('Condition not met within timeout');
  }
}
