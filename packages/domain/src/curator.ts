import { z } from "zod";

import { modelIdSchema, workspaceIdSchema } from "./ids";

/** Curator is workspace-scoped, runs on workspace BYOK, and is outside the Channel lifecycle. */
export const curatorSchema = z.object({
  modelId: modelIdSchema,
  workspaceId: workspaceIdSchema,
});
export type Curator = z.infer<typeof curatorSchema>;
