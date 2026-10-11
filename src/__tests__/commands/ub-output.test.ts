import { describe, it, expect } from "vitest";
import { outcomeLine } from "../../commands/ub";
import { printable, recoveryLine, type RecoveryItem } from "../../cleaners/universalBinary";
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

describe("bundle-derived text prints inertly (c10)", () => {
  // OSC title rewrite, BEL, and an 8-bit CSI "erase screen"
  const evil = "Evil\x1b]0;pwned\x07\x9b2J";
  const shown = "Evil\\x1b]0;pwned\\x07\\x9b2J";

  it("printable escapes every C0/C1 control char and DEL as \\xNN, and nothing else", () => {
    expect(printable("a\x00b\x1f\x7f\x80\x9f\t\n é—✓")).toBe("a\\x00b\\x1f\\x7f\\x80\\x9f\\x09\\x0a é—✓");
  });

  it("outcomeLine and recoveryLine escape the app name, the detail and the notes", () => {
    expect(outcomeLine({ ...o("aborted", "error"), app: `/Applications/${evil}.app`, detail: `lipo: ${evil}` })).toBe(
      `✗ ${shown} aborted:error — lipo: ${shown}`,
    );
    const r = { entry: { bundle: `/Applications/${evil}.app` }, result: "restore-failed", notes: [`x: ${evil}`] } as unknown as RecoveryItem;
    expect(recoveryLine(r)).toBe(`↻ Recovered interrupted run for ${shown}: restore-failed (x: ${shown})`);
  });
});
