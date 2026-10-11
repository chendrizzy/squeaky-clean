import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  AgentHomeError,
  UnsafePathError,
  NoStagingError,
  agentHomeDir,
  ensureAgentHome,
  isInside,
  resolveCandidate,
  sanitizeComponent,
  mountPointOf,
  makeStagingDir,
  backupDirFor,
} from "../../ub/paths";

const gate = process.platform === "darwin" && process.arch === "arm64";
const ROOT = path.resolve(__dirname, "../../..");

describe.skipIf(!gate)("ub paths", () => {
  let tmp: string;
  const saved = process.env.SQUEAKY_AGENT_HOME;
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ub-paths-")));
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SQUEAKY_AGENT_HOME;
    else process.env.SQUEAKY_AGENT_HOME = saved;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates home 0700 and refuses a group-writable home", async () => {
    process.env.SQUEAKY_AGENT_HOME = path.join(tmp, "h");
    const h = await ensureAgentHome();
    for (const d of [h.home, h.staging, h.backups, h.journal]) {
      expect(fs.statSync(d).mode & 0o777).toBe(0o700);
    }
    expect(agentHomeDir()).toBe(path.join(tmp, "h"));
    fs.chmodSync(h.home, 0o770);
    await expect(ensureAgentHome()).rejects.toBeInstanceOf(AgentHomeError);
  });

  it("refuses a group-writable subdirectory", async () => {
    process.env.SQUEAKY_AGENT_HOME = path.join(tmp, "h");
    const h = await ensureAgentHome();
    fs.chmodSync(h.backups, 0o755);
    await expect(ensureAgentHome()).rejects.toBeInstanceOf(AgentHomeError);
  });

  it("refuses a symlinked home", async () => {
    const other = path.join(tmp, "other");
    fs.mkdirSync(other, { mode: 0o700 });
    fs.symlinkSync(other, path.join(tmp, "h"));
    process.env.SQUEAKY_AGENT_HOME = path.join(tmp, "h");
    await expect(ensureAgentHome()).rejects.toBeInstanceOf(AgentHomeError);
  });

  it("refuses a home that is a file", async () => {
    fs.writeFileSync(path.join(tmp, "h"), "x");
    process.env.SQUEAKY_AGENT_HOME = path.join(tmp, "h");
    await expect(ensureAgentHome()).rejects.toBeInstanceOf(AgentHomeError);
  });

  it("refuses a symlinked subdirectory", async () => {
    process.env.SQUEAKY_AGENT_HOME = path.join(tmp, "h");
    const h = await ensureAgentHome();
    fs.rmdirSync(h.journal);
    fs.symlinkSync(tmp, h.journal);
    await expect(ensureAgentHome()).rejects.toBeInstanceOf(AgentHomeError);
  });

  it("resolveCandidate rejects ../, absolute, and symlinked components", async () => {
    const bundle = path.join(tmp, "A.app");
    fs.mkdirSync(path.join(bundle, "Contents/MacOS"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "outside"));
    fs.writeFileSync(path.join(tmp, "outside/f"), "x");
    fs.writeFileSync(path.join(bundle, "Contents/MacOS/real"), "x");
    fs.symlinkSync("/etc/hosts", path.join(bundle, "Contents/MacOS/link"));
    fs.symlinkSync("../../outside", path.join(bundle, "Contents/Frameworks"));
    await expect(
      resolveCandidate(bundle, "Contents/MacOS/../../x"),
    ).rejects.toBeInstanceOf(UnsafePathError);
    await expect(resolveCandidate(bundle, "/etc/hosts")).rejects.toBeInstanceOf(
      UnsafePathError,
    );
    await expect(
      resolveCandidate(bundle, "Contents/MacOS/link"),
    ).rejects.toBeInstanceOf(UnsafePathError);
    await expect(
      resolveCandidate(bundle, "Contents/Frameworks/f"),
    ).rejects.toBeInstanceOf(UnsafePathError);
    await expect(
      resolveCandidate(bundle, "Contents/MacOS"),
    ).rejects.toBeInstanceOf(UnsafePathError);
    await expect(
      resolveCandidate(bundle, "Contents/MacOS/missing"),
    ).rejects.toBeInstanceOf(UnsafePathError);
    expect(await resolveCandidate(bundle, "Contents/MacOS/real")).toBe(
      path.join(bundle, "Contents/MacOS/real"),
    );
  });

  it("isInside rejects sibling prefix and the parent itself", () => {
    expect(isInside("/a/bc", "/a/b")).toBe(false);
    expect(isInside("/a/b", "/a/b")).toBe(false);
    expect(isInside("/a/b/c", "/a/b")).toBe(true);
    expect(isInside("/a", "/")).toBe(true);
  });

  it("sanitizeComponent", () => {
    expect(sanitizeComponent("1.0 (../42)")).toBe("1.0__.._42_");
    expect(sanitizeComponent("")).toBe("_");
    expect(sanitizeComponent(".")).toBe("_");
    expect(sanitizeComponent("..")).toBe("_");
    expect(sanitizeComponent("a/b")).toBe("a_b");
  });

  it("staging on same device lives under home", async () => {
    process.env.SQUEAKY_AGENT_HOME = path.join(tmp, "h");
    const h = await ensureAgentHome();
    const bundle = path.join(tmp, "B.app");
    fs.mkdirSync(bundle);
    const s = await makeStagingDir(h, bundle, "r1");
    expect(s).toBe(path.join(h.staging, "r1"));
    expect(fs.statSync(s).mode & 0o777).toBe(0o700);
  });

  it("mountPointOf stops at / and at a device change", async () => {
    expect(await mountPointOf("/")).toBe("/");
    const real = await mountPointOf(tmp);
    expect(isInside(tmp, real) || tmp === real).toBe(true);
    const fake = (async (p: fs.PathLike) => {
      const s = String(p);
      return { dev: s === tmp || s.startsWith(tmp + path.sep) ? 2 : 1 };
    }) as unknown as typeof fs.promises.stat;
    expect(await mountPointOf(path.join(tmp, "x/y"), { stat: fake })).toBe(tmp);
  });

  it("staging across devices uses a 0700 mkdtemp dir on the bundle's mount", async () => {
    process.env.SQUEAKY_AGENT_HOME = path.join(tmp, "h");
    const h = await ensureAgentHome();
    const mnt = path.join(tmp, "mnt");
    const bundle = path.join(mnt, "C.app");
    fs.mkdirSync(bundle, { recursive: true });
    const fake = (async (p: fs.PathLike) => {
      const s = String(p);
      return { dev: s === mnt || s.startsWith(mnt + path.sep) ? 2 : 1 };
    }) as unknown as typeof fs.promises.stat;
    const s = await makeStagingDir(h, bundle, "r1", { stat: fake });
    expect(path.dirname(s)).toBe(mnt);
    expect(
      path.basename(s).startsWith(`.squeaky-ub-staging-${process.getuid!()}-`),
    ).toBe(true);
    expect(fs.statSync(s).mode & 0o777).toBe(0o700);
  });

  it("cross-device staging throws NoStagingError when the mount is unwritable", async () => {
    process.env.SQUEAKY_AGENT_HOME = path.join(tmp, "h");
    const h = await ensureAgentHome();
    const mnt = path.join(tmp, "mnt");
    fs.mkdirSync(path.join(mnt, "C.app"), { recursive: true });
    fs.chmodSync(mnt, 0o500);
    const fake = (async (p: fs.PathLike) => {
      const s = String(p);
      return { dev: s === mnt || s.startsWith(mnt + path.sep) ? 2 : 1 };
    }) as unknown as typeof fs.promises.stat;
    try {
      await expect(
        makeStagingDir(h, path.join(mnt, "C.app"), "r1", { stat: fake }),
      ).rejects.toBeInstanceOf(NoStagingError);
    } finally {
      fs.chmodSync(mnt, 0o700);
    }
  });

  it("backupDirFor sanitizes build", () => {
    const h = { home: "/h", staging: "/h/s", backups: "/h/b", journal: "/h/j" };
    const d = backupDirFor(h, "/x.app", "1.0 (../42)", "r1");
    expect(path.basename(d)).toBe("1.0__.._42_-r1");
    expect(path.basename(path.dirname(d))).toMatch(/^[0-9a-f]{16}$/);
    expect(path.dirname(path.dirname(d))).toBe("/h/b");
  });

  it("env override ignored outside test env", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SQUEAKY_AGENT_HOME: "/tmp/x",
    };
    const out = execFileSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [
        "-e",
        `import { agentHomeDir } from ${JSON.stringify(path.join(ROOT, "src/ub/paths.ts"))}; console.log(agentHomeDir());`,
      ],
      { env, encoding: "utf8" },
    ).trim();
    expect(out).toBe(
      path.join(os.homedir(), "Library/Application Support/squeaky-clean"),
    );
  });
});
