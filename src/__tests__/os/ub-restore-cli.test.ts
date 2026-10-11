import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { restoreAppFromJournal } from "../../ub/restore";
import { pruneBackups } from "../../ub/backups";
import { thinBundle } from "../../ub/thinner";
import { writeEntry, type JournalEntry } from "../../ub/journal";
import {
  agentHomeDir,
  ensureAgentHome,
  isInside,
  bundleHash,
  type AgentHome,
} from "../../ub/paths";
import { newRunId } from "../../ub/lock";
import { codesignVerify, lipoArchs } from "../../ub/exec";
import { readMachOSlices } from "../../ub/bundle";
import { buildFixtureApp, hasToolchain } from "./helpers/ubFixture";

// SAFETY (R13): thinBundle and restoreAppFromJournal are called directly on fixture apps built
// under a temp base, with the agent home in that base. Nothing here scans roots or calls clear().
const gate =
  process.platform === "darwin" && process.arch === "arm64" && hasToolchain();
const sha = (p: string) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const MAIN = "Contents/MacOS/fixture-main";
const HELPER = "Contents/MacOS/fixture-helper";

let base: string;
let home: AgentHome;
let app: string;
const savedHome = process.env.SQUEAKY_AGENT_HOME;

function assertTempOnly(): void {
  const tmpReal = fs.realpathSync(os.tmpdir());
  if (!isInside(agentHomeDir(), tmpReal))
    throw new Error(
      `SAFETY: agent home ${agentHomeDir()} is not under ${tmpReal}; refusing to run`,
    );
  if (app !== undefined && !isInside(app, base))
    throw new Error(
      `SAFETY: fixture ${app} is not under ${base}; refusing to run`,
    );
}

beforeAll(() => {
  base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ub-restore-cli-")),
  );
  process.env.SQUEAKY_AGENT_HOME = path.join(base, "agent");
  assertTempOnly();
});
afterAll(() => {
  if (savedHome === undefined) delete process.env.SQUEAKY_AGENT_HOME;
  else process.env.SQUEAKY_AGENT_HOME = savedHome;
  if (base) fs.rmSync(base, { recursive: true, force: true });
});

describe.skipIf(!gate)("ub restore / prune on a thinned fixture app", () => {
  const ok = { verify: async () => ({ ok: true, errorText: "" }) };
  let orig: Record<string, string>;

  const thin = async () => {
    const o = await thinBundle(app, {
      home,
      runId: newRunId(),
      seq: 0,
      minSavingsBytes: 0,
    });
    expect(o.status).toBe("thinned");
    expect(await lipoArchs(path.join(app, MAIN))).toEqual(["arm64"]);
    return o;
  };
  const journalNames = () => fs.readdirSync(home.journal).sort();
  const journalFiles = () =>
    Object.fromEntries(
      journalNames()
        .filter((n) => n.endsWith(".json"))
        .map((n) => [n, fs.readFileSync(path.join(home.journal, n), "utf8")]),
    );

  beforeEach(async () => {
    for (const d of ["agent", "apps", "t"])
      fs.rmSync(path.join(base, d), { recursive: true, force: true });
    fs.mkdirSync(path.join(base, "apps"));
    fs.mkdirSync(path.join(base, "t"));
    process.env.SQUEAKY_AGENT_HOME = path.join(base, "agent");
    app = fs.realpathSync(
      (await buildFixtureApp(path.join(base, "apps"), { helper: true })).app,
    );
    assertTempOnly();
    home = await ensureAgentHome();
    orig = {
      [MAIN]: sha(path.join(app, MAIN)),
      [HELPER]: sha(path.join(app, HELPER)),
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("restore after thin returns original bytes and verifies", async () => {
    await thin();
    const r = await restoreAppFromJournal(home, app);
    expect(r).toEqual({ status: "restored", notes: [] });
    for (const rel of [MAIN, HELPER])
      expect(sha(path.join(app, rel))).toBe(orig[rel]);
    expect((await codesignVerify(app)).ok).toBe(true);
    expect(fs.readdirSync(home.staging)).toEqual([]);
  });

  it("an already-restored app → nothing-to-do (exit 0); nothing written", async () => {
    await thin();
    expect((await restoreAppFromJournal(home, app)).status).toBe("restored");
    const journal = journalFiles();
    const ino = fs.statSync(path.join(app, MAIN)).ino;
    expect(await restoreAppFromJournal(home, app)).toEqual({
      status: "nothing-to-do",
      notes: [],
    });
    expect(journalFiles()).toEqual(journal);
    expect(fs.statSync(path.join(app, MAIN)).ino).toBe(ino);
    for (const rel of [MAIN, HELPER])
      expect(sha(path.join(app, rel))).toBe(orig[rel]);
  });

  it("same build, arm64-only vendor update of the main exe, helper still thin → restore-failed; the new bytes stay byte-identical", async () => {
    await thin();
    // the vendor re-ships arm64-only binaries under the same CFBundleVersion: new inode, new bytes
    const fresh = path.join(base, "t", "fresh");
    fs.copyFileSync(path.join(app, MAIN), fresh);
    fs.appendFileSync(fresh, "vendor update");
    fs.renameSync(fresh, path.join(app, MAIN));
    expect(
      (await readMachOSlices(path.join(app, MAIN))).map((x) => x.arch),
    ).toEqual(["arm64"]);
    const vendor = sha(path.join(app, MAIN));
    const helperIno = fs.statSync(path.join(app, HELPER)).ino;

    const r = await restoreAppFromJournal(home, app, ok);
    expect(r.status).toBe("restore-failed"); // the helper is still squeaky's thin: never superseded (R19 item 5)
    expect(r.notes.join("\n")).toMatch(
      /fixture-main: changed since it was thinned; not overwriting/,
    );
    expect(r.notes.join("\n")).toContain(
      `not restoring: ${MAIN} changed since the thin while 1 other file(s) are still thin; nothing was written and the backup is kept. Reinstall or update the app to fix it`,
    );
    expect(sha(path.join(app, MAIN))).toBe(vendor);
    expect(fs.statSync(path.join(app, HELPER)).ino).toBe(helperIno);
    expect(fs.readdirSync(home.staging)).toEqual([]);
  });

  it("restore refuses when the main exe was updated since (fat again) and the helper is still thin → restore-failed, nothing written", async () => {
    const o = await thin();
    // an "update" puts a fat main executable back (new inode); the helper is still our thin file
    const fresh = path.join(base, "t", "fresh");
    fs.copyFileSync(path.join(o.backupDir!, MAIN), fresh);
    fs.renameSync(fresh, path.join(app, MAIN));
    const helperIno = fs.statSync(path.join(app, HELPER)).ino;
    const before = journalNames();

    const r = await restoreAppFromJournal(home, app, ok);
    expect(r.status).toBe("restore-failed");
    expect(r.notes.join("\n")).toMatch(
      /fixture-main: changed since it was thinned/,
    );
    // nothing written in the bundle: helper untouched and still thin, no new journal entry, no staging
    expect(fs.statSync(path.join(app, HELPER)).ino).toBe(helperIno);
    expect(await lipoArchs(path.join(app, HELPER))).toEqual(["arm64"]);
    expect(journalNames()).toEqual(before);
    expect(fs.readdirSync(home.staging)).toEqual([]);
  });

  it("no journal record → no-record; nothing is written, not even the journal", async () => {
    const o = await thin();
    for (const n of journalNames())
      fs.rmSync(path.join(home.journal, n), { recursive: true, force: true });
    const thinMain = sha(path.join(app, MAIN));
    const r = await restoreAppFromJournal(home, app, ok);
    expect(r.status).toBe("no-record");
    expect(r.notes.join("\n")).toMatch(/nothing was changed/);
    expect(sha(path.join(app, MAIN))).toBe(thinMain);
    expect(journalNames()).toEqual([]);
    expect(fs.readdirSync(home.staging)).toEqual([]);
    expect(fs.existsSync(path.join(o.backupDir!, MAIN))).toBe(true);
  });

  it("a done record whose backup was pruned → no-record; the app stays as it is", async () => {
    await thin();
    await pruneBackups(home, app);
    const journal = journalFiles();
    const r = await restoreAppFromJournal(home, app, ok);
    expect(r.status).toBe("no-record");
    expect(await lipoArchs(path.join(app, MAIN))).toEqual(["arm64"]);
    expect(journalFiles()).toEqual(journal);
  });

  it("two generations: the newest thin is restored; a second restore is nothing-to-do (exit 0)", async () => {
    const o1 = await thin();
    // a vendor update puts fat binaries back (new inodes), then a second thin makes generation 2
    for (const rel of [MAIN, HELPER]) {
      const fresh = path.join(base, "t", "fresh");
      fs.copyFileSync(path.join(o1.backupDir!, rel), fresh);
      fs.renameSync(fresh, path.join(app, rel));
    }
    const o2 = await thin();
    expect(o2.backupDir).not.toBe(o1.backupDir);
    expect(await restoreAppFromJournal(home, app)).toEqual({
      status: "restored",
      notes: [],
    });
    for (const rel of [MAIN, HELPER])
      expect(sha(path.join(app, rel))).toBe(orig[rel]);
    // generation 1 is still `done` with its backup kept, but it is not the newest entry: never acted on
    const journal = journalFiles();
    const ino = fs.statSync(path.join(app, MAIN)).ino;
    expect(await restoreAppFromJournal(home, app)).toEqual({
      status: "nothing-to-do",
      notes: [],
    });
    expect(journalFiles()).toEqual(journal);
    expect(fs.statSync(path.join(app, MAIN)).ino).toBe(ino);
  });

  it("only a superseded entry (thin stopped before any swap) and a fat main → nothing-to-do (exit 0)", async () => {
    const eperm = async () => {
      throw Object.assign(new Error("EPERM: operation not permitted"), {
        code: "EPERM",
      });
    };
    const o = await thinBundle(app, {
      home,
      runId: newRunId(),
      seq: 0,
      minSavingsBytes: 0,
      deps: { copyFile: eperm },
    });
    expect(`${o.status}:${o.reason}`).toBe("blocked:app-management");
    const journal = journalFiles();
    expect(
      Object.values(journal).map((j) => (JSON.parse(j) as JournalEntry).phase),
    ).toEqual(["superseded"]);
    expect(await restoreAppFromJournal(home, app, ok)).toEqual({
      status: "nothing-to-do",
      notes: [],
    });
    expect(journalFiles()).toEqual(journal);
    for (const rel of [MAIN, HELPER])
      expect(sha(path.join(app, rel))).toBe(orig[rel]);
  });

  it("never thinned → nothing-to-do; no app → unreachable; a missing file while another is still thin → restore-failed", async () => {
    expect(await restoreAppFromJournal(home, app)).toEqual({
      status: "nothing-to-do",
      notes: [],
    });
    expect(
      (await restoreAppFromJournal(home, path.join(base, "apps", "Gone.app")))
        .status,
    ).toBe("unreachable");
    await thin();
    fs.rmSync(path.join(app, HELPER));
    const r = await restoreAppFromJournal(home, app, ok);
    expect(r.status).toBe("restore-failed");
    expect(r.notes.join("\n")).toContain(
      `not restoring: ${HELPER} changed since the thin`,
    );
    expect(await lipoArchs(path.join(app, MAIN))).toEqual(["arm64"]);
  });

  it("an unfinished newest entry is a failure naming its phase, never nothing-to-do, even with the main executable fat (c12)", async () => {
    await thin();
    const [name] = Object.keys(journalFiles());
    const e = JSON.parse(
      fs.readFileSync(path.join(home.journal, name), "utf8"),
    ) as JournalEntry;
    // a restore that put the main executable back and then failed on the helper
    fs.copyFileSync(path.join(e.backupDir, MAIN), path.join(app, MAIN));
    expect((await lipoArchs(path.join(app, MAIN))).sort()).toEqual([
      "arm64",
      "x86_64",
    ]);
    const helperThin = sha(path.join(app, HELPER));
    for (const phase of [
      "staged",
      "backed-up",
      "swapping",
      "restoring",
      "restore-failed",
    ] as const) {
      await writeEntry(home, { ...e, phase });
      const journal = journalFiles();
      expect(await restoreAppFromJournal(home, app, ok), phase).toEqual({
        status: "restore-failed",
        notes: [
          `the last thin or restore of ${app} is unfinished (journal phase ${phase}) and recovery could not complete it; nothing was changed`,
        ],
      });
      expect(journalFiles()).toEqual(journal);
    }
    expect(sha(path.join(app, HELPER))).toBe(helperThin);
  });

  it("uses the journaled backupDir, never the newest dir under backups/", async () => {
    const o = await thin();
    const hd = path.dirname(o.backupDir!);
    // garbage that would fail the restore if it were read: a newer dir and a symlink to an even newer one
    const garbage = (d: string) => {
      fs.mkdirSync(path.join(d, "Contents", "MacOS"), { recursive: true });
      fs.writeFileSync(path.join(d, MAIN), "not the original");
    };
    const future = new Date(Date.now() + 86_400_000);
    garbage(path.join(hd, "9-newer"));
    fs.utimesSync(path.join(hd, "9-newer"), future, future);
    const outside = path.join(base, "t", "outside");
    garbage(outside);
    fs.utimesSync(outside, future, future);
    fs.symlinkSync(outside, path.join(hd, "9-zlink"));

    expect((await restoreAppFromJournal(home, app)).status).toBe("restored");
    for (const rel of [MAIN, HELPER])
      expect(sha(path.join(app, rel))).toBe(orig[rel]);
  });

  it("prune <app> removes its backups regardless of age, but keeps one an incomplete entry references", async () => {
    const o = await thin();
    const hd = path.join(home.backups, bundleHash(app));
    const runId = newRunId();
    const pending: JournalEntry = {
      runId,
      seq: 0,
      bundle: app,
      bundleId: null,
      version: "1.0",
      build: "1",
      backupDir: o.backupDir!,
      stagingDir: path.join(home.staging, `${runId}-0`),
      files: [],
      phase: "restore-failed",
    };
    await writeEntry(home, pending);
    let r = await pruneBackups(home, app);
    expect(r).toEqual({
      removedDirs: [],
      freedBytes: 0,
      heldDirs: [o.backupDir],
    });
    expect(fs.existsSync(o.backupDir!)).toBe(true);

    await writeEntry(home, { ...pending, phase: "restored" });
    r = await pruneBackups(home, app);
    expect(r.removedDirs).toEqual([o.backupDir]);
    expect(r.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(hd)).toBe(false);
    // the app is untouched and stays thin; only the backup is gone
    expect(await lipoArchs(path.join(app, MAIN))).toEqual(["arm64"]);
  });

  it("prune --all removes every app's backups; an unknown app removes nothing", async () => {
    const o = await thin();
    expect(
      await pruneBackups(home, path.join(base, "apps", "Other.app")),
    ).toEqual({ removedDirs: [], freedBytes: 0, heldDirs: [] });
    expect(fs.existsSync(o.backupDir!)).toBe(true);
    const r = await pruneBackups(home);
    expect(r.removedDirs).toEqual([o.backupDir]);
    expect(fs.readdirSync(home.backups)).toEqual([]);
  });
});
