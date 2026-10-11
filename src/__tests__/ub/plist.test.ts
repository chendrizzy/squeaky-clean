import { describe, it, expect, vi, afterEach } from "vitest";
import cp from "child_process";
import { syncBuiltinESMExports } from "module";
import { vol } from "memfs";
import { parseXmlPlist, readPlistFile, PlistParseError } from "../../ub/plist";

describe("parseXmlPlist", () => {
  it("parses dict/array/string/integer/true/false/data/date", () => {
    const v = parseXmlPlist(`<?xml version="1.0"?><plist version="1.0"><dict>
    <key>CFBundleIdentifier</key><string>com.ex.app</string>
    <key>n</key><integer>42</integer><key>t</key><true/><key>f</key><false/>
    <key>a</key><array><string>x</string></array>
    <key>d</key><data>
      AAEC
    </data><key>dt</key><date>2026-01-01T00:00:00Z</date></dict></plist>`);
    expect(v).toEqual({
      CFBundleIdentifier: "com.ex.app",
      n: 42,
      t: true,
      f: false,
      a: ["x"],
      d: "AAEC",
      dt: "2026-01-01T00:00:00Z",
    });
  });

  it("decodes XML entities in strings and keys", () => {
    expect(
      parseXmlPlist(
        `<plist><dict><key>a&amp;b</key><string>&lt;x&gt; &quot;q&quot; &apos;</string></dict></plist>`,
      ),
    ).toEqual({ "a&b": `<x> "q" '` });
  });

  it("handles empty <string/> and <dict/>", () => {
    expect(
      parseXmlPlist(
        `<plist><dict><key>e</key><string/><key>d</key><dict/></dict></plist>`,
      ),
    ).toEqual({ e: "", d: {} });
  });

  it("throws PlistParseError on unbalanced tags", () => {
    expect(() => parseXmlPlist(`<plist><dict><key>a</key></plist>`)).toThrow(
      PlistParseError,
    );
  });

  it("skips comments and DOCTYPE, parses real, rejects unknown tags", () => {
    expect(
      parseXmlPlist(
        `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "x"><!-- hi --><plist><dict><key>r</key><real>1.5</real></dict></plist>`,
      ),
    ).toEqual({ r: 1.5 });
    expect(() => parseXmlPlist(`<plist><bogus/></plist>`)).toThrow(
      PlistParseError,
    );
  });
});

describe("parseXmlPlist on hostile input (c5)", () => {
  it("1 MB of unterminated comments throws in under 1 s", () => {
    const xml = "<!-- a\n".repeat(Math.ceil((1024 * 1024) / 7));
    const t = performance.now();
    expect(() => parseXmlPlist(xml)).toThrow(
      new PlistParseError("unterminated comment"),
    );
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it("an unterminated tag or CDATA section throws", () => {
    expect(() => parseXmlPlist(`<plist><dict/></plist><`)).toThrow(
      new PlistParseError("unterminated tag"),
    );
    expect(() =>
      parseXmlPlist(`<plist><string><![CDATA[x</string></plist>`),
    ).toThrow(new PlistParseError("unterminated CDATA"));
  });
});

describe("parseXmlPlist prototype safety", () => {
  it("treats a __proto__ key as an ordinary own key", () => {
    const v = parseXmlPlist(
      `<plist><dict><key>__proto__</key><dict><key>x</key><string>y</string></dict></dict></plist>`,
    ) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(v, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(v)).toBeNull();
    expect(Object.getPrototypeOf(v["__proto__"])).toBeNull();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("readPlistFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
  });

  it("wraps plutil spawn failures in PlistParseError", async () => {
    vol.fromJSON({ "/x/Info.plist": "bplist00garbage" });
    const spy = vi.spyOn(cp, "execFile").mockImplementation(((
      ...a: unknown[]
    ) => {
      (a[a.length - 1] as (e: Error) => void)(new Error("boom"));
      return {} as cp.ChildProcess;
    }) as unknown as typeof cp.execFile);
    syncBuiltinESMExports();
    await expect(
      readPlistFile("/x/Info.plist", { allowSpawn: true }),
    ).rejects.toBeInstanceOf(PlistParseError);
    expect(spy.mock.calls[0][0]).toBe("/usr/bin/plutil"); // absolute, like lipo/codesign/ps: PATH is never consulted (R7)
    expect(spy.mock.calls[0][1]).toEqual([
      "-convert",
      "json",
      "-o",
      "-",
      "/x/Info.plist",
    ]);
    expect(spy.mock.calls[0][2]).toMatchObject({ timeout: 10000 });
  });

  it("returns null for bplist when spawning is not allowed", async () => {
    vol.fromJSON({ "/x/Info.plist": "bplist00garbage" });
    expect(
      await readPlistFile("/x/Info.plist", { allowSpawn: false }),
    ).toBeNull();
  });

  it("parses an XML plist file", async () => {
    vol.fromJSON({
      "/x/Info.plist": `<plist><dict><key>a</key><string>b</string></dict></plist>`,
    });
    expect(await readPlistFile("/x/Info.plist", { allowSpawn: false })).toEqual(
      { a: "b" },
    );
  });
});
