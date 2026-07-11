import { z } from "zod";

import { modelIdSchema } from "./ids";
import { nonEmptyStringSchema } from "./primitives";

export const modelProviderSchema =
  nonEmptyStringSchema.brand<"ModelProvider">();
export type ModelProvider = z.infer<typeof modelProviderSchema>;

/** Per-token pricing, mirroring models.dev `cost` (camelCased). */
export const modelCostSchema = z.object({
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
});
export type ModelCost = z.infer<typeof modelCostSchema>;

/** Context/output token ceilings, mirroring models.dev `limit`. */
export const modelLimitsSchema = z.object({
  context: z.number().int().positive(),
  output: z.number().int().positive(),
});
export type ModelLimits = z.infer<typeof modelLimitsSchema>;

/** Feature flags, mirroring the models.dev capability booleans (camelCased). */
export const modelCapabilitiesSchema = z.object({
  attachment: z.boolean(),
  reasoning: z.boolean(),
  structuredOutput: z.boolean(),
  toolCall: z.boolean(),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

export const modelSchema = z.object({
  capabilities: modelCapabilitiesSchema,
  catalogSource: z.enum(["models_dev", "provider_default"]),
  cost: modelCostSchema,
  displayName: nonEmptyStringSchema,
  id: modelIdSchema,
  limits: modelLimitsSchema,
  provider: modelProviderSchema,
  releaseDate: z.iso.date(),
});
export type Model = z.infer<typeof modelSchema>;
