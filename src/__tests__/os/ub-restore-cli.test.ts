import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { restoreAppFromNewestBackup } from "../../ub/restore";
import { pruneBackups } from "../../ub/backups";
import { thinBundle } from "../../ub/thinner";
import { writeEntry, type JournalEntry } from "../../ub/journal";
import { agentHomeDir, ensureAgentHome, isInside, bundleHash, type AgentHome } from "../../ub/paths";
import { newRunId } from "../../ub/lock";
import { codesignVerify, lipoArchs } from "../../ub/exec";
import { buildFixtureApp, hasToolchain } from "./helpers/ubFixture";

// SAFETY (R13): thinBundle and restoreAppFromNewestBackup are called directly on fixture apps built
// under a temp base, with the agent home in that base. Nothing here scans roots or calls clear().
const gate = process.platform === "darwin" && process.arch === "arm64" && hasToolchain();
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const MAIN = "Contents/MacOS/fixture-main";
const HELPER = "Contents/MacOS/fixture-helper";

let base: string;
let home: AgentHome;
let app: string;
const savedHome = process.env.SQUEAKY_AGENT_HOME;

function assertTempOnly(): void {
  const tmpReal = fs.realpathSync(os.tmpdir());
  if (!isInside(agentHomeDir(), tmpReal)) throw new Error(`SAFETY: agent home ${agentHomeDir()} is not under ${tmpReal}; refusing to run`);
  if (app !== undefined && !isInside(app, base)) throw new Error(`SAFETY: fixture ${app} is not under ${base}; refusing to run`);
}

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ub-restore-cli-")));
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
    const o = await thinBundle(app, { home, runId: newRunId(), seq: 0, minSavingsBytes: 0 });
    expect(o.status).toBe("thinned");
    expect(await lipoArchs(path.join(app, MAIN))).toEqual(["arm64"]);
    return o;
  };
  const journalNames = () => fs.readdirSync(home.journal).sort();

  beforeEach(async () => {
    for (const d of ["agent", "apps", "t"]) fs.rmSync(path.join(base, d), { recursive: true, force: true });
    fs.mkdirSync(path.join(base, "apps"));
    fs.mkdirSync(path.join(base, "t"));
    process.env.SQUEAKY_AGENT_HOME = path.join(base, "agent");
    app = fs.realpathSync((await buildFixtureApp(path.join(base, "apps"), { helper: true })).app);
    assertTempOnly();
    home = await ensureAgentHome();
    orig = { [MAIN]: sha(path.join(app, MAIN)), [HELPER]: sha(path.join(app, HELPER)) };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("restore after thin returns original bytes and verifies", async () => {
    await thin();
    const r = await restoreAppFromNewestBackup(home, app);
    expect(r).toEqual({ status: "restored", notes: [] });
    for (const rel of [MAIN, HELPER]) expect(sha(path.join(app, rel))).toBe(orig[rel]);
    expect((await codesignVerify(app)).ok).toBe(true);
    expect(fs.readdirSync(home.staging)).toEqual([]);
  });

  it("restore refuses when the app was updated since (current exe still fat) → superseded", async () => {
    const o = await thin();
    // an "update" puts a fat main executable back (new inode); the helper is still our thin file
    const fresh = path.join(base, "t", "fresh");
    fs.copyFileSync(path.join(o.backupDir!, MAIN), fresh);
    fs.renameSync(fresh, path.join(app, MAIN));
    const helperIno = fs.statSync(path.join(app, HELPER)).ino;
    const before = journalNames();

    const r = await restoreAppFromNewestBackup(home, app, ok);
    expect(r.status).toBe("superseded");
    expect(r.notes.join("\n")).toMatch(/fixture-main: not the arm64-only file/);
    // nothing written: helper untouched and still thin, no journal entry, no staging
    expect(fs.statSync(path.join(app, HELPER)).ino).toBe(helperIno);
    expect(await lipoArchs(path.join(app, HELPER))).toEqual(["arm64"]);
    expect(journalNames()).toEqual(before);
    expect(fs.readdirSync(home.staging)).toEqual([]);
  });

  it("a changed build → superseded, even when the files are arm64-only", async () => {
    await thin();
    const plist = path.join(app, "Contents", "Info.plist");
    fs.writeFileSync(plist, fs.readFileSync(plist, "utf8").replace("<key>CFBundleVersion</key><string>1</string>", "<key>CFBundleVersion</key><string>2</string>"));
    const before = journalNames();
    const r = await restoreAppFromNewestBackup(home, app, ok);
    expect(r.status).toBe("superseded");
    expect(await lipoArchs(path.join(app, MAIN))).toEqual(["arm64"]);
    expect(journalNames()).toEqual(before);
  });

  it("a missing file → superseded; no backup → nothing-to-do; no app → unreachable", async () => {
    expect((await restoreAppFromNewestBackup(home, app)).status).toBe("nothing-to-do");
    expect((await restoreAppFromNewestBackup(home, path.join(base, "apps", "Gone.app"))).status).toBe("unreachable");
    await thin();
    fs.rmSync(path.join(app, HELPER));
    const r = await restoreAppFromNewestBackup(home, app, ok);
    expect(r.status).toBe("superseded");
    expect(await lipoArchs(path.join(app, MAIN))).toEqual(["arm64"]);
  });

  it("picks the newest real backup dir; older dirs and symlinked ones are ignored", async () => {
    const o = await thin();
    const hd = path.dirname(o.backupDir!);
    // garbage that would fail the restore if it were picked: an older dir and a symlink to a newer one
    const garbage = (d: string) => {
      fs.mkdirSync(path.join(d, "Contents", "MacOS"), { recursive: true });
      fs.writeFileSync(path.join(d, MAIN), "not the original");
    };
    garbage(path.join(hd, "1-older"));
    fs.utimesSync(path.join(hd, "1-older"), new Date(0), new Date(0));
    const outside = path.join(base, "t", "outside");
    garbage(outside);
    const future = new Date(Date.now() + 86_400_000);
    fs.utimesSync(outside, future, future);
    fs.symlinkSync(outside, path.join(hd, "1-zlink"));

    expect((await restoreAppFromNewestBackup(home, app)).status).toBe("restored");
    for (const rel of [MAIN, HELPER]) expect(sha(path.join(app, rel))).toBe(orig[rel]);
  });

  it("prune <app> removes its backups regardless of age, but keeps one an incomplete entry references", async () => {
    const o = await thin();
    const hd = path.join(home.backups, bundleHash(app));
    const runId = newRunId();
    const pending: JournalEntry = {
      runId, seq: 0, bundle: app, bundleId: null, version: "1.0", build: "1", backupDir: o.backupDir!,
      stagingDir: path.join(home.staging, `${runId}-0`), files: [], phase: "restore-failed",
    };
    await writeEntry(home, pending);
    let r = await pruneBackups(home, app);
    expect(r).toEqual({ removedDirs: [], freedBytes: 0, heldDirs: [o.backupDir] });
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
    expect(await pruneBackups(home, path.join(base, "apps", "Other.app"))).toEqual({ removedDirs: [], freedBytes: 0, heldDirs: [] });
    expect(fs.existsSync(o.backupDir!)).toBe(true);
    const r = await pruneBackups(home);
    expect(r.removedDirs).toEqual([o.backupDir]);
    expect(fs.readdirSync(home.backups)).toEqual([]);
  });
});
