import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ExecTimeoutError,
  run,
  lipoThin,
  lipoArchs,
  codesignVerify,
  processSnapshot,
} from "../../ub/exec";
import {
  buildFixtureApp,
  hasToolchain,
  hasArm64eToolchain,
} from "./helpers/ubFixture";

const d = describe.skipIf(
  !(
    process.platform === "darwin" &&
    process.arch === "arm64" &&
    hasToolchain()
  ),
);

d("exec wrappers", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(os.tmpdir() + "/sq-ub-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("fixture app verifies and its main exe is fat", async () => {
    const f = await buildFixtureApp(tmp);
    expect((await codesignVerify(f.app)).ok).toBe(true);
    expect((await lipoArchs(f.mainExe)).sort()).toEqual(["arm64", "x86_64"]);
  });

  it("lipoThin produces arm64 only, path with unicode/quote intact", async () => {
    const f = await buildFixtureApp(tmp);
    const out = path.join(tmp, "o ü's.thin");
    await lipoThin(f.mainExe, out);
    expect(await lipoArchs(out)).toEqual(["arm64"]);
  });

  it("run rejects with ExecTimeoutError", async () => {
    await expect(run("/bin/sleep", ["5"], 100)).rejects.toBeInstanceOf(
      ExecTimeoutError,
    );
  });

  it("run resolves non-zero exit codes", async () => {
    const r = await run("/usr/bin/false", [], 5000);
    expect(r.code).toBe(1);
  });

  it("run rejects with errno error on spawn failure", async () => {
    await expect(run("/nonexistent/bin", [], 5000)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  // not this node's own path: vitest workers retitle themselves "node (vitest N)", so ps never lists it
  it("processSnapshot lists a child this test started by absolute path", async () => {
    const child = cp.execFile("/bin/sleep", ["30"]);
    try {
      await new Promise((resolve, reject) =>
        child.once("spawn", resolve).once("error", reject),
      );
      expect((await processSnapshot()).has("/bin/sleep")).toBe(true);
    } finally {
      child.kill();
    }
  });

  it("fixture builder produces helper, dylib and resource when requested", async () => {
    const f = await buildFixtureApp(tmp, {
      helper: true,
      dylib: true,
      resourceBinary: true,
    });
    for (const p of [f.helper!, f.dylib!, f.resourceBin!]) {
      expect((await lipoArchs(p)).sort()).toEqual(["arm64", "x86_64"]);
    }
    expect((await codesignVerify(f.app)).ok).toBe(true);
  });

  it.skipIf(!hasArm64eToolchain())(
    "arm64e option adds an arm64e slice",
    async () => {
      const f = await buildFixtureApp(tmp, { arm64e: true });
      expect(await lipoArchs(f.mainExe)).toContain("arm64e");
    },
  );
});
