import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export { schema };
export * from "./schema";

/** Cliente tipado de la base D1. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
export type Db = ReturnType<typeof createDb>;
