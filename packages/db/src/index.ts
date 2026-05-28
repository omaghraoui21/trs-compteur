import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";

// H4: Guard against missing DATABASE_URL — crash with a clear message instead of a null-deref later
const connectionString: string =
  process.env.DATABASE_URL ??
  (() => {
    console.error("FATAL: DATABASE_URL environment variable is not set");
    process.exit(1);
  })();

export function createDb(url = connectionString) {
  const client = postgres(url);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
