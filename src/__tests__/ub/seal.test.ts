import { describe, it, expect } from "vitest";
import { vol } from "memfs";
import { parseXmlPlist } from "../../ub/plist";
import { sealFromPlist, loadSeal, classifyFile } from "../../ub/seal";

const NESTED =
  "^(Frameworks|SharedFrameworks|PlugIns|Plug-ins|XPCServices|Helpers|MacOS|Library/(Automator|Spotlight|LoginItems))/";

function sealFrom(o: { files2: Record<string, unknown>; rules2: Record<string, unknown> }) {
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
    expect(classifyFile(seal, rel, "MacOS/App")).toBe(cls));

  it("main wins even without a files2 entry; excluded beats main-less sealed", () => {
    expect(classifyFile(seal, "MacOS/nope", "MacOS/nope")).toBe("main");
  });

  it("skips non-compiling rule keys and non-nested/boolean rules", () => {
    expect(seal.nestedRules).toHaveLength(1);
    const s = sealFrom({ files2: {}, rules2: { "^a/": true, "^b/": { nested: "yes" } } });
    expect(s.nestedRules).toHaveLength(0);
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
    const polluted = { files2: Object.create({ "MacOS/x": { cdhash: "A" } }), nestedRules: [/^MacOS\//] };
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
    vol.fromJSON({ [p]: "<plist><dict><key>a</key><string>b</string></dict></plist>" });
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
