import pc from "picocolors";
import { config } from "../config";

/**
 * Status for a single scanner
 */
type ScanStatus = "pending" | "scanning" | "complete" | "error";

interface ScannerState {
  name: string;
  status: ScanStatus;
  size?: number;
  error?: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Lightweight real-time parallel progress tracker
 * Displays status of multiple cache scanners simultaneously
 */
export class ParallelProgressTracker {
  private scanners: Map<string, ScannerState> = new Map();
  private startTime: number = 0;
  private displayInterval?: NodeJS.Timeout;
  private maxNameLength: number = 0;
  private isActive: boolean = false;
  private lastDisplayLines: number = 0;
  private frameIndex: number = 0; // Smooth frame counter for consistent animation

  constructor(scannerNames: string[]) {
    // Initialize all scanners as pending
    this.maxNameLength = Math.max(...scannerNames.map((n) => n.length));
    for (const name of scannerNames) {
      this.scanners.set(name, {
        name,
        status: "pending",
      });
    }
  }

  /**
   * Start tracking and display updates
   */
  start(): void {
    this.startTime = Date.now();
    this.isActive = true;

    // Initial render
    this.render();

    // Update display every 80ms for smoother animation (12.5fps vs 10fps)
    this.displayInterval = setInterval(() => {
      this.frameIndex++;
      this.render();
    }, 80);
  }

  /**
   * Update status for a specific scanner
   */
  update(
    name: string,
    status: ScanStatus,
    options?: { size?: number; error?: string },
  ): void {
    const scanner = this.scanners.get(name);
    if (!scanner) return;

    scanner.status = status;
    if (options?.size !== undefined) scanner.size = options.size;
    if (options?.error) scanner.error = options.error;

    if (status === "scanning" && !scanner.startTime) {
      scanner.startTime = Date.now();
    }

    if ((status === "complete" || status === "error") && !scanner.endTime) {
      scanner.endTime = Date.now();
    }
  }

  /**
   * Mark scanner as started
   */
  startScanner(name: string): void {
    this.update(name, "scanning");
  }

  /**
   * Mark scanner as complete
   */
  complete(name: string, size?: number): void {
    this.update(name, "complete", { size });
  }

  /**
   * Mark scanner as failed
   */
  fail(name: string, error: string): void {
    this.update(name, "error", { error });
  }

  /**
   * Stop tracking and display final results
   */
  stop(): void {
    this.isActive = false;

    if (this.displayInterval) {
      clearInterval(this.displayInterval);
      this.displayInterval = undefined;
    }

    // Final render
    this.render(true);

    // Move cursor past the display area
    console.log();
  }

  /**
   * Render current status of all scanners
   */
  private render(isFinal: boolean = false): void {
    if (!this.isActive && !isFinal) return;

    // Clear previous display (move cursor up and clear lines)
    if (this.lastDisplayLines > 0) {
      process.stdout.write(`\x1b[${this.lastDisplayLines}A`);
      process.stdout.write("\x1b[0J");
    }

    const lines: string[] = [];
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

    // Header
    const activeCount = Array.from(this.scanners.values()).filter(
      (s) => s.status === "scanning",
    ).length;
    const completeCount = Array.from(this.scanners.values()).filter(
      (s) => s.status === "complete",
    ).length;
    const errorCount = Array.from(this.scanners.values()).filter(
      (s) => s.status === "error",
    ).length;

    if (!isFinal) {
      lines.push(
        pc.dim(
          `Scanning ${this.scanners.size} cache types (${activeCount} active, ${completeCount} complete, ${errorCount} errors) [${elapsed}s]`,
        ),
      );
    } else {
      const totalSize = Array.from(this.scanners.values()).reduce(
        (sum, s) => sum + (s.size || 0),
        0,
      );
      lines.push(
        pc.green(
          `✓ Scan complete: ${completeCount}/${this.scanners.size} caches (${this.formatSize(totalSize)}) in ${elapsed}s`,
        ),
      );
    }

    // Scanner status lines
    const sortedScanners = Array.from(this.scanners.values()).sort((a, b) => {
      // Sort: scanning > complete > error > pending
      const statusOrder = { scanning: 0, complete: 1, error: 2, pending: 3 };
      return statusOrder[a.status] - statusOrder[b.status];
    });

    for (const scanner of sortedScanners) {
      const line = this.formatScannerLine(scanner, isFinal);
      if (line) lines.push(line);
    }

    // Output all lines
    const output = lines.join("\n");
    process.stdout.write(output + "\n");
    this.lastDisplayLines = lines.length;
  }

  /**
   * Format a single scanner status line
   */
  private formatScannerLine(
    scanner: ScannerState,
    isFinal: boolean,
  ): string | null {
    const useColors = config.shouldUseColors();
    const name = scanner.name.padEnd(this.maxNameLength);

    // Skip pending scanners in final display
    if (isFinal && scanner.status === "pending") {
      return null;
    }

    let statusSymbol: string;
    let statusText: string;
    let sizeText = "";

    switch (scanner.status) {
      case "pending":
        statusSymbol = useColors ? pc.gray("○") : "○";
        statusText = useColors ? pc.gray("pending") : "pending";
        break;

      case "scanning":
        // Animated spinner using frame counter for consistent animation
        const spinnerFrames = [
          "⠋",
          "⠙",
          "⠹",
          "⠸",
          "⠼",
          "⠴",
          "⠦",
          "⠧",
          "⠇",
          "⠏",
        ];
        const frame = spinnerFrames[this.frameIndex % spinnerFrames.length];
        statusSymbol = useColors ? pc.cyan(frame) : frame;
        statusText = useColors ? pc.cyan("scanning") : "scanning";

        // Show elapsed time
        if (scanner.startTime) {
          const elapsed = ((Date.now() - scanner.startTime) / 1000).toFixed(1);
          statusText += useColors ? pc.dim(` (${elapsed}s)`) : ` (${elapsed}s)`;
        }
        break;

      case "complete":
        statusSymbol = useColors ? pc.green("✓") : "✓";
        statusText = useColors ? pc.green("complete") : "complete";

        if (scanner.size !== undefined) {
          sizeText = useColors
            ? pc.dim(` - ${this.formatSize(scanner.size)}`)
            : ` - ${this.formatSize(scanner.size)}`;
        }

        // Show duration
        if (scanner.startTime && scanner.endTime) {
          const duration = (
            (scanner.endTime - scanner.startTime) /
            1000
          ).toFixed(1);
          sizeText += useColors ? pc.dim(` [${duration}s]`) : ` [${duration}s]`;
        }
        break;

      case "error":
        statusSymbol = useColors ? pc.red("✗") : "✗";
        statusText = useColors ? pc.red("error") : "error";
        if (scanner.error) {
          sizeText = useColors
            ? pc.dim(` - ${scanner.error}`)
            : ` - ${scanner.error}`;
        }
        break;
    }

    return `  ${statusSymbol} ${name}  ${statusText}${sizeText}`;
  }

  /**
   * Format size in human-readable format
   */
  private formatSize(bytes: number): string {
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 B";

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);

    return `${size} ${sizes[i]}`;
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    total: number;
    complete: number;
    errors: number;
    totalSize: number;
    duration: number;
  } {
    const states = Array.from(this.scanners.values());
    return {
      total: states.length,
      complete: states.filter((s) => s.status === "complete").length,
      errors: states.filter((s) => s.status === "error").length,
      totalSize: states.reduce((sum, s) => sum + (s.size || 0), 0),
      duration: (Date.now() - this.startTime) / 1000,
    };
  }
}

/**
 * Create and manage a parallel progress tracker
 */
export function createParallelTracker(
  scannerNames: string[],
): ParallelProgressTracker {
  return new ParallelProgressTracker(scannerNames);
}
