#!/usr/bin/env tsx

/**
 * Demo script for real-time parallel progress tracking
 * This demonstrates the new parallel scanning status output
 */

import { createParallelTracker } from "../src/utils/parallelProgress";
import pc from "picocolors";

// Simulate cache scanners
const scanners = [
  "npm",
  "yarn",
  "pnpm",
  "bun",
  "docker",
  "vscode",
  "chrome",
  "brew",
  "cargo",
  "pip",
  "gradle",
  "maven",
  "webpack",
  "vite",
  "nx",
];

/**
 * Simulate scanning a cache with random duration and size
 */
async function simulateScan(
  name: string,
  minDurationMs: number,
  maxDurationMs: number,
  failureRate: number = 0.1,
): Promise<{ size: number; error?: string }> {
  const duration =
    minDurationMs + Math.random() * (maxDurationMs - minDurationMs);

  await new Promise((resolve) => setTimeout(resolve, duration));

  // Simulate occasional failures
  if (Math.random() < failureRate) {
    throw new Error("Cache not accessible");
  }

  // Generate random cache size (0 - 2 GB)
  const size = Math.floor(Math.random() * 2 * 1024 * 1024 * 1024);

  return { size };
}

/**
 * Main demo function
 */
async function demo() {
  console.log(pc.bold(pc.cyan("\n🧼 Squeaky Clean - Parallel Progress Demo\n")));
  console.log(
    pc.dim(
      "Demonstrating real-time parallel cache scanning with 15 simultaneous scanners\n",
    ),
  );

  // Create tracker
  const tracker = createParallelTracker(scanners);

  // Start tracking
  tracker.start();

  // Launch all scanners in parallel
  const scanPromises = scanners.map(async (scanner) => {
    try {
      // Start scanning
      tracker.update(scanner, "scanning");

      // Simulate scan with varying durations (500ms - 3000ms)
      const result = await simulateScan(scanner, 500, 3000, 0.15);

      // Complete
      tracker.complete(scanner, result.size);
    } catch (error) {
      // Error
      tracker.fail(
        scanner,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  });

  // Wait for all scanners to complete
  await Promise.all(scanPromises);

  // Stop tracking and show final results
  tracker.stop();

  // Show summary
  const summary = tracker.getSummary();
  console.log(pc.bold("\n📊 Summary:"));
  console.log(
    pc.green(`  ✓ Successfully scanned: ${summary.complete}/${summary.total}`),
  );
  console.log(pc.red(`  ✗ Errors: ${summary.errors}`));
  console.log(
    pc.cyan(
      `  💾 Total cache size: ${(summary.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`,
    ),
  );
  console.log(pc.dim(`  ⏱  Duration: ${summary.duration.toFixed(2)}s`));

  console.log(
    pc.bold(
      pc.green("\n✨ Demo complete! This is how parallel scanning looks in action.\n"),
    ),
  );
}

// Run demo
demo().catch(console.error);
