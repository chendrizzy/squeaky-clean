import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import cp from "child_process";
import { syncBuiltinESMExports } from "module";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { UniversalBinaryCleaner } from "../../cleaners/universalBinary";
import { acquireLock } from "../../ub/lock";
import { ensureAgentHome } from "../../ub/paths";
import { listIncomplete, writeEntry } from "../../ub/journal";
import { codesignVerify, lipoArchs, run } from "../../ub/exec";
import { buildFixtureApp, hasToolchain } from "./helpers/ubFixture";

// The cleaner's 150 s lock wait is real; the busy test shortens it here and records what was asked for.
const lockCtl = vi.hoisted(() => ({ waitOverride: undefined as number | undefined, waits: [] as number[] }));
vi.mock("../../ub/lock", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../ub/lock")>();
  return {
    ...real,
    acquireLock: (home: Parameters<typeof real.acquireLock>[0], opts: { waitMs: number; pollMs?: number }) => {
      lockCtl.waits.push(opts.waitMs);
      return real.acquireLock(home, lockCtl.waitOverride === undefined ? opts : { ...opts, waitMs: lockCtl.waitOverride });
    },
  };
});

const gate = process.platform === "darwin" && process.arch === "arm64" && hasToolchain();
const REPO = path.resolve(__dirname, "../../..");
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const MAIN = "Contents/MacOS/fixture-main";

let base: string; // whole-file temp dir
let roots: string; // the only scan root, fixed for the whole file
let home: string; // the test agent home
let tmp: string; // per-test scratch outside the roots
const savedEnv = { roots: process.env.SQUEAKY_AGENT_ROOTS, home: process.env.SQUEAKY_AGENT_HOME };

/** SAFETY (R13): clear() thins whatever scanRoots() finds. Unless it is exactly the temp roots, nothing may run. */
function assertTempRoots(): void {
  const got = new UniversalBinaryCleaner().scanRoots();
  if (got.length !== 1 || got[0] !== roots) {
    throw new Error(`SAFETY: scanRoots() is ${JSON.stringify(got)}, not the temp roots ${JSON.stringify([roots])}; refusing to run`);
  }
}

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ub-cleaner-")));
  roots = path.join(base, "roots");
  home = path.join(base, "agent");
  tmp = path.join(base, "t");
  fs.mkdirSync(roots);
  process.env.SQUEAKY_AGENT_ROOTS = roots;
  process.env.SQUEAKY_AGENT_HOME = home;
  assertTempRoots();
});
afterAll(() => {
  for (const [k, v] of [["SQUEAKY_AGENT_ROOTS", savedEnv.roots], ["SQUEAKY_AGENT_HOME", savedEnv.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe.skipIf(!gate)("UniversalBinaryCleaner (engine-backed)", () => {
  beforeEach(() => {
    for (const d of [roots, home, tmp]) fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(roots);
    fs.mkdirSync(tmp);
    process.env.SQUEAKY_AGENT_ROOTS = roots;
    process.env.SQUEAKY_AGENT_HOME = home;
    lockCtl.waitOverride = undefined;
    lockCtl.waits = [];
    assertTempRoots();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    process.env.SQUEAKY_AGENT_ROOTS = roots;
  });

  /** Builds one fixture app in a scratch dir and copies it to each destination (copies keep a valid signature). */
  const fixtureAt = async (...dests: string[]) => {
    const scratch = path.join(tmp, "build");
    fs.mkdirSync(scratch, { recursive: true });
    const f = await buildFixtureApp(scratch, { helper: true });
    for (const d of dests) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.cpSync(f.app, d, { recursive: true, verbatimSymlinks: true });
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  };

  it("scanRoots honours the test-only SQUEAKY_AGENT_ROOTS override", () => {
    process.env.SQUEAKY_AGENT_ROOTS = `${roots}:${tmp}/other`;
    expect(new UniversalBinaryCleaner().scanRoots()).toEqual([roots, `${tmp}/other`]);
  });

  it("scans nested folders to depth 3 and dedupes symlinked app by realpath", async () => {
    const x = path.join(roots, "Setapp", "X.app");
    const deep = path.join(roots, "a", "b", "c", "Deep.app");
    const tooDeep = path.join(roots, "a", "b", "c", "d", "TooDeep.app");
    const elsewhere = path.join(tmp, "elsewhere", "Y.app");
    await fixtureAt(x, deep, tooDeep, elsewhere);
    fs.symlinkSync(x, path.join(roots, "link.app"));
    fs.symlinkSync(path.dirname(elsewhere), path.join(roots, "linked-folder"));
    const cats = await new UniversalBinaryCleaner().getCacheCategories();
    expect(cats.map((c) => c.paths[0]).sort()).toEqual([x, deep, elsewhere].sort());
    expect(cats.map((c) => c.name).sort()).toEqual(["Deep", "X", "Y"]);
    for (const c of cats) expect(c.size).toBeGreaterThan(65536);
    expect(cats.find((c) => c.name === "X")!.appKey).toMatch(/^com\.squeaky\.fixture\./);
  });

  it("terminates on symlink loops and reads each real folder once", async () => {
    const x = path.join(roots, "a", "X.app");
    await fixtureAt(x);
    fs.symlinkSync(roots, path.join(roots, "loop"));
    fs.symlinkSync(path.join(roots, "a"), path.join(roots, "a", "self"));
    const readdir = vi.spyOn(fs.promises, "readdir");
    const cats = await new UniversalBinaryCleaner().getCacheCategories();
    expect(cats.map((c) => c.paths[0])).toEqual([x]);
    const reads = (d: string) => readdir.mock.calls.filter((c) => c[0] === d).length;
    expect(reads(roots)).toBe(1);
    expect(reads(path.join(roots, "a"))).toBe(1);
  });

  it("lists an app whose Info.plist is binary", async () => {
    const app = path.join(roots, "Bin.app");
    await fixtureAt(app);
    // without a spawn a bplist yields executable = bundle name, so give the fixture that layout (the common real one)
    const plist = path.join(app, "Contents", "Info.plist");
    expect((await run("/usr/bin/plutil", ["-replace", "CFBundleExecutable", "-string", "Bin", plist], 10_000)).code).toBe(0);
    fs.renameSync(path.join(app, MAIN), path.join(app, "Contents", "MacOS", "Bin"));
    expect((await run("/usr/bin/plutil", ["-convert", "binary1", plist], 10_000)).code).toBe(0);
    expect((await run("/usr/bin/codesign", ["-s", "-", "--force", "--deep", app], 120_000)).code).toBe(0);
    expect(fs.readFileSync(plist).subarray(0, 8).toString()).toBe("bplist00");
    const cats = await new UniversalBinaryCleaner().getCacheCategories();
    expect(cats).toHaveLength(1);
    expect(cats[0]).toMatchObject({ id: "universal-bin", name: "Bin", paths: [app] });
    expect(cats[0].appKey).toBeUndefined();
  });

  it("distinct ids for same-named copies", async () => {
    await fixtureAt(path.join(roots, "a", "Fx.app"), path.join(roots, "b", "Fx.app"));
    const cats = await new UniversalBinaryCleaner().getCacheCategories();
    expect(cats.map((c) => [c.id, c.paths[0]])).toEqual([
      ["universal-fx", path.join(roots, "a", "Fx.app")],
      ["universal-fx-2", path.join(roots, "b", "Fx.app")],
    ]);
  });

  it("clear() with no categories excludes a MAS-receipt fixture", async () => {
    const plain = path.join(roots, "Plain.app");
    const mas = path.join(roots, "Store.app");
    await fixtureAt(plain, mas);
    fs.mkdirSync(path.join(mas, "Contents", "_MASReceipt"));
    fs.writeFileSync(path.join(mas, "Contents", "_MASReceipt", "receipt"), "r");
    expect((await run("/usr/bin/codesign", ["-s", "-", "--force", "--deep", mas], 120_000)).code).toBe(0);
    const masBefore = sha(path.join(mas, MAIN));
    const cleaner = new UniversalBinaryCleaner();
    const cats = await cleaner.getCacheCategories();
    expect(cats.find((c) => c.paths[0] === mas)!.description).toContain("auto-ignored: mac-app-store");
    expect(cats.find((c) => c.paths[0] === plain)!.description).not.toContain("auto-ignored");
    expect(cleaner.autoIgnoredClass(cats.find((c) => c.paths[0] === mas)!.id)).toBe("mac-app-store");

    const r = await cleaner.clear(false);
    // the class-excluded app is never handed to the engine; the plain one is, under the default per-app floor
    expect(cleaner.lastOutcomes.map((o) => o.app)).toEqual([plain]);
    expect([cleaner.lastOutcomes[0].status, cleaner.lastOutcomes[0].reason]).toEqual(["skipped", "below-threshold"]);
    expect(r.error).toBe("Plain: skipped:below-threshold");
    expect(sha(path.join(mas, MAIN))).toBe(masBefore);
    expect(fs.existsSync(path.join(home, "agent.lock"))).toBe(false);
  });

  it("clear() reports heldBytes and sizeAfter === sizeBefore", async () => {
    const app = path.join(roots, "Thin Me.app");
    await fixtureAt(app);
    const cleaner = new UniversalBinaryCleaner();
    const [cat] = await cleaner.getCacheCategories();
    const r = await cleaner.clearByCategory([cat.id]);
    const [o] = cleaner.lastOutcomes;
    expect(o.status).toBe("thinned");
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.clearedPaths).toEqual([app]);
    expect(r.heldBytes).toBe(o.heldBytes);
    expect(r.heldBytes).toBeGreaterThan(2 * 65536);
    expect(r.sizeBefore).toBe(o.candidates.reduce((n, c) => n + c.size, 0));
    expect(r.sizeAfter).toBe(r.sizeBefore);
    expect(await lipoArchs(path.join(app, MAIN))).toEqual(["arm64"]);
    expect((await codesignVerify(app)).ok).toBe(true);
    // lock released, journal finished, backups held in the test agent home
    expect(fs.existsSync(path.join(home, "agent.lock"))).toBe(false);
    expect(await listIncomplete(await ensureAgentHome(), "")).toEqual([]);
    expect(fs.existsSync(path.join(o.backupDir!, MAIN))).toBe(true);
    expect(o.backupDir!.startsWith(path.join(home, "backups") + path.sep)).toBe(true);
  });

  it("clear() returns agent busy when lock is held", async () => {
    const app = path.join(roots, "Busy.app");
    await fixtureAt(app);
    const before = sha(path.join(app, MAIN));
    const held = await acquireLock(await ensureAgentHome(), { waitMs: 0 });
    expect(held).not.toBeNull();
    lockCtl.waitOverride = 0;
    const cleaner = new UniversalBinaryCleaner();
    const r = await cleaner.clearByCategory(["universal-busy"]);
    await held!.release();
    expect(r.success).toBe(false);
    expect(r.error).toBe("agent busy");
    expect(lockCtl.waits.at(-1)).toBe(150_000);
    expect(cleaner.lastOutcomes).toEqual([]);
    expect(sha(path.join(app, MAIN))).toBe(before);
  });

  it("surfaces journal recovery results in error and lastRecovery", async () => {
    const h = await ensureAgentHome();
    const gone = path.join(roots, "Gone.app"); // never created: recovery cannot reach it
    await writeEntry(h, {
      runId: "earlier-run", seq: 0, bundle: gone, bundleId: null, version: "1", build: "1",
      backupDir: path.join(h.backups, "0123456789abcdef", "1-earlier-run-0"), stagingDir: path.join(h.staging, "earlier-run-0"),
      files: [{ rel: MAIN, origIno: 1, origSize: 1, origMtimeMs: 1, thinIno: 2, thinSize: 1 }], phase: "swapping",
    });
    const cleaner = new UniversalBinaryCleaner();
    const r = await cleaner.clearByCategory([]); // explicit empty choice: recovery only, no app
    expect(cleaner.lastOutcomes).toEqual([]);
    expect(cleaner.lastRecovery.map((x) => [x.entry.bundle, x.result])).toEqual([[gone, "unreachable"]]);
    expect(r.error).toMatch(/^recovery Gone: unreachable/);
    expect(fs.existsSync(path.join(home, "agent.lock"))).toBe(false);
  });

  it("dry run estimates without lock, agent home or spawns", async () => {
    const app = path.join(roots, "Dry.app");
    await fixtureAt(app);
    const before = sha(path.join(app, MAIN));
    const spy = vi.spyOn(cp, "execFile");
    syncBuiltinESMExports();
    const cleaner = new UniversalBinaryCleaner();
    // auto: the same 5 MB per-app floor the real run applies
    const auto = await cleaner.clear(true);
    expect([cleaner.lastOutcomes[0].status, cleaner.lastOutcomes[0].reason]).toEqual(["skipped", "below-threshold"]);
    expect(auto.clearedPaths).toEqual([]);
    // explicit choice: no floor
    const [cat] = await cleaner.getCacheCategories();
    const r = await cleaner.clearByCategory([cat.id], true);
    expect(spy).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.clearedPaths).toEqual([app]);
    expect(r.heldBytes).toBe(cat.size);
    expect(r.heldBytes).toBeGreaterThan(65536);
    expect(r.sizeAfter).toBe(r.sizeBefore);
    expect(fs.existsSync(home)).toBe(false);
    expect(sha(path.join(app, MAIN))).toBe(before);
  });

  it("getCacheInfo spawns no processes", async () => {
    await fixtureAt(path.join(roots, "Quiet.app"));
    const spy = vi.spyOn(cp, "execFile");
    syncBuiltinESMExports();
    const info = await new UniversalBinaryCleaner().getCacheInfo();
    expect(spy).not.toHaveBeenCalled();
    expect(info.isInstalled).toBe(true);
    expect(info.categories).toHaveLength(1);
    expect(info.size).toBe(info.categories![0].size);
  });

  it("SIGTERM between apps: in-flight app finishes, next app untouched, no incomplete journal, no held lock", async () => {
    const a = path.join(roots, "A.app");
    const b = path.join(roots, "B.app");
    await fixtureAt(a, b);
    const bBefore = sha(path.join(b, MAIN));
    const script = path.join(tmp, "child.ts");
    fs.writeFileSync(
      script,
      `import * as fs from "fs";
import { UniversalBinaryCleaner } from ${JSON.stringify(path.join(REPO, "src/cleaners/universalBinary.ts"))};
const realRename = fs.promises.rename;
let sent = false;
// SIGTERM arrives mid-swap of the first app
fs.promises.rename = (async (from: fs.PathLike, to: fs.PathLike) => {
  await realRename(from, to);
  if (!sent && String(from).endsWith(".thin")) { sent = true; process.kill(process.pid, "SIGTERM"); }
}) as typeof fs.promises.rename;
void (async () => {
  const roots = ${JSON.stringify(roots)};
  const c = new UniversalBinaryCleaner();
  // SAFETY (R13): never hand a real app to clear(); check the roots and every category path first
  const scan = c.scanRoots();
  if (scan.length !== 1 || scan[0] !== roots) process.exit(97);
  const cats = await c.getCacheCategories();
  if (cats.length !== 2 || cats.some((x) => !x.paths.every((p) => p.startsWith(roots + "/")))) process.exit(97);
  await c.clear(false, { categories: cats.map((x) => x.id) });
  process.exit(0);
})();
`,
    );
    const r = cp.spawnSync(path.join(REPO, "node_modules/.bin/tsx"), [script], {
      cwd: REPO,
      timeout: 120_000,
      encoding: "utf8",
      env: { ...process.env, VITEST: "true", SQUEAKY_AGENT_ROOTS: roots, SQUEAKY_AGENT_HOME: home },
    });
    expect(r.status, r.stderr).toBe(143);
    expect(await lipoArchs(path.join(a, MAIN))).toEqual(["arm64"]);
    expect((await codesignVerify(a)).ok).toBe(true);
    expect(sha(path.join(b, MAIN))).toBe(bBefore);
    expect(fs.existsSync(path.join(home, "agent.lock"))).toBe(false);
    expect(await listIncomplete(await ensureAgentHome(), "")).toEqual([]);
  });
});
