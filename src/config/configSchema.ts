// src/config/configSchema.ts
// Zod schemas for config validation (replaces ajv)

import { z } from "zod";

// Legacy config schema (v0)
export const OldConfigSchema = z.object({
  tools: z.record(z.string(), z.any()).optional(),
  auto: z.object({
    enabled: z.boolean().optional(),
    schedule: z.enum(["daily", "weekly", "monthly"]).optional(),
    dayOfWeek: z.union([z.string(), z.number()]).optional(),
    time: z.string().optional(),
    sizeThreshold: z.string().optional(),
    args: z.array(z.string()).optional(),
  }).passthrough().optional(),
  output: z.object({
    verbose: z.boolean().optional(),
    useColors: z.boolean().optional(),
  }).passthrough().optional(),
  extends: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough();

// New config schema (v1)
export const NewConfigSchema = z.object({
  cleaners: z.record(z.string(), z.any()).optional(),
  scheduler: z.object({
    enabled: z.boolean().optional(),
    frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
    dayOfWeek: z.union([z.string(), z.number()]).optional(),
    time: z.string().optional(),
    args: z.array(z.string()).optional(),
  }).passthrough().optional(),
  defaults: z.record(z.string(), z.any()).optional(),
  plugins: z.record(z.string(), z.any()).optional(),
  profiles: z.record(z.string(), z.any()).optional(),
  extends: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough();

// Mixed config (supports both old and new keys)
export const MixedConfigSchema = OldConfigSchema.merge(NewConfigSchema);

// Type exports
export type OldConfig = z.infer<typeof OldConfigSchema>;
export type NewConfig = z.infer<typeof NewConfigSchema>;
export type MixedConfig = z.infer<typeof MixedConfigSchema>;

// Validation functions
export function validateOldConfig(data: unknown): { success: boolean; data?: OldConfig; errors?: string[] } {
  const result = OldConfigSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((e: z.ZodIssue) => `${e.path.join(".")} ${e.message}`),
  };
}

export function validateNewConfig(data: unknown): { success: boolean; data?: NewConfig; errors?: string[] } {
  const result = NewConfigSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((e: z.ZodIssue) => `${e.path.join(".")} ${e.message}`),
  };
}

export function validateMixedConfig(data: unknown): { success: boolean; data?: MixedConfig; errors?: string[] } {
  const result = MixedConfigSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((e: z.ZodIssue) => `${e.path.join(".")} ${e.message}`),
  };
}
