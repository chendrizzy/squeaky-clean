import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadSeal, classifyFile } from "../../ub/seal";
import { buildFixtureApp, hasToolchain } from "./helpers/ubFixture";

const d = describe.skipIf(
  !(
    process.platform === "darwin" &&
    process.arch === "arm64" &&
    hasToolchain()
  ),
);

d("real seal", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(os.tmpdir() + "/sq-ub-");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("fixture helper and dylib are cdhash-nested; resource is data-sealed", async () => {
    const f = await buildFixtureApp(tmp, {
      helper: true,
      dylib: true,
      resourceBinary: true,
    });
    const s = (await loadSeal(fs.realpathSync(f.app)))!;
    expect(s).not.toBeNull();
    const main = "MacOS/" + path.basename(f.mainExe);
    expect(classifyFile(s, main, main)).toBe("main");
    expect(classifyFile(s, "MacOS/fixture-helper", main)).toBe("cdhash-nested");
    expect(classifyFile(s, "Frameworks/libfx.dylib", main)).toBe(
      "cdhash-nested",
    );
    expect(classifyFile(s, "Resources/tool", main)).toBe("data-sealed");
  });
});
