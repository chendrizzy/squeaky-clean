import { describe, it, expect } from "vitest";
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

describe("readPlistFile", () => {
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
