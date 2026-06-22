import { describe, it, expect } from "vitest";
import * as path from "path";
import { Stats } from "fs";
import {
  TmpCleaner,
  TmpFs,
  analyzeTree,
  isWithinRoots,
  matchesNeverName,
  matchesClaimedName,
  tierForAgeDays,
  resolveTmpRoots,
  IN_USE_FLOOR_MS,
  DEFAULT_TMP_MAX_AGE_DAYS,
} from "../../cleaners/tmp";

// ---------------------------------------------------------------------------
// Fake filesystem: lets us model sockets/FIFOs, uids, symlinks and realpath
// escapes that memfs cannot represent. A node tree -> a TmpFs implementation.
// ---------------------------------------------------------------------------
type NodeType =
  | "dir"
  | "file"
  | "socket"
  | "fifo"
  | "symlink"
  | "block"
  | "char";

interface FakeNode {
  type: NodeType;
  ageDays?: number; // last activity = now - ageDays (sets mtime/ctime)
  atimeDays?: number; // independent atime (to prove atime is NOT used)
  uid?: number;
  blocks?: number;
  size?: number;
  unreadable?: boolean; // readdir throws (EACCES)
  realpath?: string; // override what realpath() resolves this path to
  children?: Record<string, FakeNode>;
}

// Effectively-infinite budgets so the walk never depends on wall-clock timing.
const BIG_BUDGET = { perCandidateMs: 1e12, globalMs: 1e12 };

function ownUid(): number {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

function fakeStat(node: FakeNode, now: number): Stats {
  const age = node.ageDays ?? 1;
  const mtimeMs = now - age * 86_400_000;
  const ctimeMs = mtimeMs;
  const atimeMs =
    node.atimeDays !== undefined ? now - node.atimeDays * 86_400_000 : mtimeMs;
  const t = node.type;
  return {
    uid: node.uid ?? ownUid(),
    mtimeMs,
    ctimeMs,
    atimeMs,
    blocks: node.blocks ?? (t === "file" ? 8 : 1),
    size: node.size ?? (t === "file" ? 4096 : 64),
    isSocket: () => t === "socket",
    isFIFO: () => t === "fifo",
    isBlockDevice: () => t === "block",
    isCharacterDevice: () => t === "char",
    isSymbolicLink: () => t === "symlink",
    isDirectory: () => t === "dir",
    isFile: () => t === "file",
  } as unknown as Stats;
}

function indexTree(roots: Record<string, FakeNode>): Map<string, FakeNode> {
  const map = new Map<string, FakeNode>();
  const walk = (p: string, node: FakeNode): void => {
    map.set(p, node);
    if (node.children) {
      for (const [name, child] of Object.entries(node.children)) {
        walk(path.join(p, name), child);
      }
    }
  };
  for (const [p, node] of Object.entries(roots)) walk(p, node);
  return map;
}

function makeFakeFs(
  roots: Record<string, FakeNode>,
  now: number,
): { fs: TmpFs; rmCalls: string[] } {
  const map = indexTree(roots);
  const rmCalls: string[] = [];
  const fs: TmpFs = {
    async readdir(p) {
      const node = map.get(p);
      if (!node || node.type !== "dir") throw new Error(`ENOTDIR ${p}`);
      if (node.unreadable) throw new Error(`EACCES ${p}`);
      return node.children ? Object.keys(node.children) : [];
    },
    async lstat(p) {
      const node = map.get(p);
      if (!node) throw new Error(`ENOENT ${p}`);
      return fakeStat(node, now);
    },
    async realpath(p) {
      return map.get(p)?.realpath ?? p;
    },
    async rm(p) {
      rmCalls.push(p);
    },
  };
  return { fs, rmCalls };
}

const budget = () => ({ deadline: Date.now() + 2000, nodesLeft: 50_000 });

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe("tmp: pure helpers", () => {
  it("isWithinRoots accepts strict descendants only", () => {
    expect(isWithinRoots("/tmp/foo", ["/tmp"])).toBe("/tmp");
    expect(isWithinRoots("/tmp/a/b", ["/tmp"])).toBe("/tmp");
  });

  it("isWithinRoots rejects the root itself (never a deletion target)", () => {
    expect(isWithinRoots("/tmp", ["/tmp"])).toBeNull();
  });

  it("isWithinRoots rejects sibling-prefix escapes", () => {
    // "/tmpevil" starts with "/tmp" as a string but is NOT under "/tmp/".
    expect(isWithinRoots("/tmpevil", ["/tmp"])).toBeNull();
    expect(isWithinRoots("/etc/passwd", ["/tmp", "/var/tmp"])).toBeNull();
  });

  it("matchesNeverName protects socket-wrapper / system dirs", () => {
    for (const n of ["ssh-AbCdEf", ".X11-unix", "tmux-1000", "dbus-x", "systemd-private-x", "com.apple.foo"]) {
      expect(matchesNeverName(n)).toBe(true);
    }
    expect(matchesNeverName("my-build-output")).toBe(false);
  });

  it("matchesClaimedName defers to dedicated cleaners", () => {
    expect(matchesClaimedName("go-build123456")).toBe(true);
    expect(matchesClaimedName("pip-cache")).toBe(true);
    expect(matchesClaimedName("pip-ephem-wheel-cache-abc")).toBe(true);
    expect(matchesClaimedName("project-tmp")).toBe(false);
  });

  it("tierForAgeDays bands match the conservative default", () => {
    const t = DEFAULT_TMP_MAX_AGE_DAYS;
    expect(tierForAgeDays(0, t)).toBe("caution");
    expect(tierForAgeDays(2, t)).toBe("caution");
    expect(tierForAgeDays(3, t)).toBe("probably-safe");
    expect(tierForAgeDays(29, t)).toBe("probably-safe");
    expect(tierForAgeDays(30, t)).toBe("safe");
  });

  it("resolveTmpRoots dedupes by realpath and drops missing dirs", () => {
    // /tmp and /private/tmp resolve to the same real path (macOS alias) -> one
    // entry; a missing root is dropped.
    const realMap: Record<string, string> = {
      "/tmp": "/private/tmp",
      "/private/tmp": "/private/tmp",
      "/var/tmp": "/private/var/tmp",
    };
    const fakeRealpath = (p: string): string => {
      if (!(p in realMap)) throw new Error(`ENOENT ${p}`);
      return realMap[p];
    };
    const fakeStat = (): { isDirectory(): boolean } => ({ isDirectory: () => true });
    const roots = resolveTmpRoots(
      ["/tmp", "/private/tmp", "/var/tmp", "/missing"],
      fakeRealpath,
      fakeStat,
    );
    expect(roots).toEqual(["/private/tmp", "/private/var/tmp"]);
    for (const r of roots) expect(path.isAbsolute(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// analyzeTree — the liveness guard
// ---------------------------------------------------------------------------
describe("tmp: analyzeTree subtree guard", () => {
  const now = Date.now();

  it("accepts an old, socket-free tree and sums size", async () => {
    const { fs } = makeFakeFs(
      {
        "/tmp/x": {
          type: "dir",
          ageDays: 10,
          children: {
            "a.bin": { type: "file", ageDays: 10, blocks: 100 },
            sub: {
              type: "dir",
              ageDays: 12,
              children: { "b.bin": { type: "file", ageDays: 9, blocks: 50 } },
            },
          },
        },
      },
      now,
    );
    const r = await analyzeTree("/tmp/x", await fs.lstat("/tmp/x"), now, budget(), fs);
    expect(r.eligible).toBe(true);
    expect(r.size).toBe((100 + 50) * 512 + 1 * 512 + 1 * 512); // files + 2 dirs
  });

  it("rejects a tree with a NESTED socket (top-level type check can't see it)", async () => {
    const { fs } = makeFakeFs(
      {
        "/tmp/x": {
          type: "dir",
          ageDays: 40,
          children: {
            deep: {
              type: "dir",
              ageDays: 40,
              children: { "live.sock": { type: "socket", ageDays: 40 } },
            },
          },
        },
      },
      now,
    );
    const r = await analyzeTree("/tmp/x", await fs.lstat("/tmp/x"), now, budget(), fs);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("special-file");
  });

  it("rejects a tree with any descendant inside the in-use floor", async () => {
    const freshAgeDays = IN_USE_FLOOR_MS / 2 / 86_400_000; // ~30 min
    const { fs } = makeFakeFs(
      {
        "/tmp/x": {
          type: "dir",
          ageDays: 40,
          children: { "writing.log": { type: "file", ageDays: freshAgeDays } },
        },
      },
      now,
    );
    const r = await analyzeTree("/tmp/x", await fs.lstat("/tmp/x"), now, budget(), fs);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("recently-active");
  });

  it("rejects an unreadable subtree rather than assuming it is safe", async () => {
    const { fs } = makeFakeFs(
      {
        "/tmp/x": {
          type: "dir",
          ageDays: 40,
          children: {
            locked: { type: "dir", ageDays: 40, unreadable: true, children: {} },
          },
        },
      },
      now,
    );
    const r = await analyzeTree("/tmp/x", await fs.lstat("/tmp/x"), now, budget(), fs);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("unreadable-subtree");
  });

  it("ignores symlinks inside the tree (never follows them)", async () => {
    const { fs } = makeFakeFs(
      {
        "/tmp/x": {
          type: "dir",
          ageDays: 10,
          children: { link: { type: "symlink", ageDays: 10, realpath: "/etc" } },
        },
      },
      now,
    );
    const r = await analyzeTree("/tmp/x", await fs.lstat("/tmp/x"), now, budget(), fs);
    expect(r.eligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TmpCleaner.getCacheCategories — eligibility + tiering
// ---------------------------------------------------------------------------
function sampleTree(now: number) {
  const freshAgeDays = IN_USE_FLOOR_MS / 4 / 86_400_000; // ~15 min
  return {
    "/tmp": {
      type: "dir" as const,
      ageDays: 50,
      children: {
        "old-dir": {
          type: "dir" as const,
          ageDays: 10,
          children: { "a.txt": { type: "file" as const, ageDays: 10, blocks: 200 } },
        },
        "ancient.log": { type: "file" as const, ageDays: 40, blocks: 100 },
        "fresh-work": {
          type: "dir" as const,
          ageDays: 1,
          children: { "b.txt": { type: "file" as const, ageDays: 1, blocks: 50 } },
        },
        "live.sock": { type: "socket" as const, ageDays: 10 },
        link: { type: "symlink" as const, ageDays: 10, realpath: "/etc" },
        "ssh-XXXX": {
          type: "dir" as const,
          ageDays: 10,
          children: { "agent.1": { type: "socket" as const, ageDays: 10 } },
        },
        "go-build987": {
          type: "dir" as const,
          ageDays: 10,
          children: { "x.o": { type: "file" as const, ageDays: 10 } },
        },
        "in-use.bin": { type: "file" as const, ageDays: freshAgeDays, blocks: 10 },
        "others.bin": { type: "file" as const, ageDays: 10, uid: 999999, blocks: 10 },
        "wraps-socket": {
          type: "dir" as const,
          ageDays: 10,
          children: {
            deep: {
              type: "dir" as const,
              ageDays: 10,
              children: { "s.sock": { type: "socket" as const, ageDays: 40 } },
            },
          },
        },
      },
    },
  };
}

describe("tmp: getCacheCategories", () => {
  it("offers only eligible entries, correctly tiered", async () => {
    const now = Date.now();
    const { fs } = makeFakeFs(sampleTree(now), now);
    const cleaner = new TmpCleaner(fs, ["/tmp"], BIG_BUDGET);
    const cats = await cleaner.getCacheCategories();

    const byName = new Map(cats.map((c) => [c.name, c]));
    // Eligible
    expect(byName.get("old-dir")?.safety).toBe("probably-safe");
    expect(byName.get("ancient.log")?.safety).toBe("safe");
    expect(byName.get("fresh-work")?.safety).toBe("caution");
    // Excluded by type / name / ownership / floor / nested-socket
    for (const excluded of [
      "live.sock",
      "link",
      "ssh-XXXX",
      "go-build987",
      "in-use.bin",
      "others.bin",
      "wraps-socket",
    ]) {
      // ownership exclusion is a no-op where getuid is unavailable (Windows)
      if (excluded === "others.bin" && typeof process.getuid !== "function") continue;
      expect(byName.has(excluded)).toBe(false);
    }

    // A root is never itself a candidate.
    for (const c of cats) {
      expect(c.paths.every((p) => p !== "/tmp" && p.startsWith("/tmp/"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TmpCleaner.clear — tier-gated deletion + containment guard
// ---------------------------------------------------------------------------
describe("tmp: clear() deletion", () => {
  it("balanced profile deletes only safe/probably-safe, never caution or excluded", async () => {
    const now = Date.now();
    const { fs, rmCalls } = makeFakeFs(sampleTree(now), now);
    const cleaner = new TmpCleaner(fs, ["/tmp"], BIG_BUDGET);

    await cleaner.clear(false, { safetyTiers: ["safe", "probably-safe"] }, undefined, []);

    expect(rmCalls).toContain("/tmp/old-dir");
    expect(rmCalls).toContain("/tmp/ancient.log");
    expect(rmCalls).not.toContain("/tmp/fresh-work"); // caution: protected by default
    // never the dangerous ones
    for (const danger of [
      "/tmp/live.sock",
      "/tmp/link",
      "/tmp/ssh-XXXX",
      "/tmp/in-use.bin",
      "/tmp/wraps-socket",
      "/tmp",
    ]) {
      expect(rmCalls).not.toContain(danger);
    }
  });

  it("aggressive profile additionally deletes the caution band, still never in-use/special", async () => {
    const now = Date.now();
    const { fs, rmCalls } = makeFakeFs(sampleTree(now), now);
    const cleaner = new TmpCleaner(fs, ["/tmp"], BIG_BUDGET);

    await cleaner.clear(
      false,
      { safetyTiers: ["safe", "probably-safe", "caution"] },
      undefined,
      [],
    );

    expect(rmCalls).toContain("/tmp/fresh-work");
    expect(rmCalls).not.toContain("/tmp/in-use.bin");
    expect(rmCalls).not.toContain("/tmp/live.sock");
    expect(rmCalls).not.toContain("/tmp/wraps-socket");
  });

  it("guarded deleter refuses a candidate whose realpath escapes the roots", async () => {
    const now = Date.now();
    const { fs, rmCalls } = makeFakeFs(
      {
        "/tmp": {
          type: "dir",
          ageDays: 50,
          children: {
            escape: {
              type: "dir",
              ageDays: 10,
              realpath: "/etc", // e.g. an ancestor symlink resolving outside tmp
              children: { "p.txt": { type: "file", ageDays: 10, blocks: 10 } },
            },
          },
        },
      },
      now,
    );
    const cleaner = new TmpCleaner(fs, ["/tmp"], BIG_BUDGET);
    await cleaner.clear(false, { safetyTiers: ["safe", "probably-safe"] }, undefined, []);
    expect(rmCalls).not.toContain("/tmp/escape");
    expect(rmCalls).not.toContain("/etc");
    expect(rmCalls).toHaveLength(0);
  });

  it("guarded deleter refuses a symlink path outright", async () => {
    const now = Date.now();
    const { fs, rmCalls } = makeFakeFs(
      { "/tmp/link": { type: "symlink", ageDays: 10, realpath: "/etc" } },
      now,
    );
    const cleaner = new TmpCleaner(fs, ["/tmp"], BIG_BUDGET);
    // Drive the protected deleter directly (defense-in-depth path).
    await (cleaner as unknown as { clearPath(p: string): Promise<void> }).clearPath(
      "/tmp/link",
    );
    expect(rmCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Review hardening: isolate each guard so a test fails if it is removed.
// ---------------------------------------------------------------------------
describe("tmp: review hardening", () => {
  const now = Date.now();

  it("rejects a directory containing a foreign-owned descendant (not just top-level)", async () => {
    if (typeof process.getuid !== "function") return; // ownership is a no-op on Windows
    const { fs } = makeFakeFs(
      {
        "/tmp/x": {
          type: "dir",
          ageDays: 10,
          children: {
            sub: {
              type: "dir",
              ageDays: 10,
              children: {
                "root-owned": { type: "file", ageDays: 10, uid: 999999, blocks: 10 },
              },
            },
          },
        },
      },
      now,
    );
    const r = await analyzeTree("/tmp/x", await fs.lstat("/tmp/x"), now, budget(), fs);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("foreign-owner");
  });

  it("uses mtime/ctime for liveness, NOT atime (a recent read must not protect a stale file)", async () => {
    const { fs } = makeFakeFs(
      { "/tmp/x": { type: "file", ageDays: 10, atimeDays: 0, blocks: 10 } },
      now,
    );
    const r = await analyzeTree("/tmp/x", await fs.lstat("/tmp/x"), now, budget(), fs);
    expect(r.eligible).toBe(true);
  });

  it("refuses a candidate it cannot fully verify within the budget", async () => {
    const { fs } = makeFakeFs(
      { "/tmp/x": { type: "dir", ageDays: 10, children: { f: { type: "file", ageDays: 10 } } } },
      now,
    );
    const r = await analyzeTree(
      "/tmp/x",
      await fs.lstat("/tmp/x"),
      now,
      { deadline: Date.now() - 1000, nodesLeft: 50_000 },
      fs,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("budget-exceeded");
  });

  it("containment guard is the ONLY thing stopping an escaped-but-otherwise-deletable target", async () => {
    const { fs, rmCalls } = makeFakeFs(
      {
        "/tmp": {
          type: "dir",
          ageDays: 50,
          children: {
            escape: {
              type: "dir",
              ageDays: 10,
              realpath: "/outside/real", // e.g. an ancestor symlink resolving out of tmp
              children: { p: { type: "file", ageDays: 10, blocks: 10 } },
            },
          },
        },
        // Target exists and is old/socket-free: only isWithinRoots prevents rm.
        "/outside/real": {
          type: "dir",
          ageDays: 10,
          children: { q: { type: "file", ageDays: 10, blocks: 10 } },
        },
      },
      now,
    );
    const cleaner = new TmpCleaner(fs, ["/tmp"], BIG_BUDGET);
    await cleaner.clear(false, { safetyTiers: ["safe", "probably-safe"] }, undefined, []);
    expect(rmCalls).toHaveLength(0);
  });

  it("symlink guard fires before realpath, even when the link target is inside the roots", async () => {
    const { fs, rmCalls } = makeFakeFs(
      {
        "/tmp/link": { type: "symlink", ageDays: 10, realpath: "/tmp/target" },
        "/tmp/target": {
          type: "dir",
          ageDays: 10,
          children: { f: { type: "file", ageDays: 10, blocks: 10 } },
        },
      },
      now,
    );
    const cleaner = new TmpCleaner(fs, ["/tmp"], BIG_BUDGET);
    await (cleaner as unknown as { clearPath(p: string): Promise<void> }).clearPath(
      "/tmp/link",
    );
    expect(rmCalls).toHaveLength(0);
  });

  it("re-verifies at clean time and skips a candidate that became active (TOCTOU)", async () => {
    const fileStat = fakeStat({ type: "file", ageDays: 10, blocks: 10 }, now);
    const dirStat = fakeStat({ type: "dir", ageDays: 10 }, now);
    const sockStat = fakeStat({ type: "socket", ageDays: 10 }, now);
    const rmCalls: string[] = [];
    let sockAppeared = false; // a live socket shows up between discovery and delete
    const fs: TmpFs = {
      async readdir(p) {
        if (p === "/tmp") return ["x"];
        if (p === "/tmp/x") return sockAppeared ? ["f", "live"] : ["f"];
        throw new Error(`ENOTDIR ${p}`);
      },
      async lstat(p) {
        if (p === "/tmp/x") return dirStat;
        if (p === "/tmp/x/f") return fileStat;
        if (p === "/tmp/x/live") return sockStat;
        throw new Error(`ENOENT ${p}`);
      },
      async realpath(p) {
        return p;
      },
      async rm(p) {
        rmCalls.push(p);
      },
    };
    const cleaner = new TmpCleaner(fs, ["/tmp"], BIG_BUDGET);
    const cats = await cleaner.getCacheCategories();
    expect(cats.map((c) => c.name)).toContain("x"); // eligible at discovery
    sockAppeared = true;
    await cleaner.clear(false, { safetyTiers: ["safe", "probably-safe"] }, undefined, []);
    expect(rmCalls).not.toContain("/tmp/x");
  });

  it("handles multiple roots: deletes in each, refuses an escape outside all of them", async () => {
    const { fs, rmCalls } = makeFakeFs(
      {
        "/tmp": {
          type: "dir",
          ageDays: 50,
          children: {
            a: { type: "dir", ageDays: 10, children: { x: { type: "file", ageDays: 10, blocks: 20 } } },
            escape: {
              type: "dir",
              ageDays: 10,
              realpath: "/outside",
              children: { p: { type: "file", ageDays: 10, blocks: 10 } },
            },
          },
        },
        "/var/tmp": {
          type: "dir",
          ageDays: 50,
          children: { b: { type: "file", ageDays: 10, blocks: 30 } },
        },
        "/outside": {
          type: "dir",
          ageDays: 10,
          children: { q: { type: "file", ageDays: 10, blocks: 10 } },
        },
      },
      now,
    );
    const cleaner = new TmpCleaner(fs, ["/tmp", "/var/tmp"], BIG_BUDGET);
    await cleaner.clear(false, { safetyTiers: ["safe", "probably-safe"] }, undefined, []);
    expect(rmCalls).toContain("/tmp/a");
    expect(rmCalls).toContain("/var/tmp/b");
    expect(rmCalls).not.toContain("/tmp/escape");
    expect(rmCalls).not.toContain("/outside");
  });
});
