import { beforeEach, describe, expect, it, vi } from 'vitest';
import dockerCleaner from '../../cleaners/docker';
import gradleCleaner from '../../cleaners/gradle';
import flutterCleaner from '../../cleaners/flutter';
import pipCleaner from '../../cleaners/pip';
import execa from 'execa';
import { pathExists, getDirectorySize, safeRmrf } from '../../utils/fs.js';
import { cacheManager } from '../../utils/cache';
import * as os from 'os';

// Mock execa
vi.mock('execa', () => {
  const mockExeca = vi.fn();
  return {
    default: mockExeca,
    __esModule: true,
  };
});

// Mock filesystem utilities
vi.mock('../../utils/fs.js', () => {
  return {
    pathExists: vi.fn(),
    getDirectorySize: vi.fn(),
    safeRmrf: vi.fn()
  };
});

// Mock os module
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    homedir: vi.fn(() => '/Users/test'),
    platform: vi.fn(() => 'darwin')
  };
});

describe('System Tools Cache Cleaners - Basic Tests', () => {
  // Track mocked commands
  const mockedCommands = new Map<string, { output?: string; error?: string }>();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedCommands.clear();
    // Clear cached availability results to ensure test isolation
    cacheManager.clearAll();

    // Set up default filesystem mocks
    vi.mocked(pathExists).mockResolvedValue(false);
    vi.mocked(getDirectorySize).mockResolvedValue(0);
    vi.mocked(safeRmrf).mockResolvedValue(undefined);
  });


  // Mock command utilities
  const mockCommandSuccess = (command: string, output: string) => {
    mockedCommands.set(command, { output });
    updateExecaMock();
  };

  const mockCommandError = (command: string, error: string) => {
    mockedCommands.set(command, { error });
    updateExecaMock();
  };

  const updateExecaMock = () => {
    const mockedExeca = vi.mocked(execa);
    mockedExeca.mockImplementation((cmd: string, args?: string[]) => {
      const fullCommand = args ? `${cmd} ${args.join(' ')}` : cmd;
      const mockData = mockedCommands.get(fullCommand);
      
      if (mockData) {
        if (mockData.error) {
          const err = new Error(mockData.error) as any;
          err.exitCode = 1;
          err.failed = true;
          return Promise.reject(err);
        } else {
          return Promise.resolve({
            stdout: mockData.output || '',
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
      }
      
      return Promise.reject(new Error(`Command not mocked: ${fullCommand}`));
    });
  };

  describe('DockerCleaner', () => {
    it('should detect Docker installation', async () => {
      mockCommandSuccess('docker version --format {{.Server.Version}}', '20.10.0');

      const detected = await dockerCleaner.isAvailable();
      expect(detected).toBe(true);
    });

    it('should not detect Docker when command fails', async () => {
      mockCommandError('docker version --format {{.Server.Version}}', 'command not found: docker');
      mockCommandError('docker --version', 'command not found: docker');

      const detected = await dockerCleaner.isAvailable();
      expect(detected).toBe(false);
    });

    it('should parse Docker system df output correctly', async () => {
      mockCommandSuccess('docker version --format {{.Server.Version}}', '24.0.7');
      mockCommandSuccess(
        'docker system df --format table {{.Type}}\\t{{.TotalCount}}\\t{{.Size}}\\t{{.Reclaimable}}',
        'TYPE\tTOTAL\tSIZE\tRECLAIMABLE\nImages\t8\t1.2GB\t600MB\nContainers\t4\t300MB\t150MB\nLocal Volumes\t3\t800MB\t400MB\nBuild Cache\t12\t2.5GB\t2GB'
      );
      mockCommandSuccess('docker network ls --filter type=custom --format {{.ID}}', 'net1\nnet2');

      await dockerCleaner.isAvailable();
      const info = await dockerCleaner.getCacheInfo();

      expect(info.paths.length).toBeGreaterThan(0);
      expect(info.size).toBeGreaterThan(0);
      expect(info.paths[0]).toContain('Docker System');
    });
  });

  describe('GradleCleaner', () => {
    it('should detect Gradle with gradle command', async () => {
      mockCommandSuccess('gradle --version', 'Gradle 8.4');

      const detected = await gradleCleaner.isAvailable();
      expect(detected).toBe(true);
    });

    it('should not detect Gradle when command fails and no .gradle directory', async () => {
      mockCommandError('gradle --version', 'command not found: gradle');
      mockCommandError('./gradlew --version', 'command not found: ./gradlew');
      vi.mocked(pathExists).mockResolvedValue(false); // No .gradle directory

      const detected = await gradleCleaner.isAvailable();
      expect(detected).toBe(false);
    });

    it('should have correct name and description', async () => {
      expect(gradleCleaner.name).toBe('gradle');
      expect(gradleCleaner.type).toBe('build-tool');
      expect(gradleCleaner.description).toContain('Gradle');
    });
  });

  describe('FlutterCleaner', () => {
    it('should detect Flutter installation', async () => {
      mockCommandSuccess('flutter --version', 'Flutter 3.16.0 • channel stable • https://github.com/flutter/flutter.git');

      const detected = await flutterCleaner.isAvailable();
      expect(detected).toBe(true);
    });

    it('should not detect Flutter when command fails', async () => {
      mockCommandError('flutter --version', 'command not found: flutter');

      const detected = await flutterCleaner.isAvailable();
      expect(detected).toBe(false);
    });

    it('should have correct name and description', async () => {
      expect(flutterCleaner.name).toBe('flutter');
      expect(flutterCleaner.type).toBe('build-tool');
      expect(flutterCleaner.description).toContain('Flutter');
    });
  });

  describe('PipCleaner', () => {
    it('should detect Python pip installation', async () => {
      mockCommandSuccess('pip --version', 'pip 23.3.1 from /usr/local/lib/python3.11/site-packages/pip (python 3.11)');

      const detected = await pipCleaner.isAvailable();
      expect(detected).toBe(true);
    });

    it('should detect Python3 pip installation', async () => {
      mockCommandError('pip --version', 'command not found: pip');
      mockCommandSuccess('pip3 --version', 'pip 23.3.1 from /usr/local/lib/python3.11/site-packages/pip (python 3.11)');

      const detected = await pipCleaner.isAvailable();
      expect(detected).toBe(true);
    });

    it('should not detect pip when both commands fail', async () => {
      mockCommandError('pip --version', 'command not found: pip');
      mockCommandError('pip3 --version', 'command not found: pip3');

      const detected = await pipCleaner.isAvailable();
      expect(detected).toBe(false);
    });

    it('should have correct name and description', async () => {
      expect(pipCleaner.name).toBe('pip');
      expect(pipCleaner.type).toBe('package-manager');
      expect(pipCleaner.description).toContain('Python');
    });
  });

  describe('Cross-platform compatibility', () => {
    it('should handle different platforms', () => {
      const platforms: NodeJS.Platform[] = ['darwin', 'win32', 'linux'];
      
      platforms.forEach(platform => {
        vi.mocked(os.platform).mockReturnValue(platform);
        
        // Should not throw errors when checking availability on different platforms
        expect(() => dockerCleaner.isAvailable()).not.toThrow();
        expect(() => gradleCleaner.isAvailable()).not.toThrow();
        expect(() => flutterCleaner.isAvailable()).not.toThrow();
        expect(() => pipCleaner.isAvailable()).not.toThrow();
      });
    });
  });
});
