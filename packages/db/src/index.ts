import { env } from "@thinkspace/env/server";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

export const createDb = () => drizzle(env.DB, { schema });
