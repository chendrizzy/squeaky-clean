import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import inquirer from "inquirer";
import { ubCommand } from "../../commands/ub";
import { config } from "../../config";
import type {
  CacheCategory,
  CacheSelectionCriteria,
  ClearResult,
} from "../../types";
import type { ThinOutcome } from "../../ub/thinner";

// No real cleaner: the class is faked, so nothing is scanned or thinned. The line formatters stay real.
const MB = 1024 * 1024;
const fake = vi.hoisted(() => ({
  clear: undefined as unknown as ReturnType<typeof vi.fn>,
  preview: undefined as unknown as ReturnType<typeof vi.fn>,
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
  const real =
    await importOriginal<typeof import("../../cleaners/universalBinary")>();
  const mb = 1024 * 1024;
  const cat = (id: string, name: string, size: number): CacheCategory => ({
    id,
    name,
    description: "",
    paths: [`/Apps/${name}.app`],
    size,
    priority: "low",
    useCase: "archived",
    isProjectSpecific: false,
  });
  class FakeCleaner {
    get lastOutcomes() {
      return fake.lastOutcomes;
    }
    get lastRecovery() {
      return fake.lastRecovery;
    }
    get lastNotes() {
      return fake.lastNotes;
    }
    isAvailable = async () => true;
    getCacheInfo = async () => ({
      name: "universal-binary",
      type: "system",
      description: "",
      paths: [],
      isInstalled: true,
      size: 7 * mb,
      categories: [
        cat("universal-plain", "Plain", 6 * mb),
        cat("universal-store", "Store", 7 * mb),
        cat("universal-tiny", "Tiny", 1 * mb),
      ],
    });
    autoIgnoredClass = (id: string) =>
      id === "universal-store" ? "mac-app-store" : null;
    preview = (criteria: CacheSelectionCriteria, prot: string[]) =>
      fake.preview(criteria, prot);
    clear = (
      dryRun: boolean,
      criteria: CacheSelectionCriteria,
      info: unknown,
      prot: string[],
    ) => fake.clear(dryRun, criteria, info, prot);
  }
  return { ...real, UniversalBinaryCleaner: FakeCleaner };
});

// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const ok = (over: Partial<ClearResult> = {}): ClearResult => ({
  name: "universal-binary",
  success: true,
  clearedPaths: [],
  sizeBefore: 0,
  sizeAfter: 0,
  heldBytes: 0,
  ...over,
});
const outcome = (name: string, reason: string, heldBytes = 0): ThinOutcome => ({
  app: `/Apps/${name}.app`,
  status: "skipped",
  reason,
  heldBytes,
  candidates: [],
  skipped: [],
});
const SIZES: Record<string, [string, number]> = {
  "universal-plain": ["Plain", 6 * MB],
  "universal-store": ["Store", 7 * MB],
  "universal-tiny": ["Tiny", 1 * MB],
};
const PROT = ["/Apps/Keep"];
const gone = {
  entry: { bundle: "/Apps/Gone.app" },
  result: "unreachable",
  notes: [],
};
let out: string[];
const text = () => plain(out.join("\n"));

describe("squeaky ub command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.clear = vi.fn(async () => ok());
    // default plan: every selected app would be thinned
    fake.preview = vi.fn(async (c: CacheSelectionCriteria) =>
      c.categories!.map((id) => outcome(SIZES[id][0], "dry-run", SIZES[id][1])),
    );
    fake.lastOutcomes = [];
    fake.lastRecovery = [];
    fake.lastNotes = [];
    out = [];
    vi.spyOn(config, "getProtectedPaths").mockReturnValue(PROT);
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("an interactive tick passes the ticked ids, the paths it showed and the protected paths", async () => {
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({
      binaries: ["universal-plain", "universal-store"],
    });
    await ubCommand({ force: true });
    const selection = {
      categories: ["universal-plain", "universal-store"],
      tickedIds: ["universal-plain", "universal-store"],
      expectedPaths: {
        "universal-plain": "/Apps/Plain.app",
        "universal-store": "/Apps/Store.app",
      },
    };
    expect(fake.preview).toHaveBeenCalledWith(selection, PROT);
    expect(fake.clear).toHaveBeenCalledWith(false, selection, undefined, PROT);
  });

  it("--all passes no tick, so class and floor still apply", async () => {
    await ubCommand({ all: true, force: true });
    // M3: nothing frees backups in the background in Plan 1
    expect(text()).toMatch(
      /Held in backups: .* \(freed by the next squeaky run after 3 days, or now with `squeaky ub prune`\)/,
    );
    expect(fake.clear).toHaveBeenCalledWith(
      false,
      {
        categories: ["universal-plain", "universal-tiny"],
        tickedIds: undefined,
        expectedPaths: {
          "universal-plain": "/Apps/Plain.app",
          "universal-tiny": "/Apps/Tiny.app",
        },
      },
      undefined,
      PROT,
    );
  });

  it("--all --dry-run counts and lists only what will be thinned; the rest is listed as skipped (round 3)", async () => {
    fake.preview = vi.fn(async () => [
      outcome("Tiny", "below-threshold"),
      outcome("Plain", "dry-run", 6 * MB),
    ]);
    await ubCommand({ all: true, dryRun: true });
    const t = text();
    expect(t).toContain("Will thin 1 of 2 selected application(s)");
    expect(t).toContain("Expected space savings: 6.0 MB");
    expect(t).toMatch(/Will skip:\n\n {2}• Tiny skipped:below-threshold/);
    const dry = t.slice(t.indexOf("[DRY RUN]"));
    expect(dry).toContain("• Plain (6.0 MB)");
    expect(dry).not.toContain("Tiny");
    expect(fake.clear).not.toHaveBeenCalled();
  });

  it("nothing to thin: no confirmation, no clear()", async () => {
    fake.preview = vi.fn(async () => [outcome("Tiny", "below-threshold")]);
    await ubCommand({ all: true });
    expect(text()).toContain("Nothing to thin.");
    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(fake.clear).not.toHaveBeenCalled();
  });

  it("the --all hint says what --all selects", async () => {
    await ubCommand({ list: true });
    expect(text()).toContain(
      "Run `squeaky ub --all` to thin every app listed above that saves at least 5 MB (never auto-ignored or protected ones)",
    );
    expect(text()).not.toContain("thin all Universal Binaries");
  });

  it("recovery and prune notes alone get their own heading, not 'Thinning failed' (T11-R8)", async () => {
    fake.clear = vi.fn(async () => {
      fake.lastRecovery = [gone];
      fake.lastNotes = ["prune: boom"];
      return ok({ error: "recovery Gone: unreachable; prune: boom" });
    });
    await ubCommand({ all: true, force: true });
    expect(text()).toContain("Recovery and housekeeping:");
    expect(text()).toContain(
      "↻ Recovered interrupted run for Gone: unreachable",
    );
    expect(text()).toContain("prune: boom");
    expect(text()).not.toContain("Thinning failed");
  });

  it("recovery names and housekeeping notes from bundles print inertly (c10)", async () => {
    fake.clear = vi.fn(async () => {
      fake.lastRecovery = [
        {
          entry: { bundle: "/Apps/E\x1b]0;x\x07.app" },
          result: "unreachable",
          notes: [],
        },
      ];
      fake.lastNotes = ["prune: \x1b[2J"];
      return ok();
    });
    await ubCommand({ all: true, force: true });
    const raw = out.join("\n");
    expect(raw).toContain(
      "↻ Recovered interrupted run for E\\x1b]0;x\\x07: unreachable",
    );
    expect(raw).toContain("prune: \\x1b[2J");
    expect(raw).not.toMatch(/\x1b\]|\x07|\x1b\[2J/); // eslint-disable-line no-control-regex
  });

  it("says 'Thinning failed' when the run did not succeed and no app has an outcome", async () => {
    fake.clear = vi.fn(async () => ok({ success: false, error: "agent busy" }));
    await ubCommand({ all: true, force: true });
    expect(text()).toContain("Thinning failed: agent busy");
  });

  it("recovery output is shown even when thinning throws (T11-R2)", async () => {
    fake.clear = vi.fn(async () => {
      fake.lastRecovery = [gone];
      throw new Error("kaput");
    });
    await expect(ubCommand({ all: true, force: true })).rejects.toThrow(
      "kaput",
    );
    expect(text()).toContain(
      "↻ Recovered interrupted run for Gone: unreachable",
    );
  });
});
