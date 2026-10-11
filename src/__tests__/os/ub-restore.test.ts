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
    entry = {
      runId: "r1", seq: 0, bundle: app, bundleId: "com.squeaky.fixture.x", version: "1.0", build: "1",
      backupDir: backupDirFor(h, app, "1", "r1"), stagingDir: path.join(h.staging, "r1-0"),
      files: [fileEntry(rel)], phase: "staged",
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const okVerify = { verify: async () => ({ ok: true, errorText: "" }) };
  const fileEntry = (r: string) => {
    const st = fs.statSync(path.join(app, r));
    return { rel: r, origIno: st.ino, origSize: st.size, origMtimeMs: st.mtimeMs };
  };
  const replaceWithNewInode = (p: string, text: string) => {
    const t = path.join(tmp, "new.bin");
    fs.writeFileSync(t, text);
    fs.renameSync(t, p);
  };
  /** deps.stat seam: makeStagingDir stats after pass 1 and before any rename, so `fn` lands exactly between them. */
  const raceOnce = (fn: () => void) => {
    let done = false;
    return (async (p: fs.PathLike) => {
      if (!done) {
        done = true;
        fn();
      }
      return fs.promises.stat(p);
    }) as unknown as typeof fs.promises.stat;
  };
  const addMainExe = () => {
    const mainRel = "Contents/MacOS/fixture-main";
    entry.files.push(fileEntry(mainRel)); // after the helper: files[1]
    return { mainRel, mainFile: path.join(app, mainRel) };
  };

  /** Simulate the thinner up to `phase` for every journaled file: back up, stage thin, (for swapping) rename over the original. */
  async function thin(phase: JournalPhase) {
    for (const f of entry.files) {
      const src = path.join(app, f.rel);
      const staged = path.join(entry.stagingDir, f.rel);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      await lipoThin(src, staged);
      if (phase !== "staged") await backupFile(src, path.join(entry.backupDir, f.rel));
      if (phase === "swapping") {
        fs.chmodSync(staged, fs.statSync(src).mode & 0o7777);
        const st = fs.statSync(staged);
        f.thinIno = st.ino;
        f.thinSize = st.size;
        fs.renameSync(staged, src);
      }
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
    const res = await recoverJournal(h, "other");
    expect(res.map((x) => x.result)).toEqual(["cleaned"]);
    expect(res[0].notes.join("\n")).toMatch(/not a squeaky staging location/);
    expect(fs.readFileSync(path.join(victim, "keep.txt"), "utf8")).toBe("precious");
  });

  it("mixed: the LAST file replaced, an earlier one still thin -> restore-failed naming it, nothing written, entry still held", async () => {
    const { mainRel, mainFile } = addMainExe();
    await thin("swapping");
    const thinSha = sha(file);
    replaceWithNewInode(mainFile, "app was updated"); // foreign comes after the thin: single-pass would write first
    const r = await restoreEntry(h, entry, okVerify);
    expect(r.status).toBe("restore-failed");
    expect(r.notes).toContain(
      `not restoring: ${mainRel} changed since the thin while 1 other file(s) are still squeaky's; nothing was written and the backup is kept`,
    );
    expect(sha(file)).toBe(thinSha); // still the thin, byte for byte
    expect(fs.readFileSync(mainFile, "utf8")).toBe("app was updated");
    // not terminal: retried by recovery, and its backup stays held against prune
    expect((await listIncomplete(h, "")).map((e) => e.phase)).toEqual(["restore-failed"]);
    expect(fs.existsSync(path.join(entry.backupDir, rel))).toBe(true);
    expect((await recoverJournal(h, "other", okVerify)).map((x) => x.result)).toEqual(["restore-failed"]);
  });

  it("a file with no thinIno that is no longer the original is foreign -> superseded", async () => {
    await thin("backed-up");
    replaceWithNewInode(file, "app was updated");
    entry.phase = "swapping";
    await writeEntry(h, entry);
    expect((await restoreEntry(h, entry)).status).toBe("superseded");
    expect(fs.readFileSync(file, "utf8")).toBe("app was updated");
  });

  it("a transient error (EACCES) is restore-failed and retried, never superseded", async () => {
    await thin("swapping");
    const macos = path.join(app, "Contents", "MacOS");
    const mode = fs.statSync(macos).mode & 0o7777;
    fs.chmodSync(macos, 0o000);
    try {
      expect((await restoreEntry(h, entry)).status).toBe("restore-failed");
      expect((await listIncomplete(h, ""))[0].phase).toBe("restore-failed");
    } finally {
      fs.chmodSync(macos, mode);
    }
    expect((await recoverJournal(h, "other")).map((x) => x.result)).toEqual(["restored"]);
    expect(sha(file)).toBe(origSha);
  });

  it("a backup that is a symlink, or reached through one, is never read -> restore-failed, target untouched", async () => {
    await thin("swapping");
    const thinSha = sha(file);
    const backup = path.join(entry.backupDir, rel);
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(outside);
    // parent component symlinked out of backups/: lstat sees a regular file, realpath escapes
    fs.renameSync(path.join(entry.backupDir, "Contents"), path.join(outside, "Contents"));
    fs.symlinkSync(path.join(outside, "Contents"), path.join(entry.backupDir, "Contents"));
    expect((await restoreEntry(h, entry, okVerify)).status).toBe("restore-failed");
    expect(sha(file)).toBe(thinSha);
    // the backup itself is a symlink (to a perfectly good original outside backups/)
    fs.rmSync(path.join(entry.backupDir, "Contents"));
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.symlinkSync(path.join(outside, rel), backup);
    expect((await restoreEntry(h, entry, okVerify)).status).toBe("restore-failed");
    expect(sha(file)).toBe(thinSha);
  });

  it("a backup of the right size that is not a fat arm64+x86_64 Mach-O is never installed", async () => {
    await thin("swapping");
    const thinBytes = fs.readFileSync(file);
    const { origSize } = entry.files[0];
    const backup = path.join(entry.backupDir, rel);
    const paddedThin = Buffer.concat([thinBytes, Buffer.alloc(origSize - thinBytes.length)]);
    for (const bytes of [Buffer.alloc(origSize), paddedThin]) {
      fs.writeFileSync(backup, bytes);
      const r = await restoreEntry(h, entry, okVerify);
      expect(r.status).toBe("restore-failed");
      expect(fs.readFileSync(file).equals(thinBytes)).toBe(true);
    }
    expect(fs.readdirSync(h.staging).filter((n) => n.includes("restore"))).toEqual([]);
  });

  it("a file replaced between classification and swap is not overwritten -> restore-failed, then superseded", async () => {
    await thin("swapping");
    const stat = raceOnce(() => replaceWithNewInode(file, "app was updated"));
    expect((await restoreEntry(h, entry, { ...okVerify, stat })).status).toBe("restore-failed");
    expect(fs.readFileSync(file, "utf8")).toBe("app was updated");
    expect((await restoreEntry(h, entry, okVerify)).status).toBe("superseded");
  });

  it("a parent dir swapped for a symlink between the passes cannot redirect the rename out of the bundle", async () => {
    await thin("swapping");
    const thinSha = sha(file);
    const macos = path.join(app, "Contents", "MacOS");
    const outside = path.join(tmp, "outside-MacOS");
    const stat = raceOnce(() => {
      fs.renameSync(macos, outside); // same inodes, now reached through a symlink
      fs.symlinkSync(outside, macos);
    });
    expect((await restoreEntry(h, entry, { ...okVerify, stat })).status).toBe("restore-failed");
    expect(sha(path.join(outside, "fixture-helper"))).toBe(thinSha);
  });

  it("the mode is set on the staged copy before the rename, never on the file inside the bundle", async () => {
    await thin("swapping");
    const log: string[] = [];
    const { chmod, rename } = fs.promises;
    vi.spyOn(fs.promises, "chmod").mockImplementation(async (p, m) => {
      log.push(`chmod ${String(p)}`);
      return chmod(p, m);
    });
    vi.spyOn(fs.promises, "rename").mockImplementation(async (a, b) => {
      log.push(`rename ${String(b)}`);
      return rename(a, b);
    });
    expect((await restoreEntry(h, entry, okVerify)).status).toBe("restored");
    const swap = log.indexOf(`rename ${file}`);
    expect(swap).toBeGreaterThan(-1);
    expect(log.slice(0, swap).some((l) => l.startsWith("chmod ") && l.endsWith(`${rel}.restore`))).toBe(true);
    expect(log).not.toContain(`chmod ${file}`);
    expect(sha(file)).toBe(origSha);
  });

  it("a bad backup for a later file fails the entry before anything is renamed", async () => {
    const { mainRel, mainFile } = addMainExe();
    await thin("swapping");
    const before = [sha(file), sha(mainFile)];
    fs.writeFileSync(path.join(entry.backupDir, mainRel), Buffer.alloc(entry.files[1].origSize)); // right size, not fat
    expect((await restoreEntry(h, entry, okVerify)).status).toBe("restore-failed");
    expect([sha(file), sha(mainFile)]).toEqual(before); // the helper (first) was not swapped back either
  });

  it("recoverJournal removes the crashed run's own staging dir once its restore succeeds", async () => {
    await thin("swapping");
    expect(fs.existsSync(entry.stagingDir)).toBe(true);
    const res = await recoverJournal(h, "other");
    expect(res.map((x) => x.result)).toEqual(["restored"]);
    expect(fs.existsSync(entry.stagingDir)).toBe(false);
    expect(sha(file)).toBe(origSha);
  });
});
