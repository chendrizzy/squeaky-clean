import { vi, beforeEach } from "vitest";
import { vol } from "memfs";

// Mock Node.js fs module with memfs for safe testing
vi.mock("fs", async () => {
  const memfs = await vi.importActual("memfs");
  return (memfs as any).fs;
});

vi.mock("fs/promises", async () => {
  const memfs = await vi.importActual("memfs");
  return (memfs as any).fs.promises;
});

// Mock execa to prevent actual command execution
vi.mock("execa", () => ({
  default: vi.fn(),
}));

// Mock os module for cross-platform testing
vi.mock("os", async () => {
  const actualOs = await vi.importActual<typeof import("os")>("os");
  return {
    ...actualOs,
    homedir: vi.fn(() => "/home/testuser"),
    platform: vi.fn(() => "darwin"), // Default to macOS for testing
  };
});

// Mock rimraf to prevent actual deletions
vi.mock("rimraf", () => ({
  rimraf: vi.fn(() => Promise.resolve()),
}));

// Mock console methods to reduce test noise (can be overridden per test)
global.console = {
  ...console,
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

// Global test utilities
declare global {
  const testUtils: {
    mockFs: typeof vol;
    resetMocks: () => void;
    createMockDirectory: (path: string, files?: Record<string, string>) => void;
    createMockFile: (path: string, content: string) => void;
    mockCommand: (command: string, args: string[], result: any) => void;
    mockPlatform: (platform: NodeJS.Platform) => void;
  };
}

globalThis.testUtils = {
  mockFs: vol,

  resetMocks() {
    vol.reset();
    vi.clearAllMocks();
  },

  createMockDirectory(dirPath: string, files: Record<string, string> = {}) {
    vol.mkdirSync(dirPath, { recursive: true });

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = `${dirPath}/${filePath}`;
      vol.writeFileSync(fullPath, content);
    }
  },

  createMockFile(filePath: string, content: string) {
    const dir = filePath.split("/").slice(0, -1).join("/");
    if (dir) {
      vol.mkdirSync(dir, { recursive: true });
    }
    vol.writeFileSync(filePath, content);
  },

  mockCommand(command: string, args: string[], result: any) {
    // This will be implemented in the test files themselves since it needs async
    console.warn("mockCommand should be used in test files directly");
  },

  mockPlatform(platform: NodeJS.Platform) {
    // This will be implemented in the test files themselves since it needs async
    console.warn("mockPlatform should be used in test files directly");
  },
};

// Reset everything before each test
beforeEach(() => {
  globalThis.testUtils.resetMocks();
});
