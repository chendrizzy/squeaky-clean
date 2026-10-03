import { describe, it, expect } from "vitest";
import { outcomeLine } from "../../commands/ub";
import type { ThinOutcome } from "../../ub/thinner";

// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const o = (status: ThinOutcome["status"], reason?: string, heldBytes = 0): ThinOutcome => ({
  app: "/Applications/Some App.app", status, reason, heldBytes, candidates: [], skipped: [],
});

describe("ub per-app outcome lines", () => {
  it.each([
    [o("thinned", undefined, 3 * 1024 * 1024), "✓ Some App — 3.0 MB will be freed by the next squeaky run after 3 days, or now with `squeaky ub prune` (backup kept for safe rollback)"],
    [o("rolled-back", "verify-failed"), "↩ Some App rolled back (verify failed) — unchanged"],
    [o("skipped", "running"), "⏸ Some App skipped: running — quit it and re-run"],
    [o("skipped", "below-threshold"), "• Some App skipped:below-threshold"],
    [{ ...o("aborted", "error"), detail: "boom" }, "✗ Some App aborted:error — boom"],
  ])("%#", (outcome, line) => {
    expect(plain(outcomeLine(outcome))).toBe(line);
  });

  it("blocked:app-management names the node binary to grant", () => {
    expect(plain(outcomeLine(o("blocked", "app-management")))).toMatch(
      /^⛔ Some App blocked: app-management — grant App Management to \/\S.* in System Settings → Privacy & Security$/,
    );
  });
});
