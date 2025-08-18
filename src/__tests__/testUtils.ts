import { vi } from 'vitest';
import { vol } from 'memfs';
import * as os from 'os';
import * as path from 'path';
import execa from 'execa';

// Mock file system helpers
let mockedFilesystem: Map<string, { exists: boolean; size: number; isDirectory: boolean }> = new Map();

// Export the mockedFilesystem for test access
export const getMockedFilesystem = () => mockedFilesystem;

export const resetMocks = () => {
  vol.reset();
  vi.clearAllMocks();
  mockedCommands.clear();
  mockedFilesystem.clear();
};

// Mock filesystem utilities
export const mockFilesystemUtils = () => {
  // Mock pathExists from utils/fs
  vi.mock('../utils/fs.js', async () => {
    const actual = await vi.importActual('../utils/fs.js');
    return {
      ...actual,
      pathExists: vi.fn((path: string) => {
        const mockData = mockedFilesystem.get(path);
        if (mockData !== undefined) {
          return Promise.resolve(mockData.exists);
        }
        // Check if path exists in memfs
        return Promise.resolve(vol.existsSync(path));
      }),
      getDirectorySize: vi.fn((path: string) => {
        const mockData = mockedFilesystem.get(path);
        if (mockData !== undefined) {
          return Promise.resolve(mockData.size);
        }
        // Default size for testing
        return Promise.resolve(1024 * 1024 * 100); // 100MB default
      }),
      safeRmrf: vi.fn((path: string) => {
        // Remove from both mock filesystem and memfs
        mockedFilesystem.delete(path);
        if (vol.existsSync(path)) {
          vol.rmSync(path, { recursive: true, force: true });
        }
        return Promise.resolve();
      })
    };
  });
};

export const mockPath = (filePath: string, options: { exists?: boolean; size?: number; isDirectory?: boolean } = {}) => {
  const mockData = {
    exists: options.exists ?? true,
    size: options.size ?? 1024 * 1024, // 1MB default
    isDirectory: options.isDirectory ?? false
  };
  
  mockedFilesystem.set(filePath, mockData);
  
  // Also create in memfs if it should exist
  if (mockData.exists) {
    if (mockData.isDirectory) {
      vol.mkdirSync(filePath, { recursive: true });
    } else {
      const dir = path.dirname(filePath);
      if (dir && dir !== filePath) {
        vol.mkdirSync(dir, { recursive: true });
      }
      vol.writeFileSync(filePath, 'mock file content');
    }
  }
};

export const mockDirectoryWithSize = (dirPath: string, size: number) => {
  // Create the directory in memfs first
  vol.mkdirSync(dirPath, { recursive: true });
  
  // Store size info in our mock filesystem map
  const mockData = {
    exists: true,
    size: size,
    isDirectory: true
  };
  
  mockedFilesystem.set(dirPath, mockData);
  
  // Also normalize the path for cross-platform compatibility
  const normalizedPath = dirPath.replace(/\\/g, '/');
  if (normalizedPath !== dirPath) {
    mockedFilesystem.set(normalizedPath, mockData);
  }
};

export const mockFileWithSize = (filePath: string, content: string, size?: number) => {
  // Create parent directories
  const dir = filePath.split('/').slice(0, -1).join('/');
  if (dir) {
    vol.mkdirSync(dir, { recursive: true });
  }
  
  vol.writeFileSync(filePath, content);
  
  if (size !== undefined) {
    // Mock stat to return specific size
    const originalStat = vol.statSync.bind(vol);
    vi.mocked(vol.statSync).mockImplementation((path) => {
      if (path === filePath) {
        const stat = originalStat(path);
        return { ...stat, size };
      }
      return originalStat(path);
    });
  }
};

export const createMockDirectoryStructure = (structure: Record<string, string | null>) => {
  vol.fromJSON(structure);
};

// Command mocking utilities
let mockedCommands: Map<string, { output: string; error?: string }> = new Map();

export const mockCommandSuccess = (command: string, output: string) => {
  mockedCommands.set(command, { output });
  const mockedExeca = vi.mocked(execa);
  mockedExeca.mockImplementation((cmd: string, args?: string[]) => {
    const fullCommand = args ? `${cmd} ${args.join(' ')}` : cmd;
    const mockData = mockedCommands.get(fullCommand) || mockedCommands.get(command);
    if (mockData && !mockData.error) {
      return Promise.resolve({
        stdout: mockData.output,
        stderr: '',
        exitCode: 0,
        failed: false,
        killed: false,
        signal: undefined,
        timedOut: false,
        command: fullCommand,
        escapedCommand: fullCommand,
      } as any);
    }
    if (mockData && mockData.error) {
      const err = new Error(mockData.error) as any;
      err.exitCode = 1;
      err.failed = true;
      err.killed = false;
      err.signal = undefined;
      err.timedOut = false;
      err.command = fullCommand;
      err.escapedCommand = fullCommand;
      return Promise.reject(err);
    }
    // Return original mock behavior for other commands
    return Promise.reject(new Error(`Command not mocked: ${fullCommand}`));
  });
};

export const mockCommandError = (command: string, error: string) => {
  mockedCommands.set(command, { output: '', error });
  const mockedExeca = vi.mocked(execa);
  mockedExeca.mockImplementation((cmd: string, args?: string[]) => {
    const fullCommand = args ? `${cmd} ${args.join(' ')}` : cmd;
    const mockData = mockedCommands.get(fullCommand) || mockedCommands.get(command);
    if (mockData && !mockData.error) {
      return Promise.resolve({
        stdout: mockData.output,
        stderr: '',
        exitCode: 0,
        failed: false,
        killed: false,
        signal: undefined,
        timedOut: false,
        command: fullCommand,
        escapedCommand: fullCommand,
      } as any);
    }
    if (mockData && mockData.error) {
      const err = new Error(mockData.error) as any;
      err.exitCode = 1;
      err.failed = true;
      err.killed = false;
      err.signal = undefined;
      err.timedOut = false;
      err.command = fullCommand;
      err.escapedCommand = fullCommand;
      return Promise.reject(err);
    }
    // Return original mock behavior for other commands
    return Promise.reject(new Error(`Command not mocked: ${fullCommand}`));
  });
};

// Environment mocking utilities
export const mockPlatform = (platform: NodeJS.Platform) => {
  vi.mocked(os.platform).mockReturnValue(platform);
};

export const mockHomeDirectory = (homedir: string) => {
  vi.mocked(os.homedir).mockReturnValue(homedir);
};

// Console mocking utilities  
export const mockConsole = () => {
  const originalConsole = { ...console };
  
  const mocks = {
    log: vi.fn(),
    warn: vi.fn(), 
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  
  Object.assign(console, mocks);
  
  return {
    mocks,
    restore: () => Object.assign(console, originalConsole)
  };
};

// Environment variable utilities
export const mockEnvVar = (name: string, value: string) => {
  const originalValue = process.env[name];
  process.env[name] = value;
  
  return () => {
    if (originalValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalValue;
    }
  };
};

export const withEnvVar = async (name: string, value: string, fn: () => Promise<void>) => {
  const restore = mockEnvVar(name, value);
  try {
    await fn();
  } finally {
    restore();
  }
};

// File system test utilities
export const createTempProject = (projectType: 'npm' | 'flutter' | 'gradle' | 'generic' = 'generic', files: Record<string, string> = {}) => {
  const basePath = '/tmp/test-project';
  
  // Create base structure
  let structure: Record<string, string | null> = {
    [basePath]: null,
    ...files
  };
  
  // Add project-specific files
  switch (projectType) {
    case 'npm':
      structure[`${basePath}/package.json`] = JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        dependencies: {}
      });
      structure[`${basePath}/node_modules`] = null;
      break;
      
    case 'flutter':
      structure[`${basePath}/pubspec.yaml`] = 'name: test_app\ndependencies:\n  flutter:\n    sdk: flutter';
      structure[`${basePath}/build`] = null;
      break;
      
    case 'gradle':
      structure[`${basePath}/build.gradle`] = 'apply plugin: "java"';
      structure[`${basePath}/build`] = null;
      break;
  }
  
  vol.fromJSON(structure);
  return basePath;
};

export const expectPathExists = (path: string) => {
  expect(vol.existsSync(path)).toBe(true);
};

export const expectPathNotExists = (path: string) => {
  expect(vol.existsSync(path)).toBe(false);
};
