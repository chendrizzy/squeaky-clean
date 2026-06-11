import { describe, it, expect } from "vitest";
import { classifyCachePath } from "../../src/safety/rules";

describe("Discovery paths classification", () => {
  it("classifies Application Support/*/Cache as probably-safe (default)", () => {
    const paths = [
      "/Users/justin/Library/Application Support/ableton-time-machine/Cache",
      "/Users/justin/Library/Application Support/Custom Shop/Cache",
    ];
    for (const path of paths) {
      const result = classifyCachePath(path);
      console.log(`${path} -> ${result.verdict}: ${result.reason}`);
      expect(result.verdict).toBe("probably-safe");
    }
  });

  it("classifies Slack/Cache as caution (explicit rule)", () => {
    const path = "/Users/justin/Library/Application Support/Slack/Cache";
    const result = classifyCachePath(path);
    console.log(`${path} -> ${result.verdict}: ${result.reason}`);
    expect(result.verdict).toBe("caution");
  });

  it("classifies GPUCache as safe (explicit rule)", () => {
    const path = "/Users/justin/Library/Application Support/someapp/GPUCache";
    const result = classifyCachePath(path);
    console.log(`${path} -> ${result.verdict}: ${result.reason}`);
    expect(result.verdict).toBe("safe");
  });
});
