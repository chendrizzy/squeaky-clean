import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { acquireLock, readLock, newRunId } from "../../ub/lock";
import type { AgentHome } from "../../ub/paths";

const gate = process.platform === "darwin" && process.arch === "arm64";

describe.skipIf(!gate)("ub run lock", () => {
  let tmp: string;
  let h: AgentHome;
  let lockPath: string;
  const writeLock = (o: object) =>
    fs.writeFileSync(lockPath, JSON.stringify(o), { mode: 0o600 });
  const deadPid = () => spawnSync("/usr/bin/true").pid!;
  // what a live holder records: lstart under LC_ALL=C TZ=UTC0
  const ourStart = () =>
    spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(process.pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC0" },
    }).stdout.trim();
  let claimPath: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ub-lock-")));
    h = {
      home: tmp,
      staging: path.join(tmp, "staging"),
      backups: path.join(tmp, "backups"),
      journal: path.join(tmp, "journal"),
    };
    lockPath = path.join(tmp, "agent.lock");
    claimPath = lockPath + ".claim";
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("second acquirer gets null while holder is alive", async () => {
    const a = await acquireLock(h, { waitMs: 0 });
    expect(a).not.toBeNull();
    expect(await acquireLock(h, { waitMs: 200, pollMs: 50 })).toBeNull();
    await a!.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("takes over a lock whose pid is dead and leaves no stale files", async () => {
    writeLock({
      runId: "x",
      pid: deadPid(),
      processStart: "Thu Jan  1 00:00:00 1970",
    });
    const a = await acquireLock(h, { waitMs: 0 });
    expect(a).not.toBeNull();
    expect((await readLock(h))!.runId).toBe(a!.runId);
    expect(fs.readdirSync(tmp)).toEqual(["agent.lock"]);
    expect(fs.statSync(lockPath).mode & 0o777).toBe(0o600);
  });

  it("takes over on pid reuse (live pid, different start time)", async () => {
    writeLock({
      runId: "x",
      pid: process.pid,
      processStart: "Thu Jan  1 00:00:00 1970",
    });
    expect(await acquireLock(h, { waitMs: 0 })).not.toBeNull();
  });

  it("never takes over a live holder regardless of age", async () => {
    const a = await acquireLock(h, { waitMs: 0 });
    fs.utimesSync(lockPath, 0, 0);
    expect(await acquireLock(h, { waitMs: 0 })).toBeNull();
    await a!.release();
  });

  it("an empty or torn lock still unparseable after one poll is taken over (crash between create and write)", async () => {
    for (const raw of ["", "{not json"]) {
      fs.writeFileSync(lockPath, raw);
      const a = await acquireLock(h, { waitMs: 0, pollMs: 20 });
      expect(a).not.toBeNull();
      expect((await readLock(h))!.runId).toBe(a!.runId);
      expect(fs.readdirSync(tmp)).toEqual(["agent.lock"]);
      await a!.release();
    }
  });

  it("a lock that becomes valid within the poll is respected (its writer was between create and write)", async () => {
    fs.writeFileSync(lockPath, "");
    const valid = JSON.stringify({
      runId: "w",
      pid: process.pid,
      processStart: ourStart(),
    });
    // The writer finishes 100 ms after acquireLock first READS the empty lock (not after it starts, which
    // includes a ps spawn): inside the 1000 ms poll, long after an acquirer without one would have taken over.
    let t: NodeJS.Timeout | undefined;
    let armed = true;
    const realOpen = fs.promises.open;
    const spy = vi.spyOn(fs.promises, "open").mockImplementation((async (
      ...a: Parameters<typeof realOpen>
    ) => {
      const fh = await realOpen(...a);
      if (armed && a[0] === lockPath && a[1] === "r") {
        armed = false;
        const read = fh.readFile.bind(fh);
        fh.readFile = (async (...r: Parameters<typeof read>) => {
          const out = await read(...r);
          t = setTimeout(() => fs.writeFileSync(lockPath, valid), 100);
          return out;
        }) as typeof fh.readFile;
      }
      return fh;
    }) as typeof realOpen);
    try {
      expect(await acquireLock(h, { waitMs: 0, pollMs: 1000 })).toBeNull();
    } finally {
      spy.mockRestore();
      clearTimeout(t);
    }
    expect(t).toBeDefined(); // the first read saw the empty lock
    expect((await readLock(h))!.runId).toBe("w");
  });

  it("a stalled claimer whose claim was cleared and replaced neither proceeds nor unlinks the other claim", async () => {
    writeLock({
      runId: "x",
      pid: deadPid(),
      processStart: "Thu Jan  1 00:00:00 1970",
    });
    const other = JSON.stringify({
      runId: "c",
      pid: process.pid,
      processStart: ourStart(),
    });
    let armed = true;
    const realOpen = fs.promises.open;
    const spy = vi.spyOn(fs.promises, "open").mockImplementation((async (
      ...a: Parameters<typeof realOpen>
    ) => {
      const fh = await realOpen(...a);
      if (armed && a[0] === claimPath && typeof a[1] === "number") {
        armed = false;
        // stalled between its O_EXCL create and its write, this claimer's empty claim is judged dead by
        // another racer, moved aside, and replaced by that racer's own claim
        fs.renameSync(claimPath, claimPath + ".cleared");
        fs.writeFileSync(claimPath, other, { mode: 0o600 });
      }
      return fh;
    }) as typeof realOpen);
    try {
      expect(await acquireLock(h, { waitMs: 0, pollMs: 20 })).toBeNull();
    } finally {
      spy.mockRestore();
    }
    expect(armed).toBe(false);
    expect(fs.readFileSync(claimPath, "utf8")).toBe(other);
    expect((await readLock(h))!.runId).toBe("x");
  });

  it("a lock replaced between the re-check and the rename is put back, not displaced", async () => {
    writeLock({
      runId: "x",
      pid: deadPid(),
      processStart: "Thu Jan  1 00:00:00 1970",
    });
    const live = JSON.stringify({
      runId: "live",
      pid: process.pid,
      processStart: ourStart(),
    });
    let liveIno = 0;
    const realRename = fs.promises.rename;
    const spy = vi
      .spyOn(fs.promises, "rename")
      .mockImplementation(async (from, to) => {
        if (from === lockPath && !liveIno) {
          // a racer replaced the dead lock just after this acquirer re-checked it
          fs.writeFileSync(lockPath + ".new", live, { mode: 0o600 });
          fs.renameSync(lockPath + ".new", lockPath);
          liveIno = fs.statSync(lockPath).ino;
        }
        return realRename(from, to);
      });
    try {
      expect(await acquireLock(h, { waitMs: 0, pollMs: 20 })).toBeNull();
    } finally {
      spy.mockRestore();
    }
    expect(liveIno).not.toBe(0);
    expect(fs.statSync(lockPath).ino).toBe(liveIno);
    expect((await readLock(h))!.runId).toBe("live");
    expect(fs.readdirSync(tmp)).toEqual(["agent.lock"]);
  });

  it("a leftover claim from a dead (or never-written) claimer is cleared and the stale lock taken over", async () => {
    for (const claim of [
      JSON.stringify({
        runId: "c",
        pid: deadPid(),
        processStart: "Thu Jan  1 00:00:00 1970",
      }),
      "",
    ]) {
      writeLock({
        runId: "x",
        pid: deadPid(),
        processStart: "Thu Jan  1 00:00:00 1970",
      });
      fs.writeFileSync(claimPath, claim, { mode: 0o600 });
      const a = await acquireLock(h, { waitMs: 0, pollMs: 20 });
      expect(a).not.toBeNull();
      expect(fs.readdirSync(tmp)).toEqual(["agent.lock"]);
      await a!.release();
    }
  });

  it("a live claimer's claim is respected: no takeover, claim untouched", async () => {
    writeLock({
      runId: "x",
      pid: deadPid(),
      processStart: "Thu Jan  1 00:00:00 1970",
    });
    const live = JSON.stringify({
      runId: "c",
      pid: process.pid,
      processStart: ourStart(),
    });
    fs.writeFileSync(claimPath, live, { mode: 0o600 });
    expect(await acquireLock(h, { waitMs: 0, pollMs: 20 })).toBeNull();
    expect(fs.readFileSync(claimPath, "utf8")).toBe(live);
    expect((await readLock(h))!.runId).toBe("x");
  });

  it("an overlong runId in the lock never becomes a file name (no ENAMETOOLONG)", async () => {
    writeLock({
      runId: "r".repeat(1000),
      pid: deadPid(),
      processStart: "Thu Jan  1 00:00:00 1970",
    });
    const a = await acquireLock(h, { waitMs: 0, pollMs: 20 });
    expect(a).not.toBeNull();
    expect(fs.readdirSync(tmp)).toEqual(["agent.lock"]);
  });

  it("exactly one of 8 concurrent acquirers on a stale lock wins", async () => {
    for (let i = 0; i < 20; i++) {
      writeLock({
        runId: "x",
        pid: deadPid(),
        processStart: "Thu Jan  1 00:00:00 1970",
      });
      const hs = await Promise.all(
        Array.from({ length: 8 }, () => acquireLock(h, { waitMs: 0 })),
      );
      expect(hs.filter(Boolean)).toHaveLength(1);
      expect(fs.readdirSync(tmp)).toEqual(["agent.lock"]);
      await hs.find(Boolean)!.release();
    }
  });

  it("a live holder is not stolen when the checker runs under another TZ/locale", async () => {
    const start = (env: NodeJS.ProcessEnv) =>
      spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(process.pid)], {
        encoding: "utf8",
        env,
      }).stdout.trim();
    // Canonical form is what the holder records (LC_ALL=C, TZ=UTC0).
    writeLock({
      runId: "other",
      pid: process.pid,
      processStart: start({ ...process.env, LC_ALL: "C", TZ: "UTC0" }),
    });
    const saved = { TZ: process.env.TZ, LC_ALL: process.env.LC_ALL };
    process.env.TZ = "Asia/Tokyo";
    process.env.LC_ALL = "de_DE.UTF-8";
    try {
      expect(await acquireLock(h, { waitMs: 0 })).toBeNull();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("release does not delete someone else's lock", async () => {
    const a = await acquireLock(h, { waitMs: 0 });
    writeLock({ runId: "other", pid: process.pid, processStart: "whatever" });
    await a!.release();
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("newRunId is unique and separator-free of '/'", () => {
    const ids = new Set(Array.from({ length: 100 }, newRunId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]+-\d+-\d+$/);
  });
});
