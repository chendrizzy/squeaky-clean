import { defineConfig, configDefaults } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // Real-OS tests run under a separate config (vitest.os.config.ts) with no
    // mocks; exclude them here so the mocked suite never picks them up.
    exclude: [...configDefaults.exclude, 'src/__tests__/os/**'],
    // Long-running integration tests require extended timeouts
    testTimeout: 120000, // 2 minutes default
    hookTimeout: 60000, // 1 minute for hooks
    teardownTimeout: 30000, // 30 seconds for teardown
    // Use forks pool for better isolation with long-running tests
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run all tests in single fork to avoid IPC timeouts
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'src/cli.ts', // CLI entry point - tested via integration
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
