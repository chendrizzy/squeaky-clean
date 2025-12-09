import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ParallelProgressTracker,
  createParallelTracker,
} from "../../utils/parallelProgress";

describe("ParallelProgressTracker", () => {
  let tracker: ParallelProgressTracker;
  let consoleOutput: string[] = [];

  beforeEach(() => {
    // Capture console output
    consoleOutput = [];
    vi.spyOn(process.stdout, "write").mockImplementation((str: any) => {
      consoleOutput.push(str.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize with scanner names", () => {
    tracker = new ParallelProgressTracker(["npm", "yarn", "docker"]);
    expect(tracker).toBeDefined();
  });

  it("should track scanner status changes", () => {
    tracker = new ParallelProgressTracker(["npm", "yarn"]);
    tracker.start();

    tracker.update("npm", "scanning");
    tracker.update("npm", "complete", { size: 1024 * 1024 * 100 });

    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.complete).toBe(1);
    expect(summary.totalSize).toBe(1024 * 1024 * 100);
  });

  it("should handle errors gracefully", () => {
    tracker = new ParallelProgressTracker(["npm", "yarn"]);
    tracker.start();

    tracker.update("npm", "scanning");
    tracker.update("npm", "error", { error: "Failed to scan" });

    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.errors).toBe(1);
  });

  it("should track multiple scanners simultaneously", () => {
    tracker = new ParallelProgressTracker(["npm", "yarn", "docker", "brew"]);
    tracker.start();

    // Simulate parallel scanning
    tracker.update("npm", "scanning");
    tracker.update("yarn", "scanning");
    tracker.update("docker", "scanning");
    tracker.update("brew", "scanning");

    tracker.update("npm", "complete", { size: 1024 * 1024 * 50 });
    tracker.update("yarn", "complete", { size: 1024 * 1024 * 30 });
    tracker.update("docker", "complete", { size: 1024 * 1024 * 200 });
    tracker.update("brew", "error", { error: "Not available" });

    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.total).toBe(4);
    expect(summary.complete).toBe(3);
    expect(summary.errors).toBe(1);
    expect(summary.totalSize).toBe(1024 * 1024 * 280);
  });

  it("should format sizes correctly", () => {
    tracker = new ParallelProgressTracker(["npm"]);
    tracker.start();

    // Test different size ranges
    tracker.update("npm", "scanning");
    tracker.update("npm", "complete", { size: 1024 * 1024 * 1024 }); // 1 GB

    tracker.stop();

    const output = consoleOutput.join("");
    expect(output).toContain("GB");
  });

  it("should show scanning duration", async () => {
    tracker = new ParallelProgressTracker(["npm"]);
    tracker.start();

    tracker.update("npm", "scanning");

    // Wait a bit to accumulate some time
    await new Promise((resolve) => setTimeout(resolve, 100));

    tracker.update("npm", "complete", { size: 1024 * 1024 });
    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.duration).toBeGreaterThan(0);
  });

  it("should handle empty scanner list", () => {
    tracker = new ParallelProgressTracker([]);
    tracker.start();
    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.total).toBe(0);
    expect(summary.complete).toBe(0);
  });

  it("should update display in real-time", async () => {
    tracker = new ParallelProgressTracker(["npm", "yarn"]);
    tracker.start();

    tracker.update("npm", "scanning");

    // Wait for at least one display update (100ms interval)
    await new Promise((resolve) => setTimeout(resolve, 150));

    tracker.update("npm", "complete", { size: 1024 * 1024 });
    tracker.stop();

    // Should have multiple outputs due to interval updates
    expect(consoleOutput.length).toBeGreaterThan(1);
  });

  it("should handle unknown scanners gracefully", () => {
    tracker = new ParallelProgressTracker(["npm"]);
    tracker.start();

    // Try to update a scanner that doesn't exist
    tracker.update("unknown", "scanning");

    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.total).toBe(1); // Only npm should be counted
  });

  it("should provide helper methods for status updates", () => {
    tracker = new ParallelProgressTracker(["npm"]);
    tracker.start();

    tracker.startScanner("npm");
    tracker.complete("npm", 1024 * 1024);

    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.complete).toBe(1);
  });

  it("should provide fail() helper method", () => {
    tracker = new ParallelProgressTracker(["npm", "yarn"]);
    tracker.start();

    tracker.startScanner("npm");
    tracker.fail("npm", "Permission denied");

    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.errors).toBe(1);
    expect(summary.complete).toBe(0);
  });

  it("should format different size units correctly", () => {
    tracker = new ParallelProgressTracker(["bytes", "kb", "mb", "gb"]);
    tracker.start();

    tracker.update("bytes", "complete", { size: 512 }); // 512 B
    tracker.update("kb", "complete", { size: 1024 * 50 }); // 50 KB
    tracker.update("mb", "complete", { size: 1024 * 1024 * 25 }); // 25 MB
    tracker.update("gb", "complete", { size: 1024 * 1024 * 1024 * 2 }); // 2 GB

    tracker.stop();

    const output = consoleOutput.join("");
    expect(output).toContain("B");
    expect(output).toContain("KB");
    expect(output).toContain("MB");
    expect(output).toContain("GB");
  });

  it("should handle zero size correctly", () => {
    tracker = new ParallelProgressTracker(["npm"]);
    tracker.start();

    tracker.update("npm", "complete", { size: 0 });

    tracker.stop();

    const output = consoleOutput.join("");
    expect(output).toContain("0 B");
  });

  it("should handle double stop gracefully", () => {
    tracker = new ParallelProgressTracker(["npm"]);
    tracker.start();

    tracker.update("npm", "complete", { size: 1024 });

    tracker.stop();
    // Second stop should not throw
    expect(() => tracker.stop()).not.toThrow();
  });

  it("should handle direct pending to complete transition", () => {
    tracker = new ParallelProgressTracker(["npm"]);
    tracker.start();

    // Skip scanning state, go directly to complete
    tracker.update("npm", "complete", { size: 1024 * 1024 });

    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.complete).toBe(1);
  });

  it("should track individual scanner durations", () => {
    tracker = new ParallelProgressTracker(["npm"]);
    tracker.start();

    tracker.update("npm", "scanning");
    tracker.update("npm", "complete", { size: 1024 });

    tracker.stop();

    // Output should contain duration info
    const output = consoleOutput.join("");
    expect(output).toMatch(/\[\d+\.\d+s\]/); // Duration format [X.Xs]
  });

  it("should sort scanners by status in display", () => {
    tracker = new ParallelProgressTracker([
      "scanner-pending",
      "scanner-active",
      "scanner-done",
      "scanner-failed",
    ]);
    tracker.start();

    // Set different statuses
    tracker.update("scanner-pending", "pending"); // Should be last
    tracker.update("scanner-active", "scanning"); // Should be first
    tracker.update("scanner-done", "complete", { size: 100 }); // Should be second
    tracker.update("scanner-failed", "error", { error: "fail" }); // Should be third

    tracker.stop();

    const output = consoleOutput.join("");
    const activeIndex = output.indexOf("scanner-active");
    const doneIndex = output.indexOf("scanner-done");
    const failedIndex = output.indexOf("scanner-failed");

    // Scanning should appear before complete and error
    expect(activeIndex).toBeGreaterThan(-1);
    expect(doneIndex).toBeGreaterThan(-1);
    expect(failedIndex).toBeGreaterThan(-1);
    expect(activeIndex).toBeLessThan(doneIndex);
    expect(doneIndex).toBeLessThan(failedIndex);
  });

  it("should not render when inactive unless final", () => {
    tracker = new ParallelProgressTracker(["npm"]);
    // Don't call start()

    // Manually trigger update - should be ignored since not active
    tracker.update("npm", "scanning");

    const summary = tracker.getSummary();
    // Scanner should still be pending since tracker wasn't started
    expect(summary.complete).toBe(0);
  });

  it("should work with createParallelTracker factory function", () => {
    tracker = createParallelTracker(["npm", "yarn"]);
    expect(tracker).toBeInstanceOf(ParallelProgressTracker);

    tracker.start();
    tracker.complete("npm", 1024);
    tracker.complete("yarn", 2048);
    tracker.stop();

    const summary = tracker.getSummary();
    expect(summary.complete).toBe(2);
    expect(summary.totalSize).toBe(3072);
  });

  it("should handle very large sizes (TB range)", () => {
    tracker = new ParallelProgressTracker(["large"]);
    tracker.start();

    tracker.update("large", "complete", { size: 1024 * 1024 * 1024 * 1024 * 2 }); // 2 TB

    tracker.stop();

    const output = consoleOutput.join("");
    expect(output).toContain("TB");
  });

  it("should preserve error message in output", () => {
    tracker = new ParallelProgressTracker(["npm"]);
    tracker.start();

    tracker.fail("npm", "Access denied to cache directory");

    tracker.stop();

    const output = consoleOutput.join("");
    expect(output).toContain("Access denied to cache directory");
  });
});
