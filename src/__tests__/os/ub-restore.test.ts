import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { restoreEntry, recoverJournal } from "../../ub/restore";
import { writeEntry, listIncomplete, type JournalEntry, type JournalPhase } from "../../ub/journal";
import { backupFile } from "../../ub/backups";
import { backupDirFor, type AgentHome } from "../../ub/paths";
import { lipoThin, lipoArchs } from "../../ub/exec";
import { buildFixtureApp, hasToolchain } from "./helpers/ubFixture";

const gate = process.platform === "darwin" && process.arch === "arm64" && hasToolchain();
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

describe.skipIf(!gate)("ub restore and journal recovery", () => {
  let tmp: string;
  let h: AgentHome;
  let app: string;
  let rel: string;
  let file: string;
  let origSha: string;
  let entry: JournalEntry;

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ub-restore-")));
    h = { home: tmp, staging: path.join(tmp, "agent", "staging"), backups: path.join(tmp, "agent", "backups"), journal: path.join(tmp, "agent", "journal") };
    for (const d of [h.staging, h.backups, h.journal]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    const dir = path.join(tmp, "apps");
    fs.mkdirSync(dir);
    const f = await buildFixtureApp(dir, { helper: true });
    app = fs.realpathSync(f.app);
    rel = "Contents/MacOS/fixture-helper";
    file = path.join(app, rel);
    origSha = sha(file);
    const st = fs.statSync(file);
    entry = {
      runId: "r1", seq: 0, bundle: app, bundleId: "com.squeaky.fixture.x", version: "1.0", build: "1",
      backupDir: backupDirFor(h, app, "1", "r1"), stagingDir: path.join(h.staging, "r1-0"),
      files: [{ rel, origIno: st.ino, origSize: st.size, origMtimeMs: st.mtimeMs }], phase: "staged",
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** Simulate the thinner up to `phase`: back up, stage thin, (for swapping) rename over the original. */
  async function thin(phase: JournalPhase) {
    fs.mkdirSync(entry.stagingDir, { recursive: true });
    const staged = path.join(entry.stagingDir, rel);
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    await lipoThin(file, staged);
    if (phase !== "staged") await backupFile(file, path.join(entry.backupDir, rel));
    if (phase === "swapping") {
      fs.chmodSync(staged, fs.statSync(file).mode & 0o7777);
      const st = fs.statSync(staged);
      entry.files[0].thinIno = st.ino;
      entry.files[0].thinSize = st.size;
      fs.renameSync(staged, file);
    }
    entry.phase = phase;
    await writeEntry(h, entry);
  }

  it("phase swapping: restores a swapped file byte-identically and verifies", async () => {
    await thin("swapping");
    expect(await lipoArchs(file)).toEqual(["arm64"]);
    const r = await restoreEntry(h, entry);
    expect(r).toEqual({ status: "restored", notes: [] });
    expect(sha(file)).toBe(origSha);
    expect(fs.readdirSync(h.staging).filter((n) => n.includes("restore"))).toEqual([]);
    expect(await listIncomplete(h, "")).toEqual([]); // journal phase is now restored
  });

  it("phase backed-up: originals untouched, staging+backups removed", async () => {
    await thin("backed-up");
    const res = await recoverJournal(h, "other");
    expect(res.map((x) => x.result)).toEqual(["cleaned"]);
    expect(sha(file)).toBe(origSha);
    expect(fs.existsSync(entry.stagingDir)).toBe(false);
    expect(fs.existsSync(entry.backupDir)).toBe(false);
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it("never restores a truncated backup: phase backed-up with truncated .tmp -> cleaned, original intact", async () => {
    await thin("staged");
    fs.mkdirSync(path.dirname(path.join(entry.backupDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(entry.backupDir, rel) + ".tmp", "trunc");
    entry.phase = "backed-up";
    await writeEntry(h, entry);
    expect((await recoverJournal(h, "other")).map((x) => x.result)).toEqual(["cleaned"]);
    expect(sha(file)).toBe(origSha);
    expect(fs.existsSync(entry.backupDir)).toBe(false);
  });

  it("identity mismatch (file replaced after thin) -> superseded, file untouched", async () => {
    await thin("swapping");
    const newBytes = path.join(tmp, "new.bin");
    fs.writeFileSync(newBytes, "app was updated");
    fs.renameSync(newBytes, file); // new inode
    fs.writeFileSync(newBytes, "app was updated"); // same bytes elsewhere for the hash compare
    const r = await restoreEntry(h, entry);
    expect(r.status).toBe("superseded");
    expect(sha(file)).toBe(sha(newBytes));
  });

  it("keeps journal entry when bundle is unreachable", async () => {
    await thin("swapping");
    fs.renameSync(app, app + ".away");
    expect((await restoreEntry(h, entry)).status).toBe("unreachable");
    const left = await listIncomplete(h, "");
    expect(left).toHaveLength(1);
    expect(left[0].phase).toBe("swapping");
  });

  it("restore-failed when post-restore verify fails (stray file planted in bundle)", async () => {
    await thin("swapping");
    fs.writeFileSync(path.join(app, "Contents", "stray.txt"), "x");
    const r = await restoreEntry(h, entry);
    expect(r.status).toBe("restore-failed");
    expect(sha(file)).toBe(origSha); // bytes were restored; backup kept for retry
    expect(fs.existsSync(path.join(entry.backupDir, rel))).toBe(true);
    expect((await listIncomplete(h, ""))[0].phase).toBe("restore-failed");
  });

  it("retry after restore-failed re-verifies its own restored file instead of calling it superseded", async () => {
    await thin("swapping");
    const stray = path.join(app, "Contents", "stray.txt");
    fs.writeFileSync(stray, "x");
    expect((await restoreEntry(h, entry)).status).toBe("restore-failed");
    const [first] = await listIncomplete(h, "");
    expect(first.files[0].restoredIno).toBeDefined();
    expect((await recoverJournal(h, "other")).map((x) => x.result)).toEqual(["restore-failed"]);
    fs.rmSync(stray);
    expect((await recoverJournal(h, "other")).map((x) => x.result)).toEqual(["restored"]);
    expect(sha(file)).toBe(origSha);
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it("a thinned file deleted after the swap is skipped, not restore-failed", async () => {
    await thin("swapping");
    fs.rmSync(file);
    const r = await restoreEntry(h, entry);
    expect(r.status).toBe("superseded");
    expect(r.notes).toHaveLength(1);
    expect(await listIncomplete(h, "")).toEqual([]);
  });

  it("staging creation failure maps to restore-failed instead of throwing", async () => {
    await thin("swapping");
    fs.rmSync(h.staging, { recursive: true, force: true });
    const r = await restoreEntry(h, entry);
    expect(r.status).toBe("restore-failed");
    expect(r.notes.length).toBeGreaterThan(0);
    expect((await listIncomplete(h, ""))[0].phase).toBe("restore-failed");
  });

  it("rollback with deps.verify stub reports restored", async () => {
    await thin("swapping");
    fs.writeFileSync(path.join(app, "Contents", "stray.txt"), "x");
    const r = await restoreEntry(h, entry, { verify: async () => ({ ok: true, errorText: "" }) });
    expect(r.status).toBe("restored");
  });

  it("current file already original -> nothing-to-do", async () => {
    await thin("backed-up");
    entry.files[0].thinIno = 999999999;
    entry.files[0].thinSize = 1;
    entry.phase = "swapping";
    await writeEntry(h, entry);
    expect((await restoreEntry(h, entry)).status).toBe("nothing-to-do");
    expect(sha(file)).toBe(origSha);
  });

  it("recoverJournal does not remove a forged stagingDir outside staging/mount point", async () => {
    const victim = path.join(tmp, "victim", `.squeaky-ub-staging-${process.getuid!()}-forged`);
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, "keep.txt"), "precious");
    entry.stagingDir = victim;
    entry.phase = "staged";
    await writeEntry(h, entry);
    expect((await recoverJournal(h, "other")).map((x) => x.result)).toEqual(["cleaned"]);
    expect(fs.readFileSync(path.join(victim, "keep.txt"), "utf8")).toBe("precious");
  });

  it("writeEntry throws for an entry that fails validation", async () => {
    await expect(writeEntry(h, { ...entry, backupDir: "/tmp/evil" })).rejects.toThrow(/invalid entry/);
    expect(fs.readdirSync(h.journal)).toEqual([]);
  });
});
