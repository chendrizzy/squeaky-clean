import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import inquirer from "inquirer";
import { ubCommand } from "../../commands/ub";
import type { CacheCategory, CacheSelectionCriteria, ClearResult } from "../../types";

// No real cleaner: the class is faked, so nothing is scanned or thinned. The line formatters stay real.
const fake = vi.hoisted(() => ({
  clear: undefined as unknown as ReturnType<typeof vi.fn>,
  lastOutcomes: [] as unknown[],
  lastRecovery: [] as unknown[],
  lastNotes: [] as string[],
}));

vi.mock("inquirer", () => ({ default: { prompt: vi.fn() } }));
vi.mock("ora", () => ({
  default: () => {
    const s = { start: () => s, stop: () => s, fail: () => s };
    return s;
  },
}));
vi.mock("../../cleaners/universalBinary", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../cleaners/universalBinary")>();
  const MB = 1024 * 1024;
  const cat = (id: string, name: string, size: number): CacheCategory => ({
    id, name, description: "", paths: [`/Apps/${name}.app`], size, priority: "low", useCase: "archived", isProjectSpecific: false,
  });
  class FakeCleaner {
    get lastOutcomes() { return fake.lastOutcomes; }
    get lastRecovery() { return fake.lastRecovery; }
    get lastNotes() { return fake.lastNotes; }
    isAvailable = async () => true;
    getCacheInfo = async () => ({
      name: "universal-binary", type: "system", description: "", paths: [], isInstalled: true, size: 6 * MB,
      categories: [cat("universal-plain", "Plain", 6 * MB), cat("universal-store", "Store", 7 * MB)],
    });
    autoIgnoredClass = (id: string) => (id === "universal-store" ? "mac-app-store" : null);
    clear = (dryRun: boolean, criteria: CacheSelectionCriteria) => fake.clear(dryRun, criteria);
  }
  return { ...real, UniversalBinaryCleaner: FakeCleaner };
});

const ok = (over: Partial<ClearResult> = {}): ClearResult => ({
  name: "universal-binary", success: true, clearedPaths: [], sizeBefore: 0, sizeAfter: 0, heldBytes: 0, ...over,
});
const gone = { entry: { bundle: "/Apps/Gone.app" }, result: "unreachable", notes: [] };
let out: string[];

describe("squeaky ub command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.clear = vi.fn(async () => ok());
    fake.lastOutcomes = [];
    fake.lastRecovery = [];
    fake.lastNotes = [];
    out = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("an interactive tick passes the ticked ids and the paths it showed", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ binaries: ["universal-plain", "universal-store"] });
    await ubCommand({ force: true });
    expect(fake.clear).toHaveBeenCalledWith(false, {
      categories: ["universal-plain", "universal-store"],
      tickedIds: ["universal-plain", "universal-store"],
      expectedPaths: { "universal-plain": "/Apps/Plain.app", "universal-store": "/Apps/Store.app" },
    });
  });

  it("--all passes no tick, so class and floor still apply", async () => {
    await ubCommand({ all: true, force: true });
    expect(fake.clear).toHaveBeenCalledWith(false, {
      categories: ["universal-plain"],
      tickedIds: undefined,
      expectedPaths: { "universal-plain": "/Apps/Plain.app" },
    });
  });

  it("recovery and prune notes alone get their own heading, not 'Thinning failed' (T11-R8)", async () => {
    fake.clear = vi.fn(async () => {
      fake.lastRecovery = [gone];
      fake.lastNotes = ["prune: boom"];
      return ok({ error: "recovery Gone: unreachable; prune: boom" });
    });
    await ubCommand({ all: true, force: true });
    const text = out.join("\n");
    expect(text).toContain("Recovery and housekeeping:");
    expect(text).toContain("↻ Recovered interrupted run for Gone: unreachable");
    expect(text).toContain("prune: boom");
    expect(text).not.toContain("Thinning failed");
  });

  it("says 'Thinning failed' when the run did not succeed and no app has an outcome", async () => {
    fake.clear = vi.fn(async () => ok({ success: false, error: "agent busy" }));
    await ubCommand({ all: true, force: true });
    expect(out.join("\n")).toContain("Thinning failed: agent busy");
  });

  it("recovery output is shown even when thinning throws (T11-R2)", async () => {
    fake.clear = vi.fn(async () => {
      fake.lastRecovery = [gone];
      throw new Error("kaput");
    });
    await expect(ubCommand({ all: true, force: true })).rejects.toThrow("kaput");
    expect(out.join("\n")).toContain("↻ Recovered interrupted run for Gone: unreachable");
  });
});
