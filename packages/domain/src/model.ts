import { z } from "zod";

import { modelIdSchema } from "./ids";
import { nonEmptyStringSchema } from "./primitives";

export const modelProviderSchema =
  nonEmptyStringSchema.brand<"ModelProvider">();
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const modelTierSchema = z.enum(["cheap", "default", "premium"]);
export type ModelTier = z.infer<typeof modelTierSchema>;

export const modelSchema = z.object({
  displayName: nonEmptyStringSchema,
  id: modelIdSchema,
  provider: modelProviderSchema,
  tier: modelTierSchema,
});
export type Model = z.infer<typeof modelSchema>;
