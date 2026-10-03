import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { thinBundle, type ThinDeps } from "../../ub/thinner";
import { listIncomplete } from "../../ub/journal";
import { recoverJournal } from "../../ub/restore";
import type { AgentHome } from "../../ub/paths";
import { codesignVerify, lipoArchs } from "../../ub/exec";
import { buildFixtureApp, hasArm64eToolchain, hasToolchain } from "./helpers/ubFixture";

const gate = process.platform === "darwin" && process.arch === "arm64" && hasToolchain();
const REPO = path.resolve(__dirname, "../../..");
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const listDirRecursive = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? [p, ...listDirRecursive(p)] : [p];
  });

describe.skipIf(!gate)("ub thinner", () => {
  let tmp: string;
  let apps: string;
  let h: AgentHome;
  let seq = 0;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ub-thinner-")));
    h = { home: path.join(tmp, "agent"), staging: path.join(tmp, "agent", "staging"), backups: path.join(tmp, "agent", "backups"), journal: path.join(tmp, "agent", "journal") };
    for (const d of [h.staging, h.backups, h.journal]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    apps = path.join(tmp, "apps");
    fs.mkdirSync(apps);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ctx = (o: { dryRun?: boolean; minSavingsBytes?: number; deps?: ThinDeps } = {}) => ({ home: h, runId: "run1", seq: seq++, minSavingsBytes: 0, ...o });
  const agentEmpty = () => {
    expect(fs.readdirSync(h.staging)).toEqual([]);
    expect(fs.readdirSync(h.backups)).toEqual([]);
  };

  it("thins main exe + helper + dylib, leaves the hash2 resource alone, verify passes", async () => {
    const f = await buildFixtureApp(apps, { helper: true, dylib: true, resourceBinary: true });
    const orig = { main: sha(f.mainExe), helper: sha(f.helper!), dylib: sha(f.dylib!), res: sha(f.resourceBin!) };
    const o = await thinBundle(f.app, ctx());
    expect(o.status).toBe("thinned");
    expect(o.candidates.map((c) => c.rel).sort()).toEqual(["Contents/Frameworks/libfx.dylib", "Contents/MacOS/fixture-helper", "Contents/MacOS/fixture-main"]);
    expect(o.heldBytes).toBe(o.candidates.reduce((n, c) => n + c.savings, 0));
    expect(o.heldBytes).toBeGreaterThan(3 * 65536);
    for (const p of [f.mainExe, f.helper!, f.dylib!]) expect(await lipoArchs(p)).toEqual(["arm64"]);
    expect(await lipoArchs(f.resourceBin!)).toHaveLength(2);
    expect(sha(f.resourceBin!)).toBe(orig.res);
    expect((await codesignVerify(f.app)).ok).toBe(true);
    expect(listDirRecursive(f.app).some((p) => /\.(thin|bak|tmp|restore)$/.test(p))).toBe(false);
    // backups hold the original bytes at <backupDir>/<rel>; staging is gone; journal is finished
    expect(o.backupDir).toBeDefined();
    expect(sha(path.join(o.backupDir!, "Contents/MacOS/fixture-main"))).toBe(orig.main);
    expect(sha(path.join(o.backupDir!, "Contents/MacOS/fixture-helper"))).toBe(orig.helper);
    expect(sha(path.join(o.backupDir!, "Contents/Frameworks/libfx.dylib"))).toBe(orig.dylib);
    expect(fs.readdirSync(h.staging)).toEqual([]);
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it.skipIf(!hasArm64eToolchain())("skips arm64e-containing files", async () => {
    const f = await buildFixtureApp(apps, { arm64e: true, helper: true });
    const o = await thinBundle(f.app, ctx());
    expect(o.status).toBe("thinned");
    expect(o.skipped).toContainEqual({ rel: "Contents/MacOS/fixture-main", reason: "other-slice" });
    expect(o.candidates.map((c) => c.rel)).toEqual(["Contents/MacOS/fixture-helper"]);
    expect(await lipoArchs(f.mainExe)).toHaveLength(3);
    expect((await codesignVerify(f.app)).ok).toBe(true);
  });

  it("baseline-invalid app is skipped untouched", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    fs.writeFileSync(path.join(f.app, "Contents", "stray.txt"), "x");
    const before = sha(f.mainExe);
    const o = await thinBundle(f.app, ctx());
    expect([o.status, o.reason]).toEqual(["skipped", "baseline-invalid"]);
    expect(sha(f.mainExe)).toBe(before);
    agentEmpty();
    expect(fs.readdirSync(h.journal)).toEqual([]);
  });

  it("no CodeResources seal -> skipped:unsigned, never 'thin everything'", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    fs.rmSync(path.join(f.app, "Contents", "_CodeSignature"), { recursive: true });
    const before = sha(f.mainExe);
    const o = await thinBundle(f.app, ctx({ deps: { verify: async () => ({ ok: true, errorText: "" }) } }));
    expect([o.status, o.reason]).toEqual(["skipped", "unsigned"]);
    expect(sha(f.mainExe)).toBe(before);
    agentEmpty();
  });

  it("not a bundle -> skipped:not-a-bundle", async () => {
    const d = path.join(apps, "Empty.app");
    fs.mkdirSync(d);
    const o = await thinBundle(d, ctx());
    expect([o.status, o.reason]).toEqual(["skipped", "not-a-bundle"]);
  });

  it("total savings under the default 5 MB floor -> skipped:below-threshold", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    const before = sha(f.mainExe);
    const o = await thinBundle(f.app, { home: h, runId: "run1", seq: seq++ });
    expect([o.status, o.reason]).toEqual(["skipped", "below-threshold"]);
    expect(o.candidates).toHaveLength(2);
    expect(sha(f.mainExe)).toBe(before);
    agentEmpty();
  });

  it("rolls back to byte-identical originals when post-thin verify fails", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    const orig = { main: sha(f.mainExe), helper: sha(f.helper!) };
    let calls = 0; // call 1 = baseline (real), call 2 = post-swap (forced failure)
    const verify = async (app: string) => (++calls === 2 ? { ok: false, errorText: "forced" } : codesignVerify(app));
    const o = await thinBundle(f.app, ctx({ deps: { verify } }));
    expect([o.status, o.reason]).toEqual(["rolled-back", "verify-failed"]);
    expect(o.heldBytes).toBe(0);
    expect(sha(f.mainExe)).toBe(orig.main);
    expect(sha(f.helper!)).toBe(orig.helper);
    expect((await codesignVerify(f.app)).ok).toBe(true);
    expect(fs.readdirSync(h.staging)).toEqual([]);
    expect(await listIncomplete(h, "")).toEqual([]); // restored
  });

  it("backup failure leaves original untouched and no staging/backups remain", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    const before = sha(f.mainExe);
    const copyFile = (async () => {
      throw Object.assign(new Error("no space left"), { code: "ENOSPC" });
    }) as unknown as typeof fs.promises.copyFile;
    const o = await thinBundle(f.app, ctx({ deps: { copyFile } }));
    expect([o.status, o.reason]).toEqual(["aborted", "no-space"]);
    expect(sha(f.mainExe)).toBe(before);
    expect(await lipoArchs(f.mainExe)).toHaveLength(2);
    agentEmpty();
    expect(await listIncomplete(h, "")).toEqual([]); // superseded
  });

  it("skipped:running when main exe is in snapshot", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    const snapshot = async () => new Set([fs.realpathSync(f.mainExe)]);
    const o = await thinBundle(f.app, ctx({ deps: { snapshot } }));
    expect([o.status, o.reason]).toEqual(["skipped", "running"]);
    agentEmpty();
  });

  it("a candidate modified between selection and swap -> skipped:changed-during-thin, nothing swapped", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    let calls = 0;
    const snapshot = async () => {
      if (++calls === 2) fs.utimesSync(f.helper!, new Date(), new Date(Date.now() + 5000)); // the gate re-check
      return new Set<string>();
    };
    const o = await thinBundle(f.app, ctx({ deps: { snapshot } }));
    expect([o.status, o.reason]).toEqual(["skipped", "changed-during-thin"]);
    expect(await lipoArchs(f.mainExe)).toHaveLength(2);
    expect(await lipoArchs(f.helper!)).toHaveLength(2);
    agentEmpty();
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it("aborts cleanly when bundle vanished", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    fs.renameSync(f.app, f.app + ".away");
    const o = await thinBundle(f.app, ctx());
    expect([o.status, o.reason]).toEqual(["aborted", "bundle-missing"]);
    agentEmpty();
  });

  it("killed after swapping is recovered by recoverJournal", async () => {
    const f = await buildFixtureApp(apps, { helper: true, dylib: true });
    const orig = [f.mainExe, f.helper!, f.dylib!].map(sha);
    const script = path.join(tmp, "child.ts");
    fs.writeFileSync(
      script,
      `import { thinBundle } from ${JSON.stringify(path.join(REPO, "src/ub/thinner.ts"))};
const [app, home] = process.argv.slice(2);
const h = JSON.parse(home);
void thinBundle(app, { home: h, runId: "killed", seq: 0, minSavingsBytes: 0, deps: { afterSwap: (n) => { if (n === 1) process.exit(9); } } })
  .then(() => process.exit(0));
`,
    );
    const r = cp.spawnSync(path.join(REPO, "node_modules/.bin/tsx"), [script, f.app, JSON.stringify(h)], { cwd: REPO, timeout: 120_000, encoding: "utf8" });
    expect(r.status).toBe(9);
    // exactly one file is thin and the journal knows it
    const thin = await Promise.all([f.mainExe, f.helper!, f.dylib!].map(async (p) => (await lipoArchs(p)).length === 1));
    expect(thin.filter(Boolean)).toHaveLength(1);
    const pending = await listIncomplete(h, "");
    expect(pending.map((e) => e.phase)).toEqual(["swapping"]);

    const res = await recoverJournal(h, "other");
    expect(res.map((x) => x.result)).toEqual(["restored"]);
    expect([f.mainExe, f.helper!, f.dylib!].map(sha)).toEqual(orig);
    expect((await codesignVerify(f.app)).ok).toBe(true);
    expect(fs.readdirSync(h.staging)).toEqual([]);
  });

  it("dry-run touches nothing", async () => {
    const f = await buildFixtureApp(apps, { helper: true, dylib: true });
    const before = listDirRecursive(f.app).map((p) => [p, fs.lstatSync(p).isFile() ? sha(p) : "dir"]);
    const o = await thinBundle(f.app, ctx({ dryRun: true }));
    expect([o.status, o.reason]).toEqual(["skipped", "dry-run"]);
    expect(o.heldBytes).toBe(o.candidates.reduce((n, c) => n + c.savings, 0));
    expect(o.candidates).toHaveLength(3);
    expect(listDirRecursive(f.app).map((p) => [p, fs.lstatSync(p).isFile() ? sha(p) : "dir"])).toEqual(before);
    agentEmpty();
    expect(fs.readdirSync(h.journal)).toEqual([]);
  });
});
