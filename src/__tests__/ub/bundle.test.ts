import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import { vol } from "memfs";
import {
  readMachOSlices,
  classifySlices,
  readBundleInfo,
  type Slice,
} from "../../ub/bundle";

function fat(entries: Array<[number, number]>, magic = 0xcafebabe): Buffer {
  const size = magic === 0xcafebabf ? 32 : 20;
  const b = Buffer.alloc(8 + entries.length * size);
  b.writeUInt32BE(magic, 0);
  b.writeUInt32BE(entries.length, 4);
  entries.forEach(([t, s], i) => {
    b.writeUInt32BE(t >>> 0, 8 + i * size);
    b.writeUInt32BE(s >>> 0, 12 + i * size);
  });
  return b;
}

function thin64(cputype: number, sub: number): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(cputype >>> 0, 4);
  b.writeUInt32LE(sub >>> 0, 8);
  return b;
}

const xmlPlist = (d: Record<string, string>): string =>
  `<?xml version="1.0"?><plist version="1.0"><dict>${Object.entries(d)
    .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
    .join("")}</dict></plist>`;

describe("readMachOSlices", () => {
  it("reads fat arm64+x86_64", async () => {
    vol.fromJSON({ "/b": fat([[0x0100000c, 0], [0x01000007, 3]]) });
    expect((await readMachOSlices("/b")).map((s) => s.arch)).toEqual([
      "arm64",
      "x86_64",
    ]);
  });

  it("distinguishes arm64e by cpusubtype (masking capability bits)", async () => {
    vol.fromJSON({ "/b": fat([[0x0100000c, 0x80000002], [0x01000007, 3]]) });
    const s = await readMachOSlices("/b");
    expect(s[0]).toEqual({ arch: "arm64e", cputype: 0x0100000c, cpusubtype: 2 });
    expect(s[1].cpusubtype).toBe(3);
  });

  it("reads fat64 headers (32-byte entries)", async () => {
    vol.fromJSON({
      "/b": fat([[0x0100000c, 0], [0x01000007, 3]], 0xcafebabf),
    });
    expect((await readMachOSlices("/b")).map((s) => s.arch)).toEqual([
      "arm64",
      "x86_64",
    ]);
  });

  it("reads thin little-endian Mach-O", async () => {
    vol.fromJSON({ "/t": thin64(0x0100000c, 0) });
    expect(await readMachOSlices("/t")).toEqual([
      { arch: "arm64", cputype: 0x0100000c, cpusubtype: 0 },
    ]);
  });

  it("maps unknown cputypes to other and i386", async () => {
    vol.fromJSON({ "/b": fat([[7, 3], [0x12, 0]]) });
    expect((await readMachOSlices("/b")).map((s) => s.arch)).toEqual([
      "i386",
      "other",
    ]);
  });

  it("returns [] for Java class files sharing CAFEBABE", async () => {
    vol.fromJSON({
      "/c": Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34]),
    });
    expect(await readMachOSlices("/c")).toEqual([]);
  });

  it("returns [] for text, tiny and missing files", async () => {
    vol.fromJSON({ "/s": "#!/bin/sh\necho hi\n", "/tiny": "ab" });
    expect(await readMachOSlices("/s")).toEqual([]);
    expect(await readMachOSlices("/tiny")).toEqual([]);
    expect(await readMachOSlices("/nope")).toEqual([]);
  });

  it("never opens a dataless (offloaded) file: no blocks but a nonzero size (T11-R6)", async () => {
    // memfs reports blocks: 1 for every file, so only this mocked stat is dataless
    vol.fromJSON({ "/b": fat([[0x0100000c, 0], [0x01000007, 3]]) });
    const open = vi.spyOn(fs.promises, "open");
    vi.spyOn(fs.promises, "stat").mockResolvedValueOnce({ blocks: 0, size: 4096 } as never);
    try {
      expect(await readMachOSlices("/b")).toEqual([]);
      expect(open).not.toHaveBeenCalled();
      // positive control: the same file with its data on disk is opened and read
      expect((await readMachOSlices("/b")).map((s) => s.arch)).toEqual(["arm64", "x86_64"]);
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("classifySlices", () => {
  it.each([
    [["arm64", "x86_64"], { thinnable: true }],
    [["arm64", "x86_64", "i386"], { thinnable: true }],
    [["arm64e", "x86_64"], { thinnable: false, reason: "other-slice" }],
    [["arm64", "x86_64", "arm64e"], { thinnable: false, reason: "other-slice" }],
    [["arm64", "x86_64", "other"], { thinnable: false, reason: "other-slice" }],
    [["x86_64", "i386"], { thinnable: false, reason: "no-arm64" }],
    [["arm64", "i386"], { thinnable: false, reason: "no-x86" }],
    [["arm64"], { thinnable: false, reason: "not-universal" }],
    [[], { thinnable: false, reason: "not-mach-o" }],
  ])("classifySlices(%j)", (archs, expected) => {
    expect(
      classifySlices(
        archs.map((a) => ({ arch: a, cputype: 0, cpusubtype: 0 })) as Slice[],
      ),
    ).toEqual(expected);
  });
});

describe("readBundleInfo", () => {
  it("reads id, version, build, executable and name", async () => {
    vol.fromJSON({
      "/Apps/Foo.app/Contents/Info.plist": xmlPlist({
        CFBundleExecutable: "foo-bin",
        CFBundleIdentifier: "com.ex.foo",
        CFBundleShortVersionString: "1.2",
        CFBundleVersion: "42",
      }),
    });
    expect(await readBundleInfo("/Apps/Foo.app", { allowSpawn: false })).toEqual({
      appPath: "/Apps/Foo.app",
      realpath: "/Apps/Foo.app",
      bundleId: "com.ex.foo",
      version: "1.2",
      build: "42",
      executable: "foo-bin",
      name: "Foo",
    });
  });

  it("defaults version/build to empty and bundleId to null", async () => {
    vol.fromJSON({
      "/A.app/Contents/Info.plist": xmlPlist({ CFBundleExecutable: "A" }),
    });
    expect(await readBundleInfo("/A.app", { allowSpawn: false })).toMatchObject({
      bundleId: null,
      version: "",
      build: "",
    });
  });

  it.each(["../evil", "a/b", ".", ".."])(
    "rejects CFBundleExecutable %j",
    async (exe) => {
      vol.fromJSON({
        "/A.app/Contents/Info.plist": xmlPlist({
          CFBundleExecutable: exe,
          CFBundleIdentifier: "x",
        }),
      });
      expect(await readBundleInfo("/A.app", { allowSpawn: false })).toBeNull();
    },
  );

  it("returns null when CFBundleExecutable is missing or non-string", async () => {
    vol.fromJSON({
      "/A.app/Contents/Info.plist": xmlPlist({ CFBundleIdentifier: "x" }),
      "/B.app/Contents/Info.plist":
        "<plist><dict><key>CFBundleExecutable</key><integer>1</integer></dict></plist>",
    });
    expect(await readBundleInfo("/A.app", { allowSpawn: false })).toBeNull();
    expect(await readBundleInfo("/B.app", { allowSpawn: false })).toBeNull();
  });

  it("ignores inherited keys such as __proto__ / prototype pollution", async () => {
    vol.fromJSON({
      "/A.app/Contents/Info.plist":
        "<plist><dict><key>__proto__</key><dict><key>CFBundleExecutable</key><string>evil</string></dict></dict></plist>",
    });
    expect(await readBundleInfo("/A.app", { allowSpawn: false })).toBeNull();
  });

  it("falls back on binary Info.plist without spawning", async () => {
    vol.fromJSON({ "/My App.app/Contents/Info.plist": "bplist00garbage" });
    expect(
      await readBundleInfo("/My App.app", { allowSpawn: false }),
    ).toMatchObject({ bundleId: null, executable: "My App", name: "My App" });
  });

  it("returns null when Info.plist is missing or malformed", async () => {
    vol.fromJSON({ "/M.app/Contents/Info.plist": "<plist><dict>" });
    expect(await readBundleInfo("/M.app", { allowSpawn: false })).toBeNull();
    expect(await readBundleInfo("/none.app", { allowSpawn: false })).toBeNull();
  });
});
