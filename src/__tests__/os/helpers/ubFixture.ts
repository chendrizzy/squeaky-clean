// Real-OS fixture app builder for UB engine tests (macOS only). Builds a fat
// .app with clang and ad-hoc signs it. Builds are serial (no clang storms).
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { run } from "../../../ub/exec";

export const FIXTURE_EXE = "fixture-main";
export const FIXTURE_HELPER = "fixture-helper";
export const FIXTURE_BUNDLE_ID_PREFIX = "com.squeaky.fixture.";

const CLANG = "/usr/bin/clang";

export function hasToolchain(): boolean {
  return ["/usr/bin/clang", "/usr/bin/lipo", "/usr/bin/codesign"].every((p) =>
    fs.existsSync(p),
  );
}

let arm64eCache: boolean | undefined;
/** One-time trial compile of `clang -arch arm64e`. */
export function hasArm64eToolchain(): boolean {
  if (arm64eCache !== undefined) return arm64eCache;
  if (!hasToolchain()) return (arm64eCache = false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-ub-"));
  try {
    const src = path.join(dir, "t.c");
    fs.writeFileSync(src, "int main(void){return 0;}\n");
    cp.execFileSync(
      CLANG,
      ["-arch", "arm64e", "-o", path.join(dir, "t"), src],
      { stdio: "ignore", timeout: 60_000 },
    );
    arm64eCache = true;
  } catch {
    arm64eCache = false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return arm64eCache;
}

let counter = 0;

async function clang(args: string[]): Promise<void> {
  const r = await run(CLANG, args, 120_000);
  if (r.code !== 0) throw new Error(`clang failed: ${r.stderr}`);
}

export async function buildFixtureApp(
  dir: string,
  opts: {
    name?: string;
    helper?: boolean;
    dylib?: boolean;
    resourceBinary?: boolean;
    arm64e?: boolean;
  } = {},
): Promise<{
  app: string;
  mainExe: string;
  helper?: string;
  dylib?: string;
  resourceBin?: string;
}> {
  const n = ++counter;
  const app = path.join(dir, opts.name ?? "Squeaky Fixture ü's.app");
  const macos = path.join(app, "Contents", "MacOS");
  fs.mkdirSync(macos, { recursive: true });

  const mainC = path.join(dir, `main-${n}.c`);
  // 256 KB of initialized data per slice: thinning saves > 64 KB per file (the thinner's per-file floor)
  const pad = "char squeaky_fixture_pad[262144] = {1};\n";
  fs.writeFileSync(mainC, pad + "int main(void){return 0;}\n");
  const archs = ["-arch", "arm64", "-arch", "x86_64"];
  const mainArchs = opts.arm64e ? [...archs, "-arch", "arm64e"] : archs;

  const mainExe = path.join(macos, FIXTURE_EXE);
  await clang([...mainArchs, "-o", mainExe, mainC]);
  const res: Awaited<ReturnType<typeof buildFixtureApp>> = { app, mainExe };

  if (opts.helper) {
    res.helper = path.join(macos, FIXTURE_HELPER);
    await clang([...archs, "-o", res.helper, mainC]);
  }
  if (opts.dylib) {
    const fw = path.join(app, "Contents", "Frameworks");
    fs.mkdirSync(fw, { recursive: true });
    const libC = path.join(dir, `lib-${n}.c`);
    fs.writeFileSync(libC, pad + "int fx_value(void){return 42;}\n");
    res.dylib = path.join(fw, "libfx.dylib");
    await clang([...archs, "-dynamiclib", "-o", res.dylib, libC]);
  }
  if (opts.resourceBinary) {
    const rd = path.join(app, "Contents", "Resources");
    fs.mkdirSync(rd, { recursive: true });
    res.resourceBin = path.join(rd, "tool");
    await clang([...archs, "-o", res.resourceBin, mainC]);
  }

  fs.writeFileSync(
    path.join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>${FIXTURE_EXE}</string>
  <key>CFBundleIdentifier</key><string>${FIXTURE_BUNDLE_ID_PREFIX}${n}</string>
  <key>CFBundleName</key><string>Squeaky Fixture</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
</dict>
</plist>
`,
  );
  fs.rmSync(mainC, { force: true });

  const r = await run(
    "/usr/bin/codesign",
    ["-s", "-", "--force", "--deep", app],
    120_000,
  );
  if (r.code !== 0) throw new Error(`codesign failed: ${r.stderr}`);
  return res;
}
