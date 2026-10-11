import { describe, it, expect, vi } from "vitest";
import { vol } from "memfs";
import { parseXmlPlist } from "../../ub/plist";
import { sealFromPlist, loadSeal, classifyFile } from "../../ub/seal";

const NESTED =
  "^(Frameworks|SharedFrameworks|PlugIns|Plug-ins|XPCServices|Helpers|MacOS|Library/(Automator|Spotlight|LoginItems))/";

function sealFrom(o: {
  files2: Record<string, unknown>;
  rules2: Record<string, unknown>;
}) {
  return sealFromPlist({ files2: o.files2, rules2: o.rules2 } as never)!;
}

const seal = sealFrom({
  files2: {
    "MacOS/helper": { cdhash: "AA", requirement: "x" },
    "Frameworks/libfx.dylib": { cdhash: "BB" },
    "Resources/tool": { hash2: "CC" },
    "PlugIns/x.dylib": { cdhash: "DD" },
    "Resources/legacy": { hash: "EE" },
    "Resources/str": "FF",
    "MacOS/badcd": { cdhash: 5, hash2: "GG" },
    "MacOS/arr": ["cdhash"],
  },
  rules2: {
    [NESTED]: { nested: true, weight: 10 },
    "^Resources/": { weight: 20 },
    "^(": { nested: true },
  },
});

describe("classifyFile", () => {
  it.each([
    ["MacOS/App", "main"],
    ["MacOS/helper", "cdhash-nested"],
    ["Frameworks/libfx.dylib", "cdhash-nested"],
    ["Resources/tool", "data-sealed"],
    ["Resources/legacy", "data-sealed"],
    ["Resources/str", "data-sealed"],
    ["PlugIns/x.dylib", "unsealed"],
    ["Library/SystemExtensions/e.systemextension/Contents/MacOS/e", "excluded"],
    ["MacOS/unknown", "unsealed"],
    ["MacOS/badcd", "data-sealed"],
    ["MacOS/arr", "unsealed"],
  ])("classifyFile(%s) = %s", (rel, cls) =>
    expect(classifyFile(seal, rel, "MacOS/App")).toBe(cls),
  );

  it("main wins even without a files2 entry; excluded beats main-less sealed", () => {
    expect(classifyFile(seal, "MacOS/nope", "MacOS/nope")).toBe("main");
  });

  it("never compiles a rules2 key (bundle-supplied regex, R9); classification does not depend on rules2", () => {
    const EVIL = "(a+)+$";
    const spy = vi.spyOn(globalThis, "RegExp");
    try {
      const s = sealFrom({
        files2: { "MacOS/h": { cdhash: "AA" } },
        rules2: { [EVIL]: { nested: true }, "^(": { nested: true } },
      });
      expect(classifyFile(s, "MacOS/h", "MacOS/App")).toBe("cdhash-nested");
      expect(
        spy.mock.calls.filter((c) => c[0] === EVIL || c[0] === "^("),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    const bare = sealFromPlist({
      files2: { "MacOS/h": { cdhash: "AA" }, "PlugIns/p": { cdhash: "BB" } },
    } as never)!;
    expect(classifyFile(bare, "MacOS/h", "MacOS/App")).toBe("cdhash-nested");
    expect(classifyFile(bare, "PlugIns/p", "MacOS/App")).toBe("unsealed");
  });

  it("a __proto__ key in files2 never makes an unlisted path cdhash-nested", () => {
    const plist = parseXmlPlist(`<plist><dict>
      <key>files2</key><dict><key>__proto__</key><dict><key>cdhash</key><string>AA</string></dict></dict>
      <key>rules2</key><dict><key>${NESTED}</key><dict><key>nested</key><true/></dict></dict>
    </dict></plist>`);
    const s = sealFromPlist(plist)!;
    expect(classifyFile(s, "MacOS/unlisted", "MacOS/App")).toBe("unsealed");
    expect(classifyFile(s, "__proto__", "MacOS/App")).toBe("unsealed");
    // hand-built seal with a normal prototype chain is also safe
    const polluted = { files2: Object.create({ "MacOS/x": { cdhash: "A" } }) };
    expect(classifyFile(polluted, "MacOS/x", "MacOS/App")).toBe("unsealed");
  });
});

describe("loadSeal", () => {
  const p = "/b.app/Contents/_CodeSignature/CodeResources";
  it("returns null when missing", async () => {
    vol.fromJSON({ "/b.app/Contents/x": "" });
    expect(await loadSeal("/b.app")).toBeNull();
  });
  it("returns null for malformed XML / non-dict / missing files2", async () => {
    vol.fromJSON({ [p]: "<plist><dict><key>files2</key>" });
    expect(await loadSeal("/b.app")).toBeNull();
    vol.reset();
    vol.fromJSON({ [p]: "<plist><array/></plist>" });
    expect(await loadSeal("/b.app")).toBeNull();
    vol.reset();
    vol.fromJSON({
      [p]: "<plist><dict><key>a</key><string>b</string></dict></plist>",
    });
    expect(await loadSeal("/b.app")).toBeNull();
  });
  it("returns null for binary plist (never spawns)", async () => {
    vol.fromJSON({ [p]: "bplist00x" });
    expect(await loadSeal("/b.app")).toBeNull();
  });
  it("parses a valid file", async () => {
    vol.fromJSON({
      [p]: `<plist><dict><key>files2</key><dict><key>MacOS/h</key><dict><key>cdhash</key><data>AA==</data></dict></dict>
      <key>rules2</key><dict><key>^MacOS/</key><dict><key>nested</key><true/></dict></dict></dict></plist>`,
    });
    const s = (await loadSeal("/b.app"))!;
    expect(classifyFile(s, "MacOS/h", "MacOS/m")).toBe("cdhash-nested");
  });
});
