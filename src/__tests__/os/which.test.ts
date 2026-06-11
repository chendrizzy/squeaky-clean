// Real-filesystem OS-behavior tests for executable discovery. No mocks: this
// scans the real PATH. On Windows it exercises real PATHEXT resolution
// (node.exe found for the bare name "node"), validating the PATHEXT parsing
// and the isFile() guard on the actual platform.
import { describe, it, expect } from "vitest";
import * as os from "os";
import { commandExists, anyCommandExists } from "../../utils/which";

describe(`commandExists (real PATH, ${os.platform()})`, () => {
  it("finds node on the real PATH", async () => {
    // The test runner is node, so node is guaranteed to be on PATH. On Windows
    // this only resolves if PATHEXT (.EXE) is applied to the bare name.
    expect(await commandExists("node")).toBe(true);
  });

  it("does not find a command that cannot exist", async () => {
    expect(
      await commandExists("squeaky-definitely-not-a-real-binary-zzz"),
    ).toBe(false);
  });

  it("does not treat a bare name with no match as present", async () => {
    expect(await commandExists("zzz-no-such-tool-12345")).toBe(false);
  });

  it("anyCommandExists returns true when at least one command resolves", async () => {
    expect(await anyCommandExists("squeaky-nope-aaa", "node")).toBe(true);
  });

  it("anyCommandExists returns false when none resolve", async () => {
    expect(await anyCommandExists("squeaky-nope-aaa", "squeaky-nope-bbb")).toBe(
      false,
    );
  });
});
