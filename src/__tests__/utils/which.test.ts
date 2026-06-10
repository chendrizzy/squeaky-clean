import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";
import { commandExists, anyCommandExists } from "../../utils/which";
import { cacheManager } from "../../utils/cache";

describe("which utilities", () => {
  const originalPath = process.env.PATH;

  beforeEach(() => {
    vol.reset();
    cacheManager.clearAll();
    process.env.PATH = "/test/bin:/test/other";
  });

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  describe("commandExists", () => {
    it("finds an executable file on PATH", async () => {
      vol.mkdirSync("/test/bin", { recursive: true });
      vol.writeFileSync("/test/bin/mytool", "#!/bin/sh\n", { mode: 0o755 });

      expect(await commandExists("mytool")).toBe(true);
    });

    it("finds an executable in a later PATH entry", async () => {
      vol.mkdirSync("/test/bin", { recursive: true });
      vol.mkdirSync("/test/other", { recursive: true });
      vol.writeFileSync("/test/other/latertool", "#!/bin/sh\n", {
        mode: 0o755,
      });

      expect(await commandExists("latertool")).toBe(true);
    });

    it("returns false when the command is not on PATH", async () => {
      vol.mkdirSync("/test/bin", { recursive: true });

      expect(await commandExists("definitely-not-installed")).toBe(false);
    });

    it("returns false for a DIRECTORY named like the command", async () => {
      // Regression: directories pass fs.access(X_OK) on POSIX (execute bit
      // means traversal), so a bare access() check reports false positives.
      vol.mkdirSync("/test/bin/fakecmd", { recursive: true });

      expect(await commandExists("fakecmd")).toBe(false);
    });

    it("checks explicit paths directly without scanning PATH", async () => {
      vol.mkdirSync("/elsewhere", { recursive: true });
      vol.writeFileSync("/elsewhere/tool", "#!/bin/sh\n", { mode: 0o755 });

      expect(await commandExists("/elsewhere/tool")).toBe(true);
      expect(await commandExists("/elsewhere/missing")).toBe(false);
    });

    it("handles an empty PATH gracefully", async () => {
      process.env.PATH = "";

      expect(await commandExists("anything")).toBe(false);
    });
  });

  describe("anyCommandExists", () => {
    it("returns true when at least one command exists", async () => {
      vol.mkdirSync("/test/bin", { recursive: true });
      vol.writeFileSync("/test/bin/pip3", "#!/bin/sh\n", { mode: 0o755 });

      expect(await anyCommandExists("pip-nope", "pip3")).toBe(true);
    });

    it("returns false when no command exists", async () => {
      vol.mkdirSync("/test/bin", { recursive: true });

      expect(await anyCommandExists("nope-a", "nope-b")).toBe(false);
    });
  });
});
