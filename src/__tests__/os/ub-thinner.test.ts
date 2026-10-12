import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { SPACE_RESERVE, thinBundle, type ThinDeps } from "../../ub/thinner";
import { listIncomplete } from "../../ub/journal";
import { recoverJournal } from "../../ub/restore";
import type { AgentHome } from "../../ub/paths";
import { codesignVerify, lipoArchs } from "../../ub/exec";
import {
  buildFixtureApp,
  hasArm64eToolchain,
  hasToolchain,
} from "./helpers/ubFixture";

const gate =
  process.platform === "darwin" && process.arch === "arm64" && hasToolchain();
const REPO = path.resolve(__dirname, "../../..");
const sha = (p: string) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
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
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "ub-thinner-")),
    );
    h = {
      home: path.join(tmp, "agent"),
      staging: path.join(tmp, "agent", "staging"),
      backups: path.join(tmp, "agent", "backups"),
      journal: path.join(tmp, "agent", "journal"),
    };
    for (const d of [h.staging, h.backups, h.journal])
      fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    apps = path.join(tmp, "apps");
    fs.mkdirSync(apps);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // this machine may have less than SPACE_RESERVE free: a thin test reads a generous free space unless it sets its own
  const ctx = (
    o: { dryRun?: boolean; minSavingsBytes?: number; deps?: ThinDeps } = {},
  ) => ({
    home: h,
    runId: "run1",
    seq: seq++,
    minSavingsBytes: 0,
    ...o,
    deps: { freeBytes: async () => Number.MAX_SAFE_INTEGER, ...o.deps },
  });
  const agentEmpty = () => {
    expect(fs.readdirSync(h.staging)).toEqual([]);
    expect(fs.readdirSync(h.backups)).toEqual([]);
  };

  it("thins main exe + helper + dylib, leaves the hash2 resource alone, verify passes", async () => {
    const f = await buildFixtureApp(apps, {
      helper: true,
      dylib: true,
      resourceBinary: true,
    });
    const orig = {
      main: sha(f.mainExe),
      helper: sha(f.helper!),
      dylib: sha(f.dylib!),
      res: sha(f.resourceBin!),
    };
    const o = await thinBundle(f.app, ctx());
    expect(o.status).toBe("thinned");
    expect(o.candidates.map((c) => c.rel).sort()).toEqual([
      "Contents/Frameworks/libfx.dylib",
      "Contents/MacOS/fixture-helper",
      "Contents/MacOS/fixture-main",
    ]);
    expect(o.heldBytes).toBe(o.candidates.reduce((n, c) => n + c.savings, 0));
    expect(o.heldBytes).toBeGreaterThan(3 * 65536);
    for (const p of [f.mainExe, f.helper!, f.dylib!])
      expect(await lipoArchs(p)).toEqual(["arm64"]);
    expect(await lipoArchs(f.resourceBin!)).toHaveLength(2);
    expect(sha(f.resourceBin!)).toBe(orig.res);
    expect((await codesignVerify(f.app)).ok).toBe(true);
    expect(
      listDirRecursive(f.app).some((p) => /\.(thin|bak|tmp|restore)$/.test(p)),
    ).toBe(false);
    // backups hold the original bytes at <backupDir>/<rel>; staging is gone; journal is finished
    expect(o.backupDir).toBeDefined();
    expect(sha(path.join(o.backupDir!, "Contents/MacOS/fixture-main"))).toBe(
      orig.main,
    );
    expect(sha(path.join(o.backupDir!, "Contents/MacOS/fixture-helper"))).toBe(
      orig.helper,
    );
    expect(
      sha(path.join(o.backupDir!, "Contents/Frameworks/libfx.dylib")),
    ).toBe(orig.dylib);
    expect(fs.readdirSync(h.staging)).toEqual([]);
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it.skipIf(!hasArm64eToolchain())(
    "skips arm64e-containing files",
    async () => {
      const f = await buildFixtureApp(apps, { arm64e: true, helper: true });
      const o = await thinBundle(f.app, ctx());
      expect(o.status).toBe("thinned");
      expect(o.skipped).toContainEqual({
        rel: "Contents/MacOS/fixture-main",
        reason: "other-slice",
      });
      expect(o.candidates.map((c) => c.rel)).toEqual([
        "Contents/MacOS/fixture-helper",
      ]);
      expect(await lipoArchs(f.mainExe)).toHaveLength(3);
      expect((await codesignVerify(f.app)).ok).toBe(true);
    },
  );

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
    fs.rmSync(path.join(f.app, "Contents", "_CodeSignature"), {
      recursive: true,
    });
    const before = sha(f.mainExe);
    const o = await thinBundle(
      f.app,
      ctx({ deps: { verify: async () => ({ ok: true, errorText: "" }) } }),
    );
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
    const verify = async (app: string) =>
      ++calls === 2 ? { ok: false, errorText: "forced" } : codesignVerify(app);
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
      if (++calls === 2)
        fs.utimesSync(f.helper!, new Date(), new Date(Date.now() + 5000)); // the gate re-check
      return new Set<string>();
    };
    const o = await thinBundle(f.app, ctx({ deps: { snapshot } }));
    expect([o.status, o.reason]).toEqual(["skipped", "changed-during-thin"]);
    expect(await lipoArchs(f.mainExe)).toHaveLength(2);
    expect(await lipoArchs(f.helper!)).toHaveLength(2);
    agentEmpty();
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it("post-swap EPERM rolls every original back: blocked:app-management, byte-identical, seal valid, nothing left", async () => {
    const f = await buildFixtureApp(apps, { helper: true, dylib: true });
    const files = [f.mainExe, f.helper!, f.dylib!];
    const orig = files.map(sha);
    const afterSwap = (n: number) => {
      if (n === 1) throw Object.assign(new Error("x"), { code: "EPERM" });
    };
    const o = await thinBundle(f.app, ctx({ deps: { afterSwap } }));
    expect([o.status, o.reason]).toEqual(["blocked", "app-management"]);
    expect(files.map(sha)).toEqual(orig);
    expect((await codesignVerify(f.app)).ok).toBe(true);
    expect(fs.readdirSync(h.staging)).toEqual([]);
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it("post-swap EACCES rolls back and is skipped:not-writable, never app-management (k2)", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    const files = [f.mainExe, f.helper!];
    const orig = files.map(sha);
    const afterSwap = (n: number) => {
      if (n === 1)
        throw Object.assign(new Error("EACCES: permission denied"), {
          code: "EACCES",
        });
    };
    const o = await thinBundle(f.app, ctx({ deps: { afterSwap } }));
    expect([o.status, o.reason]).toEqual(["skipped", "not-writable"]);
    expect(files.map(sha)).toEqual(orig);
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it("a non-writable Contents/MacOS is skipped:not-writable before any staging, lipo or backup (k2)", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    const macos = path.dirname(f.mainExe);
    const before = sha(f.mainExe);
    fs.chmodSync(macos, 0o555);
    try {
      const o = await thinBundle(f.app, ctx());
      expect([o.status, o.reason]).toEqual(["skipped", "not-writable"]);
      expect(o.detail).toMatch(
        /\/Contents\/MacOS is not writable by its permission bits$/,
      );
    } finally {
      fs.chmodSync(macos, 0o755);
    }
    expect(sha(f.mainExe)).toBe(before);
    agentEmpty();
    expect(fs.readdirSync(h.journal)).toEqual([]); // no entry was ever written: no lipo ran
  });

  it("a candidate replaced by a symlink before the re-check -> skipped:changed-during-thin", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    const orig = sha(f.mainExe);
    let calls = 0;
    const snapshot = async () => {
      if (++calls === 2) {
        fs.renameSync(f.helper!, f.helper! + ".away");
        fs.symlinkSync(f.mainExe, f.helper!);
      }
      return new Set<string>();
    };
    const o = await thinBundle(f.app, ctx({ deps: { snapshot } }));
    expect([o.status, o.reason]).toEqual(["skipped", "changed-during-thin"]);
    expect(sha(f.mainExe)).toBe(orig);
    agentEmpty();
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it("a candidate that vanished before the re-check -> skipped:changed-during-thin", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    let calls = 0;
    const snapshot = async () => {
      if (++calls === 2) fs.unlinkSync(f.helper!);
      return new Set<string>();
    };
    const o = await thinBundle(f.app, ctx({ deps: { snapshot } }));
    expect([o.status, o.reason]).toEqual(["skipped", "changed-during-thin"]);
    agentEmpty();
  });

  it("a failing process snapshot aborts (never 'not running') with a detail", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    const before = sha(f.mainExe);
    const snapshot = async () => {
      throw new Error("ps exited 1");
    };
    const o = await thinBundle(f.app, ctx({ deps: { snapshot } }));
    expect([o.status, o.reason]).toEqual(["aborted", "error"]);
    expect(o.detail).toMatch(/ps exited 1/);
    expect(sha(f.mainExe)).toBe(before);
    agentEmpty();
  });

  it("a staging dir that cannot be removed is reported in detail", async () => {
    const f = await buildFixtureApp(apps, { helper: true });
    const rm = vi.spyOn(fs.promises, "rm").mockImplementation(async (p) => {
      if (String(p).startsWith(h.staging)) throw new Error("EBUSY stuck");
    });
    const o = await thinBundle(f.app, ctx());
    rm.mockRestore();
    expect(o.status).toBe("thinned");
    expect(o.detail).toMatch(/could not remove .*EBUSY stuck/);
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
void thinBundle(app, { home: h, runId: "killed", seq: 0, minSavingsBytes: 0, deps: { freeBytes: async () => Number.MAX_SAFE_INTEGER, afterSwap: (n) => { if (n === 1) process.exit(9); } } })
  .then(() => process.exit(0));
`,
    );
    const r = cp.spawnSync(
      path.join(REPO, "node_modules/.bin/tsx"),
      [script, f.app, JSON.stringify(h)],
      { cwd: REPO, timeout: 120_000, encoding: "utf8" },
    );
    expect(r.status).toBe(9);
    // exactly one file is thin and the journal knows it
    const thin = await Promise.all(
      [f.mainExe, f.helper!, f.dylib!].map(
        async (p) => (await lipoArchs(p)).length === 1,
      ),
    );
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
    const before = listDirRecursive(f.app).map((p) => [
      p,
      fs.lstatSync(p).isFile() ? sha(p) : "dir",
    ]);
    const o = await thinBundle(f.app, ctx({ dryRun: true }));
    expect([o.status, o.reason]).toEqual(["skipped", "dry-run"]);
    expect(o.heldBytes).toBe(o.candidates.reduce((n, c) => n + c.savings, 0));
    expect(o.candidates).toHaveLength(3);
    expect(
      listDirRecursive(f.app).map((p) => [
        p,
        fs.lstatSync(p).isFile() ? sha(p) : "dir",
      ]),
    ).toEqual(before);
    agentEmpty();
    expect(fs.readdirSync(h.journal)).toEqual([]);
  });

  describe("free-space guard", () => {
    const GB = 1024 ** 3;
    /** Nothing was staged, backed up or journaled, and the bundle is byte-identical. */
    const untouched = async (
      f: { mainExe: string; helper?: string },
      before: string[],
    ) => {
      expect([f.mainExe, f.helper!].map(sha)).toEqual(before);
      expect(await lipoArchs(f.mainExe)).toHaveLength(2);
      agentEmpty();
      expect(fs.readdirSync(h.journal)).toEqual([]);
    };

    it("too little free space -> skipped:low-space before any staging, backup or journal write", async () => {
      const f = await buildFixtureApp(apps, { helper: true });
      const before = [f.mainExe, f.helper!].map(sha);
      const read: string[] = [];
      const freeBytes = async (p: string) => {
        read.push(p);
        return GB;
      };
      const o = await thinBundle(f.app, ctx({ deps: { freeBytes } }));
      expect([o.status, o.reason]).toEqual(["skipped", "low-space"]);
      expect(o.detail).toMatch(
        /^the volume of \S+ needs [\d.]+ MB \+ 2\.0 GB reserve, 1\.0 GB free$/,
      );
      expect(o.detail).toContain(`the volume of ${h.backups} `);
      expect(read).toEqual([h.backups]); // fixture and agent home share one volume: one reading
      expect([o.heldBytes, o.backupDir]).toEqual([0, undefined]);
      await untouched(f, before);
    });

    it("on one volume the backup and staging needs add up; free = need + reserve is enough, a byte less is not", async () => {
      const f = await buildFixtureApp(apps, { helper: true });
      const before = [f.mainExe, f.helper!].map(sha);
      const { candidates } = await thinBundle(f.app, ctx({ dryRun: true }));
      const backup = candidates.reduce((n, c) => n + c.size, 0);
      const staged = candidates.reduce((n, c) => n + c.size - c.savings, 0);
      const free = (bytes: number) => ({
        freeBytes: async () => SPACE_RESERVE + bytes,
      });
      // one byte short of the sum still covers each need alone
      expect(backup + staged - 1).toBeGreaterThan(Math.max(backup, staged));
      const short = await thinBundle(
        f.app,
        ctx({ deps: free(backup + staged - 1) }),
      );
      expect([short.status, short.reason]).toEqual(["skipped", "low-space"]);
      await untouched(f, before);
      const o = await thinBundle(f.app, ctx({ deps: free(backup + staged) }));
      expect(o.status).toBe("thinned");
      expect((await codesignVerify(f.app)).ok).toBe(true);
    });

    it("a dry run never reads free space", async () => {
      const f = await buildFixtureApp(apps, { helper: true });
      const freeBytes = vi.fn(async () => 0);
      const o = await thinBundle(
        f.app,
        ctx({ dryRun: true, deps: { freeBytes } }),
      );
      expect([o.status, o.reason]).toEqual(["skipped", "dry-run"]);
      expect(freeBytes).not.toHaveBeenCalled();
    });

    it("the default reader counts blocks available to the user (bavail), not all free blocks", async () => {
      const f = await buildFixtureApp(apps, { helper: true });
      const before = [f.mainExe, f.helper!].map(sha);
      const statfs = (bavail: number, bfree: number) =>
        vi.spyOn(fs.promises, "statfs").mockResolvedValue({
          type: 0,
          bsize: 4096,
          blocks: 2 ** 40,
          bfree,
          bavail,
          files: 0,
          ffree: 0,
        } as fs.StatsFs);
      statfs(1, 2 ** 40);
      const o = await thinBundle(
        f.app,
        ctx({ deps: { freeBytes: undefined } }),
      );
      expect([o.status, o.reason]).toEqual(["skipped", "low-space"]);
      expect(o.detail).toMatch(/, 0\.0 MB free$/);
      await untouched(f, before);
      vi.restoreAllMocks();
      statfs(2 ** 30, 0);
      const ok = await thinBundle(
        f.app,
        ctx({ deps: { freeBytes: undefined } }),
      );
      expect(ok.status).toBe("thinned");
    });

    it("statfs missing (Node < 18.15) fails closed: skipped:low-space, nothing written", async () => {
      const f = await buildFixtureApp(apps, { helper: true });
      const before = [f.mainExe, f.helper!].map(sha);
      const real = fs.promises.statfs;
      (fs.promises as { statfs?: unknown }).statfs = undefined;
      let o;
      try {
        o = await thinBundle(f.app, ctx({ deps: { freeBytes: undefined } }));
      } finally {
        (fs.promises as { statfs?: unknown }).statfs = real;
      }
      expect([o.status, o.reason]).toEqual(["skipped", "low-space"]);
      expect(o.detail).toBe(
        "free space unknown: the free-space check needs Node >= 18.15",
      );
      await untouched(f, before);
    });

    it("a statfs error fails closed: skipped:low-space with the error, nothing written", async () => {
      const f = await buildFixtureApp(apps, { helper: true });
      const before = [f.mainExe, f.helper!].map(sha);
      vi.spyOn(fs.promises, "statfs").mockRejectedValue(
        Object.assign(new Error("EIO: i/o error, statfs"), { code: "EIO" }),
      );
      const o = await thinBundle(
        f.app,
        ctx({ deps: { freeBytes: undefined } }),
      );
      expect([o.status, o.reason]).toEqual(["skipped", "low-space"]);
      expect(o.detail).toBe("free space unknown: EIO: i/o error, statfs");
      await untouched(f, before);
    });
  });
});
