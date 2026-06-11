import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Real-filesystem OS-behavior tests. Deliberately NO setupFiles, so fs / os /
// execa are the real implementations (the main vitest.config.ts mocks them via
// memfs). These run on every OS in the CI matrix to validate actual platform
// behavior: real `du`/walker sizing, real PATH/PATHEXT resolution, and
// env-driven discovery against real temp directories.
//
// Run with: npm run test:os
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/os/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
