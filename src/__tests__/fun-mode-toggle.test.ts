import { describe, expect, it } from "vitest";
import { showBootPristine } from "../utils/cli.js";
import { config } from "../config/index.js";

describe("fun mode toggle", () => {
  it("honors env override for fun mode", () => {
    const original = process.env.SQUEAKY_FUN_MODE;

    process.env.SQUEAKY_FUN_MODE = "0";
    expect(config.isFunModeEnabled()).toBe(false);

    process.env.SQUEAKY_FUN_MODE = "1";
    expect(config.isFunModeEnabled()).toBe(true);

    process.env.SQUEAKY_FUN_MODE = original;
  });

  it("skips boot animation when fun mode not allowed", async () => {
    const start = Date.now();
    await showBootPristine(true, false);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
