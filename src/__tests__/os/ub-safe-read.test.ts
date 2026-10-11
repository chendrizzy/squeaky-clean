import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readPlistFile, PlistParseError, PLIST_MAX_BYTES } from "../../ub/plist";
import { readBundleInfo, readMachOSlices } from "../../ub/bundle";
import { loadSeal } from "../../ub/seal";

// Info.plist, the main executable and CodeResources are opened by path from untrusted bundles (c1, c6, c7).
// A plain open(2) of a FIFO with no writer blocks forever in a libuv thread, so every wait here is bounded, and
// afterEach opens each FIFO for writing, which releases a reader stuck in open (a RED run must not leak threads).
const d = describe.skipIf(process.platform !== "darwin");

const PLIST = `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>X</string></dict></plist>`;
const settles = <T>(p: Promise<T>) =>
  Promise.race([
    p.then((value) => ({ value }), (error: unknown) => ({ error })),
    new Promise<"hung">((r) => setTimeout(() => r("hung"), 2000)),
  ]);

d("untrusted bundle files are read only when they are regular files", () => {
  let tmp: string;
  let app: string;
  let fifos: string[] = [];
  const at = (rel: string) => path.join(app, "Contents", rel);

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ub-safe-read-")));
    app = path.join(tmp, "X.app");
    for (const dir of ["MacOS", "_CodeSignature"]) fs.mkdirSync(at(dir), { recursive: true });
    fs.writeFileSync(at("Info.plist"), PLIST);
  });
  afterEach(() => {
    for (const f of fifos) {
      try {
        fs.closeSync(fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK));
      } catch {
        // ENXIO: no reader is waiting, nothing to release
      }
    }
    fifos = [];
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const mkfifo = (p: string) => {
    fs.rmSync(p, { force: true });
    cp.execFileSync("/usr/bin/mkfifo", [p]);
    fifos.push(p);
  };

  it("a FIFO at Info.plist is refused within 2 s; the bundle reads as unreadable", async () => {
    mkfifo(at("Info.plist"));
    const r = await settles(readPlistFile(at("Info.plist"), { allowSpawn: true }));
    expect(r).not.toBe("hung");
    expect((r as { error: unknown }).error).toBeInstanceOf(PlistParseError);
    expect(String((r as { error: unknown }).error)).toMatch(/not a regular file/);
    expect(await settles(readBundleInfo(app, { allowSpawn: false }))).toEqual({ value: null });
  });

  it("a FIFO as the main executable reads as no slices within 2 s", async () => {
    mkfifo(at("MacOS/X"));
    expect(await settles(readMachOSlices(at("MacOS/X")))).toEqual({ value: [] });
  });

  it("a FIFO at CodeResources reads as no seal within 2 s", async () => {
    mkfifo(at("_CodeSignature/CodeResources"));
    expect(await settles(loadSeal(app))).toEqual({ value: null });
  });

  it("a symlink to /dev/zero is refused, never read", async () => {
    fs.rmSync(at("Info.plist"));
    fs.symlinkSync("/dev/zero", at("Info.plist"));
    fs.symlinkSync("/dev/zero", at("MacOS/X"));
    const r = await settles(readPlistFile(at("Info.plist"), { allowSpawn: false }));
    expect(String((r as { error: unknown }).error)).toMatch(/PlistParseError: not a regular file/);
    expect(await settles(readMachOSlices(at("MacOS/X")))).toEqual({ value: [] });
  });

  it("a file over the plist cap is refused; a symlink to a regular plist is still read", async () => {
    fs.truncateSync(at("Info.plist"), PLIST_MAX_BYTES + 1);
    const r = await settles(readPlistFile(at("Info.plist"), { allowSpawn: false }));
    expect(String((r as { error: unknown }).error)).toMatch(/PlistParseError: larger than 16777216 bytes/);

    const real = path.join(tmp, "real.plist");
    fs.writeFileSync(real, PLIST);
    fs.rmSync(at("Info.plist"));
    fs.symlinkSync(real, at("Info.plist"));
    expect((await readBundleInfo(app, { allowSpawn: false }))?.executable).toBe("X");
  });
});
