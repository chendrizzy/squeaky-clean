import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeEntry, listIncomplete, validateEntry, removeEntry, type JournalEntry } from "../../ub/journal";
import { backupFile, pruneExpiredBackups } from "../../ub/backups";
import type { AgentHome } from "../../ub/paths";

const gate = process.platform === "darwin" && process.arch === "arm64";

describe.skipIf(!gate)("ub journal and backups", () => {
  let tmp: string;
  let h: AgentHome;
  const mk = (over: Partial<JournalEntry> = {}): JournalEntry => ({
    runId: "abc-1-1",
    seq: 0,
    bundle: "/Applications/Foo.app",
    bundleId: "com.foo",
    version: "1.0",
    build: "1",
    backupDir: path.join(h.backups, "h", "1-abc-1-1"),
    stagingDir: path.join(h.staging, "abc-1-1-0"),
    files: [{ rel: "Contents/MacOS/foo", origIno: 5, origSize: 100, origMtimeMs: 1.5e12 }],
    phase: "staged",
    ...over,
  });
  const writeRaw = (e: unknown, name?: string) => {
    const x = e as JournalEntry;
    fs.writeFileSync(path.join(h.journal, name ?? `${x.runId}-${x.seq}.json`), JSON.stringify(e));
  };

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ub-journal-")));
    h = { home: tmp, staging: path.join(tmp, "staging"), backups: path.join(tmp, "backups"), journal: path.join(tmp, "journal") };
    for (const d of [h.staging, h.backups, h.journal]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writeEntry is atomic and listIncomplete skips done/restored/superseded", async () => {
    for (const [i, phase] of (["staged", "backed-up", "swapping", "done", "restored", "superseded", "restoring", "restore-failed"] as const).entries())
      await writeEntry(h, mk({ seq: i, phase }));
    expect(fs.readdirSync(h.journal).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const got = (await listIncomplete(h, "other")).map((e) => e.phase).sort();
    expect(got).toEqual(["backed-up", "restore-failed", "restoring", "staged", "swapping"]);
    await removeEntry(h, mk({ seq: 0 }));
    expect(fs.existsSync(path.join(h.journal, "abc-1-1-0.json"))).toBe(false);
    await removeEntry(h, mk({ seq: 0 })); // idempotent
  });

  it("rejects entries whose backupDir escapes home or rel contains ..", async () => {
    writeRaw(mk({ backupDir: "/tmp/evil" }));
    expect(await listIncomplete(h, "me")).toEqual([]);
    expect(fs.readdirSync(path.join(h.journal, "rejected"))).toHaveLength(1);
    writeRaw(mk({ seq: 1, files: [{ rel: "Contents/../../x", origIno: 1, origSize: 1, origMtimeMs: 1 }] }));
    expect(await listIncomplete(h, "me")).toEqual([]);
    expect(fs.readdirSync(path.join(h.journal, "rejected"))).toHaveLength(2);
  });

  it("validateEntry rejects malformed untrusted input", () => {
    const ok = mk();
    expect(validateEntry(h, ok)).toBe(true);
    const bad: unknown[] = [
      null, "x", [], { ...ok, phase: "weird" }, { ...ok, bundle: "rel/Foo.app" }, { ...ok, bundle: "/a/Foo" },
      { ...ok, runId: "a/b" }, { ...ok, runId: "" }, { ...ok, runId: "x".repeat(200) }, { ...ok, runId: ".." },
      { ...ok, seq: 1.5 }, { ...ok, seq: -1 }, { ...ok, stagingDir: "/tmp/elsewhere" },
      { ...ok, backupDir: h.backups + "/../x" }, { ...ok, backupDir: h.backups },
      { ...ok, files: "nope" }, { ...ok, files: [{ rel: "/abs", origIno: 1, origSize: 1, origMtimeMs: 1 }] },
      { ...ok, files: [{ rel: "a", origIno: 1.5, origSize: 1, origMtimeMs: 1 }] },
      { ...ok, files: [{ rel: "a", origIno: 1, origSize: "1", origMtimeMs: 1 }] },
      { ...ok, files: [{ rel: "a", origIno: 1, origSize: 1, origMtimeMs: 1, thinSize: 0.5 }] },
      { ...ok, bundleId: 5 }, { ...ok, version: 1 },
    ];
    for (const b of bad) expect(validateEntry(h, b), JSON.stringify(b)).toBe(false);
    const cross = mk({ stagingDir: `/Volumes/X/.squeaky-ub-staging-${process.getuid!()}-AbC123` });
    expect(validateEntry(h, cross)).toBe(true);
    expect(validateEntry(h, mk({ stagingDir: "/Volumes/X/.squeaky-ub-staging-0-AbC123" }))).toBe(process.getuid!() === 0);
  });

  it("rejects unparseable files and filename/identity mismatch", async () => {
    fs.writeFileSync(path.join(h.journal, "junk-1-1.json"), "{not json");
    writeRaw(mk(), "other-9-9.json");
    expect(await listIncomplete(h, "me")).toEqual([]);
    expect(fs.readdirSync(path.join(h.journal, "rejected"))).toHaveLength(2);
  });

  it("listIncomplete excludes the current runId", async () => {
    await writeEntry(h, mk());
    await writeEntry(h, mk({ runId: "zzz-2-1" }));
    expect((await listIncomplete(h, "abc-1-1")).map((e) => e.runId)).toEqual(["zzz-2-1"]);
  });

  it("backupFile copies, verifies, and leaves no .tmp", async () => {
    const src = path.join(tmp, "src.bin");
    fs.writeFileSync(src, Buffer.alloc(4096, 7));
    const dest = path.join(tmp, "b", "deep", "f.bin");
    await backupFile(src, dest);
    expect(fs.readFileSync(dest).equals(fs.readFileSync(src))).toBe(true);
    expect(fs.existsSync(dest + ".tmp")).toBe(false);
    expect(fs.statSync(path.dirname(dest)).mode & 0o777).toBe(0o700);
  });

  it("backupFile never leaves a final-named file when copy fails", async () => {
    const src = path.join(tmp, "src.bin");
    fs.writeFileSync(src, "hello");
    const dest = path.join(tmp, "out", "f.bin");
    const failing = vi.fn().mockRejectedValue(Object.assign(new Error("nospc"), { code: "ENOSPC" }));
    await expect(backupFile(src, dest, { copyFile: failing })).rejects.toThrow();
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + ".tmp")).toBe(false);
  });

  it("backupFile rejects a short copy and cleans up", async () => {
    const src = path.join(tmp, "src.bin");
    fs.writeFileSync(src, "hello world");
    const dest = path.join(tmp, "out", "f.bin");
    const truncating = vi.fn(async (_s: fs.PathLike, d: fs.PathLike) => fs.writeFileSync(d, "hel"));
    await expect(backupFile(src, dest, { copyFile: truncating as never })).rejects.toThrow(/size/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + ".tmp")).toBe(false);
  });

  const mkBackup = (hash: string, name: string, ageDays: number, bytes: number, now: number) => {
    const d = path.join(h.backups, hash, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "f"), Buffer.alloc(bytes));
    const t = new Date(now - ageDays * 86400000);
    fs.utimesSync(d, t, t);
    return d;
  };

  it("prune keeps backups referenced by an incomplete journal entry", async () => {
    const now = Date.now();
    const d = mkBackup("hh", "1-old-1-1", 10, 10, now);
    await writeEntry(h, mk({ backupDir: d, phase: "swapping" }));
    const r = await pruneExpiredBackups(h, 3, now);
    expect(r.removedDirs).toEqual([]);
    expect(fs.existsSync(d)).toBe(true);
    await writeEntry(h, mk({ backupDir: d, phase: "done" }));
    expect((await pruneExpiredBackups(h, 3, now)).removedDirs).toEqual([d]);
  });

  it("prune removes expired dirs and reports freed bytes", async () => {
    const now = Date.now();
    const old = mkBackup("hh", "1-a-1-1", 5, 1000, now);
    const fresh = mkBackup("hh", "1-b-1-2", 1, 500, now);
    const r = await pruneExpiredBackups(h, 3, now);
    expect(r.removedDirs).toEqual([old]);
    expect(r.freedBytes).toBe(1000);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect((await pruneExpiredBackups(h, 3, now + 10 * 86400000)).removedDirs).toEqual([fresh]);
    expect(fs.existsSync(path.join(h.backups, "hh"))).toBe(false);
  });
});
