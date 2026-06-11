// Real-filesystem OS-behavior tests. These run WITHOUT the global memfs/os
// mocks (see vitest.os.config.ts: no setupFiles), so they exercise the actual
// `du` path on macOS/Linux and the JS Dirent-walker on Windows.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { getDirectorySize, getCachedDirectorySize } from "../../utils/fs";

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sq-os-size-"));
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe(`getDirectorySize (real filesystem, ${os.platform()})`, () => {
  it("sizes a flat directory of known files", async () => {
    const d = path.join(tmp, "flat");
    await fs.mkdir(d);
    await fs.writeFile(path.join(d, "a.bin"), Buffer.alloc(4096));
    await fs.writeFile(path.join(d, "b.bin"), Buffer.alloc(8192));

    const size = await getDirectorySize(d);
    // du reports disk-usage blocks (>= apparent bytes); the walker reports
    // apparent bytes. Both must be at least the content we wrote.
    expect(size).toBeGreaterThanOrEqual(4096 + 8192);
    // Sanity upper bound so a bug returning a wild number is caught.
    expect(size).toBeLessThan((4096 + 8192) * 16);
  });

  it("includes nested subdirectories", async () => {
    const d = path.join(tmp, "nested");
    await fs.mkdir(path.join(d, "sub", "deeper"), { recursive: true });
    await fs.writeFile(path.join(d, "top.bin"), Buffer.alloc(2048));
    await fs.writeFile(path.join(d, "sub", "mid.bin"), Buffer.alloc(4096));
    await fs.writeFile(
      path.join(d, "sub", "deeper", "low.bin"),
      Buffer.alloc(8192),
    );

    const size = await getDirectorySize(d);
    expect(size).toBeGreaterThanOrEqual(2048 + 4096 + 8192);
  });

  it("returns the exact file size when given a file path", async () => {
    const f = path.join(tmp, "single.bin");
    await fs.writeFile(f, Buffer.alloc(1234));
    expect(await getDirectorySize(f)).toBe(1234);
  });

  it("handles an empty directory without error", async () => {
    const d = path.join(tmp, "empty");
    await fs.mkdir(d);
    const size = await getDirectorySize(d);
    // May be 0 or the directory's own block depending on the filesystem; it
    // must never be large or negative.
    expect(size).toBeGreaterThanOrEqual(0);
    expect(size).toBeLessThan(256 * 1024);
  });

  it("returns 0 for a non-existent path", async () => {
    expect(await getDirectorySize(path.join(tmp, "does-not-exist"))).toBe(0);
  });

  it("caches repeated sizing of the same path", async () => {
    const d = path.join(tmp, "cached");
    await fs.mkdir(d);
    await fs.writeFile(path.join(d, "x.bin"), Buffer.alloc(16384));
    const first = await getCachedDirectorySize(d);
    const second = await getCachedDirectorySize(d);
    expect(second).toBe(first);
    expect(first).toBeGreaterThanOrEqual(16384);
  });
});
