import { describe, it, expect } from "vitest";
import { vol } from "memfs";
import { classifyApp, probeApp } from "../../ub/policy";
import type { BundleInfo } from "../../ub/bundle";

const info = (bundleId: string | null): BundleInfo => ({
  appPath: "/x/A.app",
  realpath: "/x/A.app",
  bundleId,
  version: "1",
  build: "1",
  executable: "A",
  name: "A",
});
const none = { hasMasReceipt: false, frameworkNames: [] as string[] };

describe("classifyApp", () => {
  it.each([
    ["com.example.app", { hasMasReceipt: true, frameworkNames: [] }, "mac-app-store"],
    ["com.apple.Safari", none, "apple"],
    ["com.google.Chrome.beta", none, "chrome"],
    ["com.microsoft.Word", none, "microsoft"],
    ["com.adobe.Photoshop", none, "adobe"],
    ["com.paceap.eden", none, "ilok-pace"],
    ["com.example.daw", { hasMasReceipt: false, frameworkNames: ["iLokFoo.framework"] }, "ilok-pace"],
    ["com.example.daw", { hasMasReceipt: false, frameworkNames: ["PACE.framework"] }, "ilok-pace"],
  ] as const)("%s -> %s", (id, probe, cls) => {
    expect(classifyApp(info(id), { ...probe, frameworkNames: [...probe.frameworkNames] })).toEqual({ cls });
  });

  it("returns null for an unrelated app", () => {
    expect(classifyApp(info("com.tinyspeck.slackmacgap"), none)).toBeNull();
  });

  it("null bundleId: MAS receipt and framework rule only", () => {
    expect(classifyApp(info(null), { hasMasReceipt: true, frameworkNames: [] })).toEqual({ cls: "mac-app-store" });
    expect(classifyApp(info(null), { hasMasReceipt: false, frameworkNames: ["x.ilok"] })).toEqual({ cls: "ilok-pace" });
    expect(classifyApp(info(null), none)).toBeNull();
  });
});

describe("probeApp", () => {
  it("reads receipt and framework names", async () => {
    vol.fromJSON({
      "/a/A.app/Contents/_MASReceipt/receipt": "r",
      "/a/A.app/Contents/Frameworks/Foo.framework/x": "x",
      "/a/A.app/Contents/Frameworks/libz.dylib": "x",
    });
    const r = await probeApp("/a/A.app");
    expect(r.hasMasReceipt).toBe(true);
    expect(r.frameworkNames.sort()).toEqual(["Foo.framework", "libz.dylib"]);
  });

  it("missing receipt and Frameworks dir", async () => {
    vol.fromJSON({ "/a/B.app/Contents/Info.plist": "x" });
    expect(await probeApp("/a/B.app")).toEqual({ hasMasReceipt: false, frameworkNames: [] });
  });
});
