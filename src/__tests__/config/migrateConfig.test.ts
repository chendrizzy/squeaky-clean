import { describe, it, expect } from "vitest";
import { isLegacyShape, legacyToNew } from "../../config/migrateConfig";

describe("migrateConfig", () => {
  describe("isLegacyShape", () => {
    it("should detect legacy config with tools/auto/output keys", () => {
      const legacyConfig = {
        tools: {
          npm: { enabled: true },
          yarn: { enabled: false },
        },
        auto: {
          enabled: true,
          schedule: "weekly",
        },
        output: {
          verbose: true,
          useColors: false,
        },
      };

      expect(isLegacyShape(legacyConfig)).toBe(true);
    });

    it("should detect new config without legacy keys", () => {
      const newConfig = {
        cleaners: {
          npm: { enabled: true },
          yarn: { enabled: false },
        },
        scheduler: {
          enabled: true,
          interval: "weekly",
        },
        defaults: {
          verbose: true,
          colors: false,
        },
      };

      expect(isLegacyShape(newConfig)).toBe(false);
    });

    it("should detect mixed config as legacy", () => {
      const mixedConfig = {
        tools: { npm: { enabled: true } },
        cleaners: { yarn: { enabled: false } },
        output: { verbose: true },
      };

      expect(isLegacyShape(mixedConfig)).toBe(true);
    });
  });

  describe("legacyToNew", () => {
    it("should migrate tools to cleaners", () => {
      const legacy = {
        tools: {
          npm: {
            enabled: true,
            paths: ["/custom/path"],
            exclude: ["node_modules"],
          },
          docker: { enabled: false },
        },
      };

      const result = legacyToNew(legacy);

      expect(result.cleaners).toEqual({
        npm: {
          enabled: true,
          paths: ["/custom/path"],
          exclude: ["node_modules"],
        },
        docker: { enabled: false },
      });
      expect(result.tools).toBeUndefined();
    });

    it("should migrate auto to scheduler", () => {
      const legacy = {
        auto: {
          enabled: true,
          schedule: "weekly",
          sizeThreshold: "1GB",
          ageThreshold: "30d",
          tools: ["npm", "yarn"],
        },
      };

      const result = legacyToNew(legacy);

      expect(result.scheduler).toEqual({
        enabled: true,
        frequency: "weekly",
        dayOfWeek: undefined,
        time: undefined,
        args: ["--size-threshold", "1GB"],
      });
      expect(result.auto).toBeUndefined();
    });

    it("should migrate output to defaults", () => {
      const legacy = {
        output: {
          verbose: true,
          useColors: false,
          format: "json",
        },
      };

      const result = legacyToNew(legacy);

      expect(result.defaults).toEqual({
        _legacyOutput: {
          verbose: true,
          useColors: false,
          format: "json",
        },
      });
      expect(result.output).toBeUndefined();
    });

    it("should handle extends field", () => {
      const legacy = {
        extends: "./base-config.json",
        tools: { npm: { enabled: true } },
      };

      const result = legacyToNew(legacy);

      expect(result.extends).toBe("./base-config.json");
      expect(result.cleaners).toEqual({ npm: { enabled: true } });
    });

    it("should handle array extends", () => {
      const legacy = {
        extends: ["./base.json", "./overrides.json"],
        tools: { npm: { enabled: true } },
      };

      const result = legacyToNew(legacy);

      expect(result.extends).toEqual(["./base.json", "./overrides.json"]);
    });

    it("should preserve unknown fields", () => {
      const legacy = {
        tools: { npm: { enabled: true } },
        customField: "value",
        nested: {
          custom: "data",
        },
      };

      const result = legacyToNew(legacy);

      expect(result.customField).toBe("value");
      expect(result.nested).toEqual({ custom: "data" });
    });

    it("should give precedence to new keys over legacy when both exist", () => {
      const mixedConfig = {
        tools: { npm: { enabled: false } },
        cleaners: { npm: { enabled: true } },
        auto: { enabled: false },
        scheduler: { enabled: true },
      };

      const result = legacyToNew(mixedConfig);

      expect(result.cleaners.npm.enabled).toBe(true);
      expect(result.scheduler.enabled).toBe(true);
      expect(result.tools).toBeUndefined();
      expect(result.auto).toBeUndefined();
    });

    it("should handle empty config", () => {
      const result = legacyToNew({});
      expect(result).toEqual({});
    });

    it("should handle partial legacy config", () => {
      const legacy = {
        tools: { npm: { enabled: true } },
        // auto and output missing
      };

      const result = legacyToNew(legacy);

      expect(result.cleaners).toEqual({ npm: { enabled: true } });
      expect(result.scheduler).toBeUndefined();
      expect(result.defaults).toBeUndefined();
    });
  });
});
