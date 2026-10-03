import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  const writeLock = (o: object) => fs.writeFileSync(lockPath, JSON.stringify(o), { mode: 0o600 });
  const deadPid = () => spawnSync("/usr/bin/true").pid!;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ub-lock-")));
    h = { home: tmp, staging: path.join(tmp, "staging"), backups: path.join(tmp, "backups"), journal: path.join(tmp, "journal") };
    lockPath = path.join(tmp, "agent.lock");
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
    writeLock({ runId: "x", pid: deadPid(), processStart: "Thu Jan  1 00:00:00 1970" });
    const a = await acquireLock(h, { waitMs: 0 });
    expect(a).not.toBeNull();
    expect((await readLock(h))!.runId).toBe(a!.runId);
    expect(fs.readdirSync(tmp)).toEqual(["agent.lock"]);
    expect(fs.statSync(lockPath).mode & 0o777).toBe(0o600);
  });

  it("takes over on pid reuse (live pid, different start time)", async () => {
    writeLock({ runId: "x", pid: process.pid, processStart: "Thu Jan  1 00:00:00 1970" });
    expect(await acquireLock(h, { waitMs: 0 })).not.toBeNull();
  });

  it("never takes over a live holder regardless of age", async () => {
    const a = await acquireLock(h, { waitMs: 0 });
    fs.utimesSync(lockPath, 0, 0);
    expect(await acquireLock(h, { waitMs: 0 })).toBeNull();
    await a!.release();
  });

  it("treats an empty/unparseable lock as held-alive", async () => {
    fs.writeFileSync(lockPath, "");
    expect(await acquireLock(h, { waitMs: 100, pollMs: 20 })).toBeNull();
    fs.writeFileSync(lockPath, "{not json");
    expect(await acquireLock(h, { waitMs: 100, pollMs: 20 })).toBeNull();
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("exactly one of 8 concurrent acquirers on a stale lock wins", async () => {
    for (let i = 0; i < 20; i++) {
      writeLock({ runId: "x", pid: deadPid(), processStart: "Thu Jan  1 00:00:00 1970" });
      const hs = await Promise.all(Array.from({ length: 8 }, () => acquireLock(h, { waitMs: 0 })));
      expect(hs.filter(Boolean)).toHaveLength(1);
      expect(fs.readdirSync(tmp)).toEqual(["agent.lock"]);
      await hs.find(Boolean)!.release();
    }
  });

  it("a live holder is not stolen when the checker runs under another TZ/locale", async () => {
    const start = (env: NodeJS.ProcessEnv) =>
      spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env }).stdout.trim();
    // Canonical form is what the holder records (LC_ALL=C, TZ=UTC0).
    writeLock({ runId: "other", pid: process.pid, processStart: start({ ...process.env, LC_ALL: "C", TZ: "UTC0" }) });
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
