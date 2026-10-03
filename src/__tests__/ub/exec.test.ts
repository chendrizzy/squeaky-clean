import { describe, it, expect, vi, afterEach } from "vitest";
import cp from "child_process";
import { syncBuiltinESMExports } from "module";
import { lipoThin, processSnapshot } from "../../ub/exec";

type Cb = (err: unknown, stdout: string, stderr: string) => void;
/** Make the next execFile call finish with the given exit code / output (R3a spy pattern). */
const fake = (code: number, stdout: string, stderr: string) => {
  vi.spyOn(cp, "execFile").mockImplementation(((...a: unknown[]) => {
    const cb = a[a.length - 1] as Cb;
    cb(code === 0 ? null : Object.assign(new Error("exit"), { code }), stdout, stderr);
    return {} as cp.ChildProcess;
  }) as unknown as typeof cp.execFile);
  syncBuiltinESMExports();
};

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
});

describe("processSnapshot never fails open", () => {
  it("returns absolute-path processes", async () => {
    fake(0, "/sbin/launchd\n-zsh\n  /usr/bin/foo \n", "");
    expect([...(await processSnapshot())].sort()).toEqual(["/sbin/launchd", "/usr/bin/foo"]);
  });
  it("throws when ps exits non-zero", async () => {
    fake(1, "/sbin/launchd\n", "ps: boom");
    await expect(processSnapshot()).rejects.toThrow(/ps/);
  });
  it("throws when ps yields zero absolute-path processes", async () => {
    fake(0, "-zsh\nfoo\n", "");
    await expect(processSnapshot()).rejects.toThrow(/ps/);
  });
});

describe("lipoThin", () => {
  it("maps 'No space left on device' to an ENOSPC error", async () => {
    fake(1, "", "fatal error: lipo: can't write output file: No space left on device");
    await expect(lipoThin("/a", "/b")).rejects.toMatchObject({ code: "ENOSPC" });
  });
  it("leaves other lipo failures without a code", async () => {
    fake(1, "", "fatal error: lipo: bad input");
    const err = await lipoThin("/a", "/b").catch((e: unknown) => e as NodeJS.ErrnoException);
    expect(err.code).toBeUndefined();
  });
});
