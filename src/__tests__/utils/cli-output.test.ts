import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { config } from "../../config/index.js";
import { printWarning, showBootPristine } from "../../utils/cli.js";

function getConsoleOutput(): string {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => call.join(" "))
    .join("\n");
}

describe("CLI output helpers", () => {
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });
    config.set({
      output: {
        verbose: false,
        showSizes: true,
        useColors: false,
        emojis: "on",
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });
  });

  it("normalizes warning messages that already include a warning icon", () => {
    printWarning("⚠️  Need manual review");

    expect(getConsoleOutput()).toBe("⚠️  Need manual review");
  });

  it("keeps warning prefixes aligned when the message starts on a new line", () => {
    printWarning("\n⚠ Configuration changes cancelled.");

    expect(getConsoleOutput()).toBe("\n⚠️  Configuration changes cancelled.");
  });

  it("does not wait for readline input in non-interactive pristine mode", async () => {
    vi.useFakeTimers();
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });

    const pristinePromise = showBootPristine(true);

    await vi.runAllTimersAsync();
    await pristinePromise;

    expect(getConsoleOutput()).toContain(
      "Skipping prompt in non-interactive terminal.",
    );
  });
});
