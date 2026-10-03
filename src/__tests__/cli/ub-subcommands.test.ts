import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "path";
import { vol } from "memfs";

// R13: every command module cli.ts can dispatch to is mocked here, at module level, before cli is
// imported, so no argv in this file (old, new or mistyped) can reach a real ubCommand / thinning.
const h = vi.hoisted(() => ({
  ubCommand: vi.fn(),
  ubRestoreCommand: vi.fn(),
  ubPruneCommand: vi.fn(),
  ensureAgentHome: vi.fn(),
  acquireLock: vi.fn(),
  release: vi.fn(),
  pruneBackups: vi.fn(),
  recoverJournal: vi.fn(),
  restoreApp: vi.fn(),
}));
vi.mock("../../commands/ub", () => ({
  ubCommand: h.ubCommand,
  ubRestoreCommand: h.ubRestoreCommand,
  ubPruneCommand: h.ubPruneCommand,
}));
vi.mock("../../commands/update", () => ({ backgroundUpdateCheck: () => Promise.resolve() }));
// the engine under the real ubPruneCommand / ubRestoreCommand (loaded via importActual below)
vi.mock("../../ub/paths", async (orig) => ({ ...(await orig<object>()), ensureAgentHome: h.ensureAgentHome }));
vi.mock("../../ub/lock", async (orig) => ({ ...(await orig<object>()), acquireLock: h.acquireLock }));
vi.mock("../../ub/backups", async (orig) => ({ ...(await orig<object>()), pruneBackups: h.pruneBackups }));
vi.mock("../../ub/restore", async (orig) => ({
  ...(await orig<object>()),
  recoverJournal: h.recoverJournal,
  restoreAppFromNewestBackup: h.restoreApp,
}));

const PKG = path.resolve(__dirname, "../../../package.json");
const HOME = { home: "/h", staging: "/h/staging", backups: "/h/backups", journal: "/h/journal" };
let exit: ReturnType<typeof vi.spyOn>;

/** Loads a fresh cli.ts with this argv; its top-level IIFE parses process.argv on import. */
async function runCli(argv: string[]): Promise<void> {
  process.argv = ["node", "squeaky", ...argv];
  vi.resetModules();
  await import("../../cli");
}

describe("squeaky ub subcommand parsing", () => {
  const argv0 = process.argv;
  beforeEach(() => {
    vol.fromJSON({ [PKG]: JSON.stringify({ name: "squeaky-clean", version: "0.0.0-test", description: "t" }) });
    for (const fn of [h.ubCommand, h.ubRestoreCommand, h.ubPruneCommand]) fn.mockResolvedValue(undefined);
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });
  afterEach(() => {
    process.argv = argv0;
    vi.restoreAllMocks();
  });

  it.each([
    [["ub", "--all"], "ubCommand", [{ all: true }]],
    [["ub", "-l"], "ubCommand", [{ list: true }]],
    [["ub", "prune", "--all"], "ubPruneCommand", [undefined, { all: true }]],
    [["ub", "prune", "-a"], "ubPruneCommand", [undefined, { all: true }]],
    [["ub", "prune", "/Apps/Foo.app"], "ubPruneCommand", ["/Apps/Foo.app", { all: undefined }]],
    [["ub", "restore", "Foo"], "ubRestoreCommand", ["Foo"]],
  ] as const)("parses %j", async (argv, fn, args) => {
    await runCli([...argv]);
    const target = h[fn];
    await vi.waitFor(() => expect(target).toHaveBeenCalledTimes(1));
    expect(target).toHaveBeenCalledWith(...args);
    for (const other of ["ubCommand", "ubRestoreCommand", "ubPruneCommand"] as const) {
      if (other !== fn) expect(h[other]).not.toHaveBeenCalled();
    }
    expect(exit).not.toHaveBeenCalled();
  });

  it("ub prune with no app and no --all reaches the prune command, never thinning", async () => {
    await runCli(["ub", "prune"]);
    await vi.waitFor(() => expect(h.ubPruneCommand).toHaveBeenCalledWith(undefined, { all: undefined }));
    expect(h.ubCommand).not.toHaveBeenCalled();
  });

  it("a mistyped subcommand is an argument error, not a thinning run", async () => {
    await runCli(["ub", "restor", "Foo", "--all"]);
    expect(exit).toHaveBeenCalledWith(1);
    // the real process.exit ends the process here; with it stubbed, commander carries on, so
    // anything it dispatches afterwards would be unreachable in a real run
    await new Promise((r) => setTimeout(r, 20));
    const firstUb = h.ubCommand.mock.invocationCallOrder[0] ?? Infinity;
    expect(firstUb).toBeGreaterThan(exit.mock.invocationCallOrder[0]);
  });

  it("a failing subcommand exits non-zero", async () => {
    h.ubRestoreCommand.mockRejectedValue(new Error("Foo was not restored: superseded"));
    await runCli(["ub", "restore", "Foo"]);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});

describe("ub restore / prune commands", () => {
  type Cmds = typeof import("../../commands/ub");
  let cmds: Cmds;
  beforeEach(async () => {
    cmds = await vi.importActual<Cmds>("../../commands/ub");
    h.ensureAgentHome.mockResolvedValue(HOME);
    h.release.mockResolvedValue(undefined);
    h.acquireLock.mockResolvedValue({ runId: "lock-run", release: h.release });
    h.pruneBackups.mockResolvedValue({ removedDirs: ["/h/backups/x/1-r"], freedBytes: 10, heldDirs: [] });
    h.recoverJournal.mockResolvedValue([]);
    h.restoreApp.mockResolvedValue({ status: "restored", notes: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it("ub prune with no app and no --all is an error and prunes nothing", async () => {
    await expect(cmds.ubPruneCommand(undefined, {})).rejects.toThrow(/--all/);
    await expect(cmds.ubPruneCommand("/Apps/Foo.app", { all: true })).rejects.toThrow(/not both/);
    expect(h.ensureAgentHome).not.toHaveBeenCalled();
    expect(h.acquireLock).not.toHaveBeenCalled();
    expect(h.pruneBackups).not.toHaveBeenCalled();
  });

  it("prune <app> and prune --all run under the lock with the thinning run's wait, released after", async () => {
    await cmds.ubPruneCommand("/Apps/Foo.app", {});
    expect(h.pruneBackups).toHaveBeenLastCalledWith(HOME, "/Apps/Foo.app");
    await cmds.ubPruneCommand(undefined, { all: true });
    expect(h.pruneBackups).toHaveBeenLastCalledWith(HOME, undefined);
    expect(h.acquireLock).toHaveBeenCalledWith(HOME, { waitMs: 150_000 });
    expect(h.release).toHaveBeenCalledTimes(2);
  });

  it("a busy lock is an error and touches nothing", async () => {
    h.acquireLock.mockResolvedValue(null);
    await expect(cmds.ubPruneCommand(undefined, { all: true })).rejects.toThrow(/agent busy/);
    await expect(cmds.ubRestoreCommand("/Apps/Foo.app")).rejects.toThrow(/agent busy/);
    expect(h.pruneBackups).not.toHaveBeenCalled();
    expect(h.recoverJournal).not.toHaveBeenCalled();
    expect(h.restoreApp).not.toHaveBeenCalled();
  });

  it("releases the lock when the work throws", async () => {
    h.pruneBackups.mockRejectedValue(new Error("EACCES"));
    await expect(cmds.ubPruneCommand(undefined, { all: true })).rejects.toThrow("EACCES");
    h.restoreApp.mockRejectedValue(new Error("boom"));
    await expect(cmds.ubRestoreCommand("/Apps/Foo.app")).rejects.toThrow("boom");
    expect(h.release).toHaveBeenCalledTimes(2);
  });

  it("prune that had to keep a referenced backup fails", async () => {
    h.pruneBackups.mockResolvedValue({ removedDirs: [], freedBytes: 0, heldDirs: ["/h/backups/x/1-r"] });
    await expect(cmds.ubPruneCommand("/Apps/Foo.app", {})).rejects.toThrow(/1 backup\(s\) kept/);
  });

  it("restore recovers interrupted runs first, then restores; only restored / nothing-to-do succeed", async () => {
    await cmds.ubRestoreCommand("/Apps/Foo.app");
    expect(h.recoverJournal).toHaveBeenCalledWith(HOME, "lock-run");
    expect(h.restoreApp).toHaveBeenCalledWith(HOME, "/Apps/Foo.app");
    expect(h.recoverJournal.mock.invocationCallOrder[0]).toBeLessThan(h.restoreApp.mock.invocationCallOrder[0]);
    h.restoreApp.mockResolvedValue({ status: "nothing-to-do", notes: [] });
    await expect(cmds.ubRestoreCommand("/Apps/Foo.app")).resolves.toBeUndefined();
    for (const status of ["superseded", "restore-failed", "unreachable"]) {
      h.restoreApp.mockResolvedValue({ status, notes: ["why"] });
      await expect(cmds.ubRestoreCommand("/Apps/Foo.app")).rejects.toThrow(`Foo was not restored: ${status}`);
    }
    expect(h.release).toHaveBeenCalledTimes(5);
  });
});
